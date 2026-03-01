import os
import uuid
import json
import logging
import requests
from fastapi import FastAPI, UploadFile, File, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
from dotenv import load_dotenv

load_dotenv()

from parsers.slack_parser import parse_slack
from parsers.jira_parser import parse_jira
from parsers.transcript_parser import parse_transcript
from vector_store import store_chunks, query_index
from cluster import run_clustering
from llm import get_answer
from key_pool import key_pool, NoAvailableKeyError

logger = logging.getLogger(__name__)

# ── Register key pools ───────────────────────────────────────────────────────
gemini_keys = [v for k, v in os.environ.items() if k.startswith("GEMINI_KEY_") and v]
groq_keys   = [v for k, v in os.environ.items() if k.startswith("GROQ_KEY_") and v]

key_pool.register("gemini", gemini_keys)
key_pool.register("groq",   groq_keys)

# ── Per-session query cap (in-memory) ────────────────────────────────────────
QUERY_CAP = 4
query_counts: dict[str, int] = {}

app = FastAPI(title="PM Signal API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Health ───────────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {
        "status": "ok",
        "gemini_pool": key_pool.status("gemini"),
        "groq_pool":   key_pool.status("groq"),
        "cohere":      "available" if os.environ.get("COHERE_API_KEY") else "missing",
    }


# ── Ingest ───────────────────────────────────────────────────────────────────
@app.post("/ingest")
async def ingest(
    files: List[UploadFile] = File(...),
    session_id: Optional[str] = Form(None),
):
    if not session_id:
        session_id = uuid.uuid4().hex

    total_chunks = 0
    file_results = []

    for upload in files:
        filename = upload.filename
        content = await upload.read()

        if len(content) > 10 * 1024 * 1024:
            raise HTTPException(status_code=400, detail=f"{filename} exceeds 10MB limit.")

        ext = filename.lower().split(".")[-1]
        if ext == "json":
            chunks = parse_slack(content)
        elif ext == "csv":
            chunks = parse_jira(content.decode("utf-8", errors="ignore"))
        elif ext in ("pdf", "txt"):
            chunks = parse_transcript(content, filename)
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported file type: .{ext}")

        if not chunks:
            file_results.append({"file": filename, "chunks": 0, "warning": "No parseable content found."})
            continue

        count = store_chunks(chunks, source_file=filename, session_id=session_id)
        total_chunks += count
        file_results.append({"file": filename, "chunks": count})

    query_counts[session_id] = 0

    return {
        "session_id": session_id,
        "total_chunks_indexed": total_chunks,
        "files": file_results,
    }


# ── Query ────────────────────────────────────────────────────────────────────
class QueryRequest(BaseModel):
    query: str
    session_id: str
    top_k: int = 12


@app.post("/query")
async def query(req: QueryRequest):
    if not req.query.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty.")

    count = query_counts.get(req.session_id, 0)
    if count >= QUERY_CAP:
        raise HTTPException(
            status_code=429,
            detail=f"QUERY_CAP_REACHED: You've used all {QUERY_CAP} free questions for this session. Restart to ask more."
        )

    try:
        chunks = query_index(req.query, session_id=req.session_id, top_k=req.top_k)
        answer = get_answer(req.query, chunks)
    except NoAvailableKeyError as e:
        raise HTTPException(status_code=503, detail=str(e))

    query_counts[req.session_id] = count + 1

    return {
        "answer": answer,
        "sources": chunks,
        "query": req.query,
        "queries_remaining": QUERY_CAP - (count + 1),
    }


# ── Insights ─────────────────────────────────────────────────────────────────
class InsightsRequest(BaseModel):
    session_id: str
    n_clusters: Optional[int] = 5


@app.post("/insights")
async def insights(req: InsightsRequest):
    if not req.session_id:
        raise HTTPException(status_code=400, detail="session_id is required.")
    try:
        clusters = run_clustering(req.session_id)
    except NoAvailableKeyError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Clustering failed: {str(e)}")

    return {
        "session_id": req.session_id,
        "clusters": clusters,
        "total_clusters": len(clusters),
    }


# ── Suggestions ──────────────────────────────────────────────────────────────
class SuggestionsRequest(BaseModel):
    session_id: str
    cluster_names: List[str]
    excerpts: Optional[List[str]] = []


def _cluster_fallback(names: List[str]) -> List[str]:
    """Generate basic questions from cluster names when GroQ is unavailable."""
    return [f"Tell me more about {name}" for name in names[:3]]


@app.post("/suggestions")
async def get_suggestions(req: SuggestionsRequest):
    """
    Generate 3 data-specific query suggestions grounded in actual chunk excerpts.
    Falls back to cluster-name-derived questions if GroQ fails.
    """
    cluster_names = [n for n in req.cluster_names if n]

    if not cluster_names:
        return {"suggestions": []}

    # Build excerpt context — cap at 8 excerpts, 80 chars each to stay within token budget
    excerpts = [e.strip()[:80] for e in (req.excerpts or []) if e.strip()][:8]
    excerpt_text = "\n".join(f"- {e}" for e in excerpts) if excerpts else "(no excerpts available)"

    prompt = f"""You are helping a Product Manager understand their user feedback data.
The data has been clustered into these top issue themes: {', '.join(cluster_names)}.

Here are sample excerpts from the actual uploaded data:
{excerpt_text}

Generate exactly 3 specific questions a PM would ask that are DIRECTLY answerable from the excerpts and themes above.
Do NOT invent metrics, percentages, or details not present in the excerpts.
Each question must be simple and answerable from the data shown.
Return ONLY a valid JSON array of 3 strings. No explanation, no markdown, no preamble.
Example: ["Question 1?", "Question 2?", "Question 3?"]"""

    # ── Try GroQ ──
    try:
        groq_key = key_pool.get_key("groq")
    except NoAvailableKeyError:
        logger.warning("No GroQ keys available for suggestions — using cluster fallback")
        return {"suggestions": _cluster_fallback(cluster_names)}

    try:
        response = requests.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {groq_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": "llama-3.3-70b-versatile",
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": 200,
                "temperature": 0.3,
            },
            timeout=15,
        )

        if response.status_code == 429:
            key_pool.mark_429("groq", groq_key)
            logger.warning("GroQ 429 on suggestions — using cluster fallback")
            return {"suggestions": _cluster_fallback(cluster_names)}

        if not response.ok:
            logger.warning(f"GroQ {response.status_code} on suggestions — using cluster fallback")
            return {"suggestions": _cluster_fallback(cluster_names)}

        content = response.json()["choices"][0]["message"]["content"].strip()
        content = content.replace("```json", "").replace("```", "").strip()

        parsed = json.loads(content)
        if isinstance(parsed, list) and len(parsed) >= 1:
            return {"suggestions": [str(s) for s in parsed[:3]]}

        logger.warning("GroQ suggestions returned unexpected format — using cluster fallback")
        return {"suggestions": _cluster_fallback(cluster_names)}

    except json.JSONDecodeError:
        logger.warning("GroQ suggestions JSON parse failed — using cluster fallback")
        return {"suggestions": _cluster_fallback(cluster_names)}
    except Exception as e:
        logger.warning(f"Suggestions GroQ call failed: {e} — using cluster fallback")
        return {"suggestions": _cluster_fallback(cluster_names)}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=10000)
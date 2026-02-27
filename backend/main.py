import os
import uuid
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
from llm import generate_answer
from key_pool import key_pool, NoAvailableKeyError

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

    # Initialise query counter for this session
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
    top_k: int = 8


@app.post("/query")
async def query(req: QueryRequest):
    if not req.query.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty.")

    # Query cap check
    count = query_counts.get(req.session_id, 0)
    if count >= QUERY_CAP:
        raise HTTPException(
            status_code=429,
            detail=f"QUERY_CAP_REACHED: You've used all {QUERY_CAP} free questions for this session. Restart to ask more."
        )

    # NoAvailableKeyError handler
    try:
        chunks = query_index(req.query, session_id=req.session_id, top_k=req.top_k)
        answer = generate_answer(req.query, chunks)
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
    n_clusters: int = 5


@app.post("/insights")
async def insights(req: InsightsRequest):
    if not req.session_id:
        raise HTTPException(status_code=400, detail="session_id is required.")
    try:
        clusters = run_clustering(req.session_id, n_clusters=req.n_clusters)
    except NoAvailableKeyError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Clustering failed: {str(e)}")

    return {
        "session_id": req.session_id,
        "clusters": clusters,
        "total_clusters": len(clusters),
    }
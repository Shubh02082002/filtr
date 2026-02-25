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
from llm import generate_answer

app = FastAPI(title="PM Signal API", version="1.0.0")

# CORS â€” allow Next.js frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# â”€â”€ Health check â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

@app.get("/health")
def health():
    return {"status": "ok"}


# â”€â”€ Ingest endpoint â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

@app.post("/ingest")
async def ingest(
    files: List[UploadFile] = File(...),
    session_id: Optional[str] = Form(None),
):
    """
    Accept one or more uploaded files, parse them, embed, and store in Pinecone.
    Returns a session_id the frontend stores to scope future queries.
    """
    if not session_id:
        session_id = uuid.uuid4().hex

    total_chunks = 0
    file_results = []

    for upload in files:
        filename = upload.filename
        content = await upload.read()

        # Guard: 10MB per file
        if len(content) > 10 * 1024 * 1024:
            raise HTTPException(status_code=400, detail=f"{filename} exceeds 10MB limit.")

        # Route to correct parser
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

        # Embed + store
        count = store_chunks(chunks, source_file=filename, session_id=session_id)
        total_chunks += count
        file_results.append({"file": filename, "chunks": count})

    return {
        "session_id": session_id,
        "total_chunks_indexed": total_chunks,
        "files": file_results,
    }


# â”€â”€ Query endpoint â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

class QueryRequest(BaseModel):
    query: str
    session_id: str
    top_k: int = 8


@app.post("/query")
async def query(req: QueryRequest):
    """
    Semantic search over indexed chunks, then generate an LLM answer.
    """
    if not req.query.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty.")

    # Retrieve relevant chunks
    chunks = query_index(req.query, session_id=req.session_id, top_k=req.top_k)

    # Generate answer from LLM
    answer = generate_answer(req.query, chunks)

    return {
        "answer": answer,
        "sources": chunks,
        "query": req.query,
    }


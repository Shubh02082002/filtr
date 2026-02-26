import os
import uuid
import time
import requests
from typing import List, Dict
from pinecone import Pinecone

# Initialize Pinecone
pc = Pinecone(api_key=os.environ["PINECONE_API_KEY"])

GEMINI_API_KEY = None

def get_api_key():
    global GEMINI_API_KEY
    if GEMINI_API_KEY is None:
        GEMINI_API_KEY = os.environ["GEMINI_API_KEY"]
    return GEMINI_API_KEY

def get_index():
    index_name = os.environ.get("PINECONE_INDEX_NAME", "pmsignal")
    return pc.Index(index_name)

def embed_single(text: str, task_type: str = "retrieval_document") -> List[float]:
    """Call Gemini embedding REST API directly."""
    api_key = get_api_key()
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key={api_key}"
    payload = {
        "model": "models/gemini-embedding-001",
        "content": {"parts": [{"text": text}]},
        "taskType": task_type,
        "outputDimensionality": 768
    }
    response = requests.post(url, json=payload)
    response.raise_for_status()
    return response.json()["embedding"]["values"]

def embed_texts(texts: List[str]) -> List[List[float]]:
    """
    Embed a list of texts using Gemini text-embedding-004 via REST.
    Batches to respect rate limits (15 RPM on free tier).
    """
    embeddings = []
    for i, text in enumerate(texts):
        embeddings.append(embed_single(text, task_type="retrieval_document"))
        if (i + 1) % 10 == 0:
            time.sleep(1)  # pause every 10 to respect rate limits
        else:
            time.sleep(0.1)
    return embeddings

def embed_query(query: str) -> List[float]:
    """Embed a single query string."""
    return embed_single(query, task_type="retrieval_query")

def store_chunks(chunks: List[Dict], source_file: str, session_id: str):
    """
    Embed and upsert chunks into Pinecone with metadata.
    """
    index = get_index()
    texts = [c["text"] for c in chunks]
    embeddings = embed_texts(texts)
    vectors = []
    for chunk, embedding in zip(chunks, embeddings):
        chunk_id = f"{session_id}_{uuid.uuid4().hex[:8]}"
        vectors.append({
            "id": chunk_id,
            "values": embedding,
            "metadata": {
                "session_id": session_id,
                "source_file": source_file,
                "source_type": chunk.get("source_type", "unknown"),
                "original_text": chunk["text"][:1000],
                "author": chunk.get("author") or "",
                "timestamp": chunk.get("timestamp") or "",
                "issue_type": chunk.get("issue_type") or "",
            }
        })
    # Upsert in batches of 100
    batch_size = 100
    for i in range(0, len(vectors), batch_size):
        index.upsert(vectors=vectors[i:i + batch_size])
    return len(vectors)

def query_index(query: str, session_id: str, top_k: int = 8) -> List[Dict]:
    """
    Embed query and retrieve top-K chunks from Pinecone filtered by session.
    """
    index = get_index()
    query_vector = embed_query(query)
    results = index.query(
        vector=query_vector,
        top_k=top_k,
        filter={"session_id": {"$eq": session_id}},
        include_metadata=True
    )
    chunks = []
    for match in results.get("matches", []):
        meta = match.get("metadata", {})
        chunks.append({
            "score": round(match.get("score", 0), 3),
            "text": meta.get("original_text", ""),
            "source_file": meta.get("source_file", ""),
            "source_type": meta.get("source_type", ""),
            "author": meta.get("author", ""),
            "timestamp": meta.get("timestamp", ""),
            "issue_type": meta.get("issue_type", ""),
        })
    return chunks


def fetch_session_vectors(session_id: str):
    index = get_index()
    all_ids = []
    for id_batch in index.list(prefix=session_id):
        if isinstance(id_batch, list):
            all_ids.extend(id_batch)
        else:
            all_ids.append(id_batch)
    if not all_ids:
        return []
    results = []
    for i in range(0, len(all_ids), 100):
        batch = all_ids[i:i+100]
        fetched = index.fetch(ids=batch)
        for vid, vdata in fetched.vectors.items():
            results.append({
                "id": vid,
                "values": vdata.values,
                "metadata": dict(vdata.metadata)
            })
    return results

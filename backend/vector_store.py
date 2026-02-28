import os
import uuid
import requests
from typing import List, Dict
from pinecone import Pinecone
from key_pool import key_pool, NoAvailableKeyError

# ── Source type retrieval weights ─────────────────────────────────────────────
# Jira and transcripts are more information-dense than Slack messages.
# We boost their scores post-retrieval so they aren't buried by Slack volume.
SOURCE_WEIGHTS = {
    "jira":       1.25,
    "transcript": 1.20,
    "slack":      1.00,
    "unknown":    1.00,
}

# Initialize Pinecone
pc = Pinecone(api_key=os.environ["PINECONE_API_KEY"])


def get_index():
    index_name = os.environ.get("PINECONE_INDEX_NAME", "pmsignal")
    return pc.Index(index_name)


# ── Embedding ─────────────────────────────────────────────────────────────────

def embed_single(text: str, task_type: str = "retrieval_document") -> List[float]:
    """Single embedding call with key pool rotation."""
    for attempt in range(4):
        key = key_pool.get_key("gemini")
        url = (
            f"https://generativelanguage.googleapis.com/v1beta/models/"
            f"gemini-embedding-001:embedContent?key={key}"
        )
        payload = {
            "model": "models/gemini-embedding-001",
            "content": {"parts": [{"text": text}]},
            "taskType": task_type,
            "outputDimensionality": 768
        }
        response = requests.post(url, json=payload)
        if response.status_code == 429:
            key_pool.mark_429("gemini", key)
            continue
        response.raise_for_status()
        return response.json()["embedding"]["values"]
    raise NoAvailableKeyError("All Gemini keys are cooling down. Try in 60s.")


def embed_texts(texts: List[str]) -> List[List[float]]:
    """Batch embed all texts in a single API call with key pool rotation."""
    for attempt in range(4):
        key = key_pool.get_key("gemini")
        url = (
            f"https://generativelanguage.googleapis.com/v1beta/models/"
            f"gemini-embedding-001:batchEmbedContents?key={key}"
        )
        reqs = [
            {
                "model": "models/gemini-embedding-001",
                "content": {"parts": [{"text": t}]},
                "taskType": "retrieval_document",
                "outputDimensionality": 768
            }
            for t in texts
        ]
        response = requests.post(url, json={"requests": reqs})
        if response.status_code == 429:
            key_pool.mark_429("gemini", key)
            continue
        response.raise_for_status()
        return [e["values"] for e in response.json()["embeddings"]]
    raise NoAvailableKeyError("All Gemini keys are cooling down. Try in 60s.")


def embed_query(query: str) -> List[float]:
    """Embed a single query string with retrieval_query task type."""
    return embed_single(query, task_type="retrieval_query")


# ── Storage ───────────────────────────────────────────────────────────────────

def store_chunks(chunks: List[Dict], source_file: str, session_id: str) -> int:
    """Embed and upsert chunks into Pinecone with metadata."""
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

    batch_size = 100
    for i in range(0, len(vectors), batch_size):
        index.upsert(vectors=vectors[i:i + batch_size])

    return len(vectors)


# ── Retrieval ─────────────────────────────────────────────────────────────────

def query_index(query: str, session_id: str, top_k: int = 20) -> List[Dict]:
    """
    Embed query, retrieve top_k chunks from Pinecone, apply source weighting.

    Source weighting rationale:
    - Jira tickets and transcripts are more information-dense than Slack messages
    - Without weighting, high-volume Slack uploads dominate retrieval
    - Weighting re-scores post-retrieval — does not affect what Pinecone fetches,
      only how we rank before passing to the re-ranker in llm.py
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
        source_type = meta.get("source_type", "unknown").lower()
        raw_score = match.get("score", 0)

        # Apply source weight to cosine score
        weight = SOURCE_WEIGHTS.get(source_type, 1.0)
        weighted_score = round(raw_score * weight, 4)

        chunks.append({
            "score":       weighted_score,
            "raw_score":   round(raw_score, 3),
            "text":        meta.get("original_text", ""),
            "source_file": meta.get("source_file", ""),
            "source_type": source_type,
            "author":      meta.get("author", ""),
            "timestamp":   meta.get("timestamp", ""),
            "issue_type":  meta.get("issue_type", ""),
        })

    # Re-sort by weighted score before passing to re-ranker
    chunks.sort(key=lambda x: x["score"], reverse=True)

    return chunks


# ── Clustering fetch ──────────────────────────────────────────────────────────

def fetch_session_vectors(session_id: str) -> List[Dict]:
    """Fetch all vectors for a session from Pinecone for clustering."""
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
        batch = all_ids[i:i + 100]
        fetched = index.fetch(ids=batch)
        for vid, vdata in fetched.vectors.items():
            results.append({
                "id":       vid,
                "values":   vdata.values,
                "metadata": dict(vdata.metadata)
            })

    return results
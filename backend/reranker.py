import os
import logging
import requests
from typing import List, Dict

logger = logging.getLogger(__name__)


COHERE_API_KEY = os.environ.get("COHERE_API_KEY")
COHERE_RERANK_URL = "https://api.cohere.com/v1/rerank"
COHERE_MODEL = "rerank-english-v3.0"
MAX_CHUNK_CHARS = 512  # Truncate chunks before sending to Cohere


def rerank_chunks(query: str, chunks: List[Dict], top_n: int = 5) -> List[Dict]:
    print(f"RERANKER CALLED: {len(chunks)} chunks received")  # temp debug
    
    if not chunks:
        return chunks

    if len(chunks) <= top_n:
        return chunks[:top_n]

    if not COHERE_API_KEY:
        logger.warning("COHERE_API_KEY not set — skipping rerank, using weighted cosine order")
        return chunks[:top_n]

    try:
        import requests

        # Truncate each chunk to 512 chars — enough for relevance scoring
        documents = [chunk["text"][:MAX_CHUNK_CHARS] for chunk in chunks]

        payload = {
            "model": COHERE_MODEL,
            "query": query,
            "documents": documents,
            "top_n": top_n,
            "return_documents": False  # We already have the chunks, don't need them back
        }

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {COHERE_API_KEY}",
            "X-Client-Name": "filtr"
        }

        response = requests.post(
            COHERE_RERANK_URL,
            json=payload,
            headers=headers,
            timeout=10  # Cohere is fast — 10s is generous
        )

        if response.status_code == 429:
            logger.warning("Cohere rate limit hit — falling back to weighted cosine order")
            return chunks[:top_n]

        if response.status_code != 200:
            logger.warning(f"Cohere returned {response.status_code} — falling back to weighted cosine order")
            return chunks[:top_n]

        results = response.json().get("results", [])

        if not results:
            logger.warning("Cohere returned empty results — falling back")
            return chunks[:top_n]

        # results = [{"index": original_chunk_index, "relevance_score": float}, ...]
        # Map back to original chunks using the index Cohere returns
        reranked = []
        for result in results:
            original_index = result["index"]
            chunk = chunks[original_index].copy()
            chunk["rerank_score"] = round(result["relevance_score"], 4)
            reranked.append(chunk)

        logger.info(f"Cohere rerank successful — {len(chunks)} → top {len(reranked)} chunks")

        # Log before/after for local validation
        logger.info("=== RERANK DEBUG ===")
        logger.info(f"Query: {query}")
        for i, chunk in enumerate(reranked):
            logger.info(
                f"  Rank {i+1} | rerank={chunk.get('rerank_score')} | "
                f"cosine={chunk.get('score')} | source={chunk.get('source_type')} | "
                f"text={chunk['text'][:80]}..."
            )

        return reranked

    except requests.exceptions.Timeout:
        logger.warning("Cohere request timed out — falling back to weighted cosine order")
        return chunks[:top_n]

    except Exception as e:
        logger.warning(f"Cohere rerank failed ({e}) — falling back to weighted cosine order")
        return chunks[:top_n]
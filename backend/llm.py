import os
import re
import json
import requests
from typing import List, Dict
from key_pool import key_pool, NoAvailableKeyError

# ── Prompts ───────────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are a strict evidence-based assistant helping a Product Manager analyze uploaded data.

HARD RULES — NO EXCEPTIONS:
1. Answer ONLY using the RETRIEVED CHUNKS provided below. Nothing else.
2. If the chunks do not contain sufficient information, respond with EXACTLY this sentence: "The uploaded data doesn't contain enough information to answer this question."
3. Do NOT infer, generalize, extrapolate, or use any knowledge outside the provided chunks.
4. Do NOT combine partial evidence to reach conclusions not explicitly stated in the chunks.
5. Every insight MUST cite its chunk number as [CHUNK N].
6. Indicate the source type for every point: (Slack), (Jira), or (Transcript).
7. If only partial information exists, state what IS found and explicitly say what is missing.
8. Be concise and structured. Use bullet points for multiple insights.

VIOLATION CHECK: Before responding, ask yourself — "Is every sentence I am writing directly supported by a specific chunk?" If no, remove it."""

RERANK_SYSTEM_PROMPT = """You are a relevance scoring engine. You will be given a query and a list of text chunks.
Score each chunk from 0-10 based on how directly it answers the query.
- 10: Directly and completely answers the query
- 7-9: Highly relevant, contains key information
- 4-6: Partially relevant, tangentially related
- 1-3: Minimally relevant
- 0: Completely irrelevant

Return ONLY a JSON array. No explanation. No markdown. No preamble.
Format: [{"chunk_id": 1, "score": 8}, {"chunk_id": 2, "score": 3}, ...]"""

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL = "llama-3.3-70b-versatile"

# ── Private: Re-ranker ────────────────────────────────────────────────────────

def _rerank_chunks(query: str, chunks: List[Dict], top_n: int = 5) -> List[Dict]:
    """
    Re-rank retrieved chunks by relevance to query using GroQ.
    Falls back to cosine order (top_n) if JSON parse fails.
    """
    if len(chunks) <= top_n:
        return chunks

    # Build chunk list for scoring
    chunk_descriptions = []
    for i, chunk in enumerate(chunks, 1):
        chunk_descriptions.append(f'[CHUNK {i}]: "{chunk["text"][:200]}"')

    rerank_prompt = f"""Query: "{query}"

Chunks to score:
{chr(10).join(chunk_descriptions)}

Return JSON array of scores for all {len(chunks)} chunks."""

    payload = {
        "model": GROQ_MODEL,
        "messages": [
            {"role": "system", "content": RERANK_SYSTEM_PROMPT},
            {"role": "user", "content": rerank_prompt}
        ],
        "temperature": 0.0,
        "max_tokens": 512,
    }

    for attempt in range(3):
        try:
            key = key_pool.get_key("groq")
            headers = {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {key}"
            }
            response = requests.post(GROQ_URL, json=payload, headers=headers, timeout=30)

            if response.status_code == 429:
                key_pool.mark_429("groq", key)
                continue

            response.raise_for_status()
            raw = response.json()["choices"][0]["message"]["content"].strip()

            # Strip markdown fences if present
            raw = re.sub(r"```json|```", "", raw).strip()
            scores = json.loads(raw)

            # Map scores back to chunks and sort
            score_map = {item["chunk_id"]: item["score"] for item in scores}
            ranked = sorted(chunks, key=lambda c, i=0: score_map.get(
                chunks.index(c) + 1, 0), reverse=True)
            return ranked[:top_n]

        except (json.JSONDecodeError, KeyError, Exception):
            continue

    # Fallback: return top_n by original cosine order
    return chunks[:top_n]


# ── Private: Answer generator ─────────────────────────────────────────────────

def _generate_answer(query: str, chunks: List[Dict]) -> str:
    """
    Generate grounded answer from re-ranked chunks using GroQ.
    """
    if not chunks:
        return "No relevant context found in your uploaded files for this query. Try rephrasing or uploading more data."

    # Build context string
    context_parts = []
    for i, chunk in enumerate(chunks, 1):
        source_label = f"[{chunk['source_type'].upper()}] {chunk['source_file']}"
        context_parts.append(f"[CHUNK {i}] Source: {source_label}\n\"{chunk['text']}\"")

    context_str = "\n\n".join(context_parts)

    prompt = f"""Retrieved chunks (use ONLY these to answer):
---
{context_str}
---

PM Question: {query}

REMINDER: Answer ONLY from the chunks above. Every point must cite [CHUNK N]. If the answer is not in the chunks, say exactly: "The uploaded data doesn't contain enough information to answer this question."

Answer:"""

    payload = {
        "model": GROQ_MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt}
        ],
        "temperature": 0.1,
        "max_tokens": 1024,
    }

    for attempt in range(3):
        try:
            key = key_pool.get_key("groq")
            headers = {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {key}"
            }
            response = requests.post(GROQ_URL, json=payload, headers=headers, timeout=45)

            if response.status_code == 429:
                key_pool.mark_429("groq", key)
                continue

            response.raise_for_status()
            return response.json()["choices"][0]["message"]["content"]

        except Exception:
            continue

    raise NoAvailableKeyError("All GroQ keys are cooling down. Try in 60s.")


# ── Public API ────────────────────────────────────────────────────────────────

def get_answer(query: str, chunks: List[Dict]) -> str:
    """
    Public function called by main.py.
    Internally: re-ranks chunks → generates grounded answer.
    """
    top_chunks = _rerank_chunks(query, chunks, top_n=5)
    return _generate_answer(query, top_chunks)
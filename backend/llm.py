import os
import requests
from typing import List, Dict
from key_pool import key_pool, NoAvailableKeyError
from reranker import rerank_chunks

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

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL = "llama-3.3-70b-versatile"


# ── Private: Answer generator ─────────────────────────────────────────────────

def _generate_answer(query: str, chunks: List[Dict]) -> str:
    """
    Generate grounded answer from reranked chunks using GroQ.
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
    Reranks chunks via Cohere → generates grounded answer via GroQ.
    """
    top_chunks = rerank_chunks(query, chunks, top_n=5)
    return _generate_answer(query, top_chunks)
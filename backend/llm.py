import os
import requests
from typing import List, Dict
from key_pool import key_pool, NoAvailableKeyError

SYSTEM_PROMPT = """You are an assistant helping a Product Manager analyze user feedback.
The PM has uploaded their Slack messages, Jira tickets, and call transcripts.
Answer their question using ONLY the retrieved context below.
Do not make up issues or trends not present in the context.
Always indicate which source each insight comes from (Slack, Jira, or Transcript).
Be concise and structured. Use bullet points when listing multiple issues.
If the context does not contain enough information to answer, say so clearly."""

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL = "llama-3.3-70b-versatile"

def generate_answer(query: str, chunks: List[Dict]) -> str:
    """
    Generate answer using GroQ (Llama 3.3 70B) with key pool rotation.
    Falls back across all GroQ keys before raising NoAvailableKeyError.
    """
    if not chunks:
        return "No relevant context found in your uploaded files for this query. Try rephrasing or uploading more data."

    # Build context string
    context_parts = []
    for i, chunk in enumerate(chunks, 1):
        source_label = f"[{chunk['source_type'].upper()}] {chunk['source_file']}"
        context_parts.append(f"[CHUNK {i}] Source: {source_label}\n\"{chunk['text']}\"")

    context_str = "\n\n".join(context_parts)

    prompt = f"""Retrieved context:
---
{context_str}
---

PM Question: {query}

Answer:"""

    payload = {
        "model": GROQ_MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt}
        ],
        "temperature": 0.3,
        "max_tokens": 1024,
    }

    for attempt in range(3):
        key = key_pool.get_key("groq")
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {key}"
        }
        response = requests.post(GROQ_URL, json=payload, headers=headers)

        if response.status_code == 429:
            key_pool.mark_429("groq", key)
            continue

        response.raise_for_status()
        return response.json()["choices"][0]["message"]["content"]

    raise NoAvailableKeyError("All GroQ keys are cooling down. Try in 60s.")
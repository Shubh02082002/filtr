import os
import requests
from typing import List, Dict

SYSTEM_PROMPT = """You are an assistant helping a Product Manager analyze user feedback.
The PM has uploaded their Slack messages, Jira tickets, and call transcripts.
Answer their question using ONLY the retrieved context below.
Do not make up issues or trends not present in the context.
Always indicate which source each insight comes from (Slack, Jira, or Transcript).
Be concise and structured. Use bullet points when listing multiple issues.
If the context does not contain enough information to answer, say so clearly."""

def generate_answer(query: str, chunks: List[Dict]) -> str:
    """
    Build a prompt from retrieved chunks and generate an answer using Gemini Flash via REST.
    """
    if not chunks:
        return "No relevant context found in your uploaded files for this query. Try rephrasing or uploading more data."

    # Build context string from chunks
    context_parts = []
    for i, chunk in enumerate(chunks, 1):
        source_label = f"[{chunk['source_type'].upper()}] {chunk['source_file']}"
        context_parts.append(f"[CHUNK {i}] Source: {source_label}\n\"{chunk['text']}\"")

    context_str = "\n\n".join(context_parts)

    prompt = f"""{SYSTEM_PROMPT}

Retrieved context:
---
{context_str}
---

PM Question: {query}

Answer:"""

    api_key = os.environ["GEMINI_API_KEY"]
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={api_key}"

    payload = {
        "contents": [
            {"role": "user", "parts": [{"text": prompt}]}
        ],
        "generationConfig": {
            "temperature": 0.3,
            "maxOutputTokens": 1024,
        }
    }

    response = requests.post(url, json=payload)
    response.raise_for_status()

    data = response.json()
    return data["candidates"][0]["content"]["parts"][0]["text"]

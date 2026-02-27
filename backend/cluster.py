import os
import re
import json
import numpy as np
import requests
from sklearn.cluster import KMeans
from typing import List, Dict
from vector_store import fetch_session_vectors
from key_pool import key_pool, NoAvailableKeyError

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL = "llama-3.3-70b-versatile"


def name_clusters_with_llm(cluster_excerpts: List[List[str]]) -> List[str]:
    prompt = "You are analysing user feedback for a product team.\n\n"
    prompt += "Below are groups of user feedback excerpts. Each group is a cluster of related issues.\n"
    prompt += "For each group, generate a short specific issue theme name (3-6 words, title case).\n"
    prompt += "Respond ONLY with a JSON array of strings. No explanation. No markdown.\n\n"
    for i, excerpts in enumerate(cluster_excerpts):
        prompt += f"Group {i+1}:\n"
        for e in excerpts:
            prompt += f"  - {e[:60]}\n"
        prompt += "\n"

    payload = {
        "model": GROQ_MODEL,
        "messages": [
            {"role": "system", "content": "You are a product analytics assistant. Respond only with valid JSON arrays."},
            {"role": "user", "content": prompt}
        ],
        "temperature": 0.2,
        "max_tokens": 1025,
    }

    n = len(cluster_excerpts)

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
        raw = response.json()["choices"][0]["message"]["content"]

        match = re.search(r'\[.*\]', raw, re.DOTALL)
        if not match:
            salvaged = re.findall(r'"([^"]+)"', raw)
            if salvaged:
                return (salvaged + [f"Theme {i+1}" for i in range(n)])[:n]
            continue

        try:
            names = json.loads(match.group())
            return (names + [f"Theme {i+1}" for i in range(n)])[:n]
        except json.JSONDecodeError:
            salvaged = re.findall(r'"([^"]+)"', raw)
            return (salvaged + [f"Theme {i+1}" for i in range(n)])[:n]

    # All retries exhausted
    return [f"Theme {i+1}" for i in range(n)]


def run_clustering(session_id: str, n_clusters: int = 5) -> List[Dict]:
    vectors = fetch_session_vectors(session_id)
    if not vectors:
        return []

    n_clusters = min(n_clusters, max(2, len(vectors)))
    matrix = np.array([v["values"] for v in vectors], dtype="float32")
    metadata = [v["metadata"] for v in vectors]

    km = KMeans(n_clusters=n_clusters, random_state=42, n_init="auto")
    labels = km.fit_predict(matrix)

    cluster_data = []
    for cluster_idx in range(n_clusters):
        member_indices = np.where(labels == cluster_idx)[0]
        if len(member_indices) == 0:
            continue

        centroid = km.cluster_centers_[cluster_idx]
        member_vectors = matrix[member_indices]
        norms = np.linalg.norm(member_vectors, axis=1, keepdims=True)
        norms[norms == 0] = 1
        normalised = member_vectors / norms
        centroid_norm = centroid / (np.linalg.norm(centroid) + 1e-9)
        similarities = normalised @ centroid_norm
        top3_local = np.argsort(similarities)[::-1][:3]
        top3_global = member_indices[top3_local]

        excerpts = [metadata[i].get("original_text", "")[:100] for i in top3_global]
        sources = {"slack": 0, "jira": 0, "transcript": 0}
        for i in member_indices:
            st = metadata[i].get("source_type", "unknown").lower()
            if st in sources:
                sources[st] += 1

        cluster_data.append({
            "cluster_idx": cluster_idx,
            "count": int(len(member_indices)),
            "excerpts": excerpts,
            "sources": sources,
            "name": None
        })

    cluster_data.sort(key=lambda x: x["count"], reverse=True)
    all_excerpts = [c["excerpts"] for c in cluster_data]
    names = name_clusters_with_llm(all_excerpts)

    for i, c in enumerate(cluster_data):
        c["name"] = names[i] if i < len(names) else f"Theme {i+1}"

    return cluster_data
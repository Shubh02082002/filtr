import os
import re
import json
import time
import numpy as np
import requests
from sklearn.cluster import KMeans
from typing import List, Dict
from vector_store import fetch_session_vectors


def get_api_key():
    return os.environ["GEMINI_API_KEY"]


def name_clusters_with_llm(cluster_excerpts: List[List[str]]) -> List[str]:
    api_key = get_api_key()
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={api_key}"
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
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.2, "maxOutputTokens": 1025}
    }

    for attempt in range(3):
        response = requests.post(url, json=payload)
        if response.status_code == 429:
            wait = 30 * (attempt + 1)
            time.sleep(wait)
            continue
        response.raise_for_status()
        raw = response.json()["candidates"][0]["content"]["parts"][0]["text"]
        match = re.search(r'\[.*\]', raw, re.DOTALL)
        if not match:
            salvaged = re.findall(r'"([^"]+)"', raw)
            if salvaged:
                n = len(cluster_excerpts)
                return (salvaged + [f"Theme {i+1}" for i in range(n)])[:n]
            raise ValueError(f"No JSON array found in LLM response: {repr(raw)}")
        try:
            names = json.loads(match.group())
        except json.JSONDecodeError:
            salvaged = re.findall(r'"([^"]+)"', raw)
            n = len(cluster_excerpts)
            return (salvaged + [f"Theme {i+1}" for i in range(n)])[:n]
        n = len(cluster_excerpts)
        names = (names + [f"Theme {i+1}" for i in range(n)])[:n]
        return names

    # All retries exhausted - return fallback names
    n = len(cluster_excerpts)
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
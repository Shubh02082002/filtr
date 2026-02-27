import re
import json
import numpy as np
import requests
from sklearn.cluster import KMeans
from typing import List, Dict, Tuple
from vector_store import fetch_session_vectors
from key_pool import key_pool, NoAvailableKeyError

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL = "llama-3.3-70b-versatile"


# ── Dynamic K selection ───────────────────────────────────────────────────────

def _compute_dynamic_k(n_chunks: int, n_unique_files: int) -> int:
    """Compute optimal K based on chunk count and file diversity."""
    if n_unique_files == 1:
        return 3  # Single file — cap at 3 to avoid redundant clusters
    if n_chunks < 20:
        return 3
    elif n_chunks <= 50:
        return 5
    elif n_chunks <= 100:
        return 7
    else:
        return 10


# ── Deduplication ─────────────────────────────────────────────────────────────

def _deduplicate_vectors(vectors: List[Dict]) -> List[Dict]:
    """
    Remove exact and near-duplicate chunks before clustering.
    Exact: same first 100 chars hash.
    Near: same source file + text overlap > 80%.
    """
    seen_hashes = set()
    deduplicated = []

    for v in vectors:
        text = v["metadata"].get("original_text", "")
        fingerprint = text[:100].strip().lower()

        if fingerprint in seen_hashes:
            continue

        # Near-duplicate check against already accepted chunks from same file
        is_near_dupe = False
        source_file = v["metadata"].get("source_file", "")
        for accepted in deduplicated:
            if accepted["metadata"].get("source_file", "") != source_file:
                continue
            accepted_text = accepted["metadata"].get("original_text", "")
            # Simple overlap: check if 80%+ of words are shared
            words_new = set(text.lower().split())
            words_old = set(accepted_text.lower().split())
            if not words_new or not words_old:
                continue
            overlap = len(words_new & words_old) / max(len(words_new), len(words_old))
            if overlap > 0.8:
                is_near_dupe = True
                break

        if not is_near_dupe:
            seen_hashes.add(fingerprint)
            deduplicated.append(v)

    return deduplicated


# ── Source oversampling ───────────────────────────────────────────────────────

def _oversample_minority_sources(
    vectors: List[Dict],
    matrix: np.ndarray
) -> Tuple[List[Dict], np.ndarray]:
    """
    If any source type has < 10% of total chunks, duplicate its vectors 2x
    so KMeans doesn't ignore minority sources.
    Duplicates are tagged and removed from final output.
    """
    total = len(vectors)
    source_counts = {}
    for v in vectors:
        st = v["metadata"].get("source_type", "unknown")
        source_counts[st] = source_counts.get(st, 0) + 1

    extra_vectors = []
    extra_rows = []

    for i, v in enumerate(vectors):
        st = v["metadata"].get("source_type", "unknown")
        if source_counts[st] / total < 0.10:
            tagged = {**v, "_oversampled": True}
            extra_vectors.append(tagged)
            extra_rows.append(matrix[i])

    if extra_vectors:
        augmented_vectors = vectors + extra_vectors
        augmented_matrix = np.vstack([matrix, np.array(extra_rows)])
        return augmented_vectors, augmented_matrix

    return vectors, matrix


# ── Cluster representative selection ─────────────────────────────────────────

def _get_cluster_representatives(
    cluster_indices: np.ndarray,
    matrix: np.ndarray,
    metadata: List[Dict],
    centroid: np.ndarray,
    top_n: int = 5
) -> Tuple[List[str], str]:
    """
    Find top_n chunks closest to centroid.
    Determine if cluster is homogeneous or mixed.
    Returns (excerpts_for_naming, cluster_type).
    """
    member_vectors = matrix[cluster_indices]
    norms = np.linalg.norm(member_vectors, axis=1, keepdims=True)
    norms[norms == 0] = 1
    normalised = member_vectors / norms
    centroid_norm = centroid / (np.linalg.norm(centroid) + 1e-9)
    similarities = normalised @ centroid_norm

    # Get top_n closest to centroid
    top_local = np.argsort(similarities)[::-1][:top_n]
    top_global = cluster_indices[top_local]

    # Check source diversity among top_n
    files = [metadata[i].get("source_file", "") for i in top_global]
    unique_files = set(files)
    dominant_file = max(set(files), key=files.count)
    dominant_count = files.count(dominant_file)

    if dominant_count >= 4:
        # Homogeneous — use only dominant file chunks
        cluster_type = "homogeneous"
        excerpts = [
            metadata[i].get("original_text", "")[:120]
            for i in top_global
            if metadata[i].get("source_file", "") == dominant_file
        ][:3]
    else:
        # Mixed — use top chunks from all represented files
        cluster_type = "mixed"
        excerpts = [metadata[i].get("original_text", "")[:120] for i in top_global][:5]

    return excerpts, cluster_type


# ── Cluster naming ────────────────────────────────────────────────────────────

def _build_naming_prompt_attempt1(
    cluster_excerpts: List[List[str]],
    cluster_types: List[str]
) -> str:
    prompt = "You are analysing user feedback for a product team.\n\n"
    prompt += "Below are groups of feedback excerpts. Each group is a cluster of related issues.\n"
    prompt += "For each group, generate a short specific issue theme name (3-6 words, title case).\n"
    prompt += "If a group is marked MIXED, name the common theme across all excerpts, not individual sources.\n"
    prompt += "Respond ONLY with a JSON array of strings. No explanation. No markdown. No preamble.\n"
    prompt += f"You MUST return exactly {len(cluster_excerpts)} strings in the array.\n\n"

    for i, (excerpts, ctype) in enumerate(zip(cluster_excerpts, cluster_types)):
        label = "MIXED" if ctype == "mixed" else "FOCUSED"
        prompt += f"Group {i+1} [{label}]:\n"
        for e in excerpts:
            prompt += f"  - {e}\n"
        prompt += "\n"

    return prompt


def _build_naming_prompt_attempt2(
    cluster_excerpts: List[List[str]]
) -> str:
    """Completely different framing — problem question instead of naming task."""
    prompt = "For each group of user quotes below, answer: what is the single biggest problem the user is experiencing?\n"
    prompt += "Give a 3-6 word answer in title case for each group.\n"
    prompt += "Return ONLY a JSON array of strings. Nothing else. No markdown.\n"
    prompt += f"Array must have exactly {len(cluster_excerpts)} items.\n\n"

    for i, excerpts in enumerate(cluster_excerpts):
        prompt += f"Group {i+1}:\n"
        for e in excerpts:
            prompt += f"  - {e}\n"
        prompt += "\n"

    return prompt


def _parse_names_from_response(raw: str, n: int) -> List[str] | None:
    """Try to extract a valid JSON array of n strings from GroQ response."""
    raw = re.sub(r"```json|```", "", raw).strip()
    match = re.search(r'\[.*\]', raw, re.DOTALL)
    if not match:
        return None
    try:
        names = json.loads(match.group())
        if isinstance(names, list) and len(names) >= n:
            return [str(name) for name in names[:n]]
        return None
    except json.JSONDecodeError:
        return None


def _name_clusters(
    cluster_excerpts: List[List[str]],
    cluster_types: List[str]
) -> List[str]:
    """
    Two-attempt naming with completely different prompts.
    Falls back to 'Unclassified Theme N' if both fail.
    """
    n = len(cluster_excerpts)

    prompts = [
        ("attempt_1", _build_naming_prompt_attempt1(cluster_excerpts, cluster_types)),
        ("attempt_2", _build_naming_prompt_attempt2(cluster_excerpts)),
    ]

    for attempt_label, prompt in prompts:
        payload = {
            "model": GROQ_MODEL,
            "messages": [
                {
                    "role": "system",
                    "content": "You are a product analytics assistant. Respond only with valid JSON arrays. No markdown. No explanation."
                },
                {"role": "user", "content": prompt}
            ],
            "temperature": 0.2 if attempt_label == "attempt_1" else 0.0,
            "max_tokens": 512,
        }

        for _ in range(2):  # 2 key rotations per attempt
            try:
                key = key_pool.get_key("groq")
                headers = {
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {key}"
                }
                response = requests.post(
                    GROQ_URL, json=payload, headers=headers, timeout=30
                )

                if response.status_code == 429:
                    key_pool.mark_429("groq", key)
                    continue

                response.raise_for_status()
                raw = response.json()["choices"][0]["message"]["content"]
                names = _parse_names_from_response(raw, n)

                if names:
                    return names

            except Exception:
                continue

    # Both attempts failed
    return [f"Unclassified Theme {i+1}" for i in range(n)]


# ── Duplicate name detection ──────────────────────────────────────────────────

def _flag_duplicate_names(names: List[str]) -> List[str]:
    """
    If two cluster names share 3+ consecutive words, the second one
    is likely a near-duplicate cluster. Flag it as Unclassified.
    """
    result = list(names)
    for i in range(len(result)):
        for j in range(i + 1, len(result)):
            words_i = result[i].lower().split()
            words_j = result[j].lower().split()
            # Check for 3+ consecutive word overlap
            consecutive = 0
            max_consecutive = 0
            for w in words_i:
                if w in words_j:
                    consecutive += 1
                    max_consecutive = max(max_consecutive, consecutive)
                else:
                    consecutive = 0
            if max_consecutive >= 3:
                result[j] = f"Unclassified Theme {j+1}"
    return result


# ── Minimum cluster size guard ────────────────────────────────────────────────

def _merge_tiny_clusters(
    labels: np.ndarray,
    matrix: np.ndarray,
    centroids: np.ndarray,
    min_size: int = 3
) -> np.ndarray:
    """
    Merge clusters with fewer than min_size members into nearest centroid neighbor.
    Returns updated labels array.
    """
    labels = labels.copy()
    n_clusters = len(centroids)

    for cluster_idx in range(n_clusters):
        member_count = np.sum(labels == cluster_idx)
        if 0 < member_count < min_size:
            # Find nearest other centroid
            distances = []
            for other_idx in range(n_clusters):
                if other_idx == cluster_idx:
                    continue
                dist = np.linalg.norm(centroids[cluster_idx] - centroids[other_idx])
                distances.append((dist, other_idx))
            distances.sort()
            nearest = distances[0][1]
            # Reassign members to nearest cluster
            labels[labels == cluster_idx] = nearest

    return labels


# ── Main entry point ──────────────────────────────────────────────────────────

def run_clustering(session_id: str, n_clusters: int = 5) -> List[Dict]:
    # 1. Fetch and deduplicate
    vectors = fetch_session_vectors(session_id)
    if not vectors:
        return []

    vectors = _deduplicate_vectors(vectors)
    if not vectors:
        return []

    # 2. Compute dynamic K
    unique_files = set(v["metadata"].get("source_file", "") for v in vectors)
    k = _compute_dynamic_k(len(vectors), len(unique_files))
    k = min(k, max(2, len(vectors)))

    # 3. Build matrix
    matrix = np.array([v["values"] for v in vectors], dtype="float32")
    metadata = [v["metadata"] for v in vectors]

    # 4. Oversample minority sources
    aug_vectors, aug_matrix = _oversample_minority_sources(vectors, matrix)
    aug_metadata = [v["metadata"] for v in aug_vectors]

    # 5. KMeans on augmented matrix
    km = KMeans(n_clusters=k, random_state=42, n_init="auto")
    aug_labels = km.fit_predict(aug_matrix)

    # 6. Strip oversampled entries — only keep original indices
    original_count = len(vectors)
    labels = aug_labels[:original_count]

    # 7. Merge tiny clusters
    labels = _merge_tiny_clusters(labels, matrix, km.cluster_centers_)

    # 8. Build cluster data
    cluster_data = []
    active_clusters = sorted(set(labels))

    for cluster_idx in active_clusters:
        member_indices = np.where(labels == cluster_idx)[0]
        if len(member_indices) == 0:
            continue

        centroid = km.cluster_centers_[cluster_idx]
        excerpts, cluster_type = _get_cluster_representatives(
            member_indices, matrix, metadata, centroid
        )

        sources = {"slack": 0, "jira": 0, "transcript": 0}
        for i in member_indices:
            st = metadata[i].get("source_type", "unknown").lower()
            if st in sources:
                sources[st] += 1

        cluster_data.append({
            "cluster_idx": int(cluster_idx),
            "count": int(len(member_indices)),
            "excerpts": [metadata[i].get("original_text", "")[:100]
                        for i in member_indices[:3]],
            "sources": sources,
            "cluster_type": cluster_type,
            "naming_excerpts": excerpts,
            "name": None
        })

    # 9. Sort by size
    cluster_data.sort(key=lambda x: x["count"], reverse=True)

    # 10. Name clusters
    all_excerpts = [c["naming_excerpts"] for c in cluster_data]
    all_types = [c["cluster_type"] for c in cluster_data]
    names = _name_clusters(all_excerpts, all_types)

    # 11. Flag duplicate names
    names = _flag_duplicate_names(names)

    # 12. Assign names and clean up internal fields
    for i, c in enumerate(cluster_data):
        c["name"] = names[i] if i < len(names) else f"Unclassified Theme {i+1}"
        del c["naming_excerpts"]
        del c["cluster_type"]

    return cluster_data
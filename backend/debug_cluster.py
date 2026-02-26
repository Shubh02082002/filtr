
from dotenv import load_dotenv
load_dotenv()
import os, requests, numpy as np, json
from sklearn.cluster import KMeans
from vector_store import fetch_session_vectors

session_id = '9a2ba74499544b68baeda3972dd63e72'
vectors = fetch_session_vectors(session_id)
print(f'Fetched {len(vectors)} vectors')
if not vectors:
    print('No vectors found. Re-upload mock data first.')
    exit()

n = min(5, max(2, len(vectors)))
matrix = np.array([v['values'] for v in vectors], dtype='float32')
meta = [v['metadata'] for v in vectors]
km = KMeans(n_clusters=n, random_state=42, n_init='auto')
labels = km.fit_predict(matrix)
print(f'Clusters: {set(labels)}')

excerpts_per_cluster = []
for ci in range(n):
    idx = np.where(labels == ci)[0]
    c = km.cluster_centers_[ci]
    mv = matrix[idx]
    norms = np.linalg.norm(mv, axis=1, keepdims=True)
    norms[norms == 0] = 1
    sims = (mv / norms) @ (c / (np.linalg.norm(c) + 1e-9))
    top3 = idx[np.argsort(sims)[::-1][:3]]
    excerpts_per_cluster.append([meta[i].get('original_text', '')[:200] for i in top3])

prompt = 'Analyse these user feedback groups and name each theme (3-6 words, title case).\nRespond ONLY with a JSON array of strings. No markdown. No explanation.\n\n'
for i, ex in enumerate(excerpts_per_cluster):
    prompt += f'Group {i+1}:\n'
    for e in ex:
        prompt += f'  - {e}\n'
    prompt += '\n'

api_key = os.environ['GEMINI_API_KEY']
url = f'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={api_key}'
r = requests.post(url, json={
    'contents': [{'role': 'user', 'parts': [{'text': prompt}]}],
    'generationConfig': {'temperature': 0.2, 'maxOutputTokens': 256}
})
raw = r.json()['candidates'][0]['content']['parts'][0]['text']
print('RAW GEMINI RESPONSE:')
print(repr(raw))

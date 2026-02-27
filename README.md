# Filtr

**AI that filters your Slack, Jira, and transcript noise into ranked, actionable user insight.**

Upload messy multi-source PM data. Get auto-clustered issue summaries and natural language answers — without reading everything manually.

🔗 **Live:** [filtr-omega.vercel.app](https://filtr-omega.vercel.app)

---

## What It Does

PMs spend 3-6 hours a week manually synthesising user feedback across Slack, Jira, and call transcripts. Filtr cuts that to minutes.

**Upload → Auto-cluster → Query**

1. Drop in your Slack export (JSON), Jira CSV, or call transcripts (PDF/TXT)
2. Filtr automatically surfaces your **top 5 issue clusters** — no query needed
3. Ask natural language questions to go deeper. Get sourced, cited answers.

No setup. No SQL. No pivot tables.

---

## Demo

Upload the included mock files to try it without your own data:
- `slack_export_mock.json` — sample Slack export
- `jira_export_mock.csv` — sample Jira board
- `transcript_mock.txt` — sample customer call transcript

Sample queries that work well:
- *"What are the most common issues users report?"*
- *"What bugs are blocking users from completing checkout?"*
- *"What features are users requesting most?"*
- *"What onboarding problems are users experiencing?"*

---

## How It Works

```
Upload files
    ↓
Parse → chunk by source type (Slack / Jira / Transcript)
    ↓
Batch embed all chunks → Gemini embedding-001 (768 dims)
    ↓
Store in Pinecone vector index (session-scoped)
    ↓
KMeans clustering on stored embeddings (K=5)
    ↓
Single LLM call → GroQ (Llama 3.3 70B) names all 5 clusters
    ↓
PM sees: ranked clusters + query interface
    ↓
Query → embed → cosine search → GroQ generates sourced answer
```

**Key constraint:** Everything runs on free tiers. Zero spend before validation.

---

## Architecture

```
Frontend (Next.js + Tailwind → Vercel)
    │
    ├── POST /ingest    → parse + batchEmbed + store in Pinecone
    ├── POST /insights  → KMeans + LLM cluster naming
    └── POST /query     → embed query + similarity search + LLM answer

Backend (FastAPI → Render)
    │
    ├── key_pool.py     → Round-robin key rotation across 7 API keys
    ├── vector_store.py → Gemini embeddings (batch)
    ├── cluster.py      → KMeans + GroQ cluster naming
    └── llm.py          → GroQ query answering

Vector DB: Pinecone (768-dim cosine index, session-scoped)
```

### Rate Limit Strategy

Free Gemini tier = 15 RPM per account. At 5+ concurrent users, quota exhausts in seconds → 429 cascades → timeouts.

**Solution:** `KeyPoolManager` — 4 Gemini keys (4 separate Google accounts) + 3 GroQ keys (3 separate GroQ accounts). Round-robin rotation. On 429: mark key as cooling for 65s, skip to next key immediately. Effective capacity: 60 RPM for embeddings, 90 RPM for generation.

**Why separate accounts matter:** Rate limits are enforced at account level, not key level. 4 keys from 1 account = still 15 RPM. Separate accounts = independent quota pools.

---

## Key Technical Decisions

| Decision | Chosen | Rejected | Why |
|----------|--------|----------|-----|
| Embedding API | `batchEmbedContents` — 1 call for all chunks | `embedContent` per chunk | 1 RPM vs 30 RPM. 2s vs 3 mins. |
| Cluster naming | 1x GroQ call for all 5 clusters | 1x call per chunk | At 15 RPM, per-chunk = 20+ mins on real data |
| Clustering method | KMeans on existing embeddings | LLM category tagging per chunk | Zero extra API calls. Same outcome for distinct themes. |
| K value | Fixed K=5 | Dynamic elbow method | Simpler UX. Elbow deferred until cluster trust validated. |
| Generation provider | GroQ (Llama 3.3 70B) | Grok (xAI) | xAI requires paid credits. GroQ genuinely free. |
| SDK vs REST | Direct `requests` REST | `google-generativeai` SDK | SDK caused transport/compatibility issues on Render free tier. |
| JSON parsing | Greedy regex + try/except fallback | Non-greedy regex | Resilient to LLM response truncation. |
| Query cap | 4 queries/session (in-memory) | No cap | Prevents single-user quota abuse during beta. |

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | Next.js 14, Tailwind CSS |
| Backend | FastAPI (Python) |
| Embeddings | Gemini `embedding-001` (768 dims) via REST |
| Generation | GroQ `llama-3.3-70b-versatile` via REST |
| Vector DB | Pinecone (free starter, cosine similarity) |
| Deploy — frontend | Vercel |
| Deploy — backend | Render (free tier, port 10000) |
| Keepalive | cron-job.org pinging `/health` every 14 mins |

---

## Local Setup

### Prerequisites
- Python 3.10+
- Node.js 18+
- Pinecone account (free) — create index named `pmsignal`, 768 dims, cosine, AWS us-east-1
- 1+ Gemini API key from [aistudio.google.com](https://aistudio.google.com)
- 1+ GroQ API key from [console.groq.com](https://console.groq.com)

### Backend

```powershell
cd backend
python -m venv venv
.\venv\Scripts\Activate.ps1       # Windows
# source venv/bin/activate         # Mac/Linux
pip install -r requirements.txt
```

Create `backend/.env`:
```
GEMINI_KEY_1=AIzaSy...
GEMINI_KEY_2=AIzaSy...            # optional — add more for higher throughput
GROQ_KEY_1=gsk_...
GROQ_KEY_2=gsk_...                # optional
PINECONE_API_KEY=...
PINECONE_INDEX_NAME=pmsignal
```

```powershell
uvicorn main:app --reload --port 8000
```

Verify: `http://localhost:8000/health` → all keys show `available: true`

### Frontend

```powershell
cd frontend
npm install
```

Create `frontend/.env.local`:
```
NEXT_PUBLIC_API_URL=http://localhost:8000
```

```powershell
npm run dev
```

Open: `http://localhost:3000`

### ⚠️ API Key Rules
- **Never commit `.env` or `.env.local`** — both are in `.gitignore`
- **Never expose keys in the browser** — Gemini auto-revokes keys found in Network tab or public GitHub
- **Separate Google accounts for each Gemini key** — keys from the same account share quota
- If a key is revoked: generate new key → update `.env` → update your hosting env vars

---

## Deployment

### Backend (Render)

1. Connect GitHub repo in Render dashboard
2. Root directory: `backend`
3. Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
4. Add all env vars from `.env` in Render → Environment
5. Health check URL: `https://your-app.onrender.com/health` (no trailing slash)

### Frontend (Vercel)

1. Connect GitHub repo in Vercel dashboard
2. Root directory: `frontend`
3. Add env var: `NEXT_PUBLIC_API_URL=https://your-render-url.onrender.com`

**Note:** Render free tier sleeps after 15 mins of inactivity. First load takes 60-120s. Set up a keepalive cron job hitting `/health` every 14 mins to avoid this.

---

## Limitations (Beta)

- **4 queries per session** — in-memory cap, resets on page refresh
- **Session data not persisted** — re-upload files each session
- **Cold start latency** — first load on Render free tier takes 60-120s
- **K=5 clusters fixed** — dynamic K based on data size is planned
- **No auth** — session-based only, no saved workspaces

---

## Roadmap

**V2.6 — Quality (next)**
- Stricter LLM prompt to reduce hallucination
- `top_k` 8 → 12 for better retrieval coverage
- Tighter cluster naming prompt to eliminate fallback "Theme 1" names
- Dynamic K selection based on chunk count

**V2.7 — Retrieval**
- Source-aware retrieval (Slack vs Jira vs Transcript weighted separately)
- Chunk quality filters (minimum length, overlap for transcripts)
- Re-ranking pass after cosine retrieval

**V3 — Integrations**
- Slack OAuth (no manual export)
- Jira API (no CSV download)
- Persistent workspaces + auth
- Scheduled weekly digests

---

## Project Structure

```
filtr/
├── backend/
│   ├── main.py              ← FastAPI app, endpoints, query cap
│   ├── key_pool.py          ← KeyPoolManager — rate limit rotation
│   ├── vector_store.py      ← Gemini batch embeddings + Pinecone
│   ├── cluster.py           ← KMeans + GroQ cluster naming
│   ├── llm.py               ← GroQ query answering
│   ├── parsers/
│   │   ├── slack_parser.py
│   │   ├── jira_parser.py
│   │   └── transcript_parser.py
│   └── requirements.txt
├── frontend/
│   ├── src/app/page.tsx     ← Full UI (upload, loading, query)
│   └── public/mock_data/    ← Sample files for testing
└── render.yaml
```

---

## Author

Built by [Shubh Sankalp Das](https://github.com/Shubh0208) as an AI-native portfolio project.

PRD and architecture writeup available on request.

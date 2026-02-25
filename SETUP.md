# PM Signal — Setup Guide (Windows)

## Prerequisites
- Python 3.10+ installed (python.org)
- Node.js 18+ installed (nodejs.org)
- Git installed (optional but recommended)

---

## Step 1: Get Your API Keys

### Google AI Studio (Gemini)
1. Go to https://aistudio.google.com
2. Sign in with Google
3. Click "Get API Key" → Create API key
4. Copy the key

### Pinecone
1. Go to https://pinecone.io → Sign up free
2. Go to your project → API Keys → copy the key
3. Create an index:
   - Name: `pmsignal`
   - Dimensions: `768`  ← IMPORTANT (Gemini uses 768, not 1536)
   - Metric: `cosine`
   - Cloud: AWS, Region: us-east-1 (default)

---

## Step 2: Set Up the Backend

Open a terminal (PowerShell or Command Prompt) in the `backend/` folder:

```bash
# Create virtual environment
python -m venv venv

# Activate it (Windows PowerShell)
.\venv\Scripts\Activate.ps1

# If you get a permissions error run this first:
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

# Install dependencies
pip install -r requirements.txt

# Create your .env file (copy from example)
copy .env.example .env
```

Now open `.env` and fill in your keys:
```
GEMINI_API_KEY=your_actual_gemini_key
PINECONE_API_KEY=your_actual_pinecone_key
PINECONE_INDEX_NAME=pmsignal
```

Start the backend:
```bash
uvicorn main:app --reload --port 8000
```

You should see: `Uvicorn running on http://0.0.0.0:8000`

Test it: Open http://localhost:8000/health — you should see `{"status":"ok"}`

---

## Step 3: Set Up the Frontend

Open a **new terminal** in the `frontend/` folder:

```bash
# Install dependencies
npm install

# Create env file
copy .env.local.example .env.local
```

The `.env.local` file should contain:
```
NEXT_PUBLIC_API_URL=http://localhost:8000
```

Start the frontend:
```bash
npm run dev
```

Open http://localhost:3000

---

## Step 4: Test With Mock Data

In the `mock_data/` folder you'll find:
- `slack_export_mock.json` — 15 Slack messages with real-sounding issues
- `jira_export_mock.csv` — 12 Jira tickets (bugs + feature requests)
- `transcript_mock.txt` — Full customer discovery call transcript

Upload all three files in the UI and try these queries:
1. "What are the most common issues users report?"
2. "What bugs are blocking users from completing checkout?"
3. "What features are users requesting most?"
4. "What onboarding problems are users experiencing?"

---

## Step 5: Deploy (When Ready to Share)

### Backend → Render.com
1. Push your code to GitHub
2. Go to render.com → New Web Service
3. Connect your repo, select the `backend/` folder
4. Build command: `pip install -r requirements.txt`
5. Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
6. Add environment variables (GEMINI_API_KEY, PINECONE_API_KEY, PINECONE_INDEX_NAME)
7. Deploy → copy your Render URL (e.g. https://pmsignal-api.onrender.com)

### Frontend → Vercel.com
1. Go to vercel.com → New Project → connect GitHub repo
2. Set Root Directory to `frontend/`
3. Add environment variable: `NEXT_PUBLIC_API_URL=https://your-render-url.onrender.com`
4. Deploy → get your live URL

---

## Troubleshooting

**PowerShell script error on venv activation:**
Run: `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser`

**Pinecone dimension mismatch error:**
Make sure your index was created with 768 dimensions (not 1536).

**Gemini rate limit (429 error):**
Free tier is 15 RPM. For large files with many chunks, ingestion may take longer — that's expected.

**CORS error in browser:**
Make sure backend is running on port 8000 and frontend on 3000.

**Backend cold start on Render:**
First request after 15 min inactivity takes ~30 seconds. Expected on free tier.

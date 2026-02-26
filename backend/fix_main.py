content = open('main.py', 'rb').read()

# Fix UTF-8 corruption
content = content.replace(b'\xe2\x94\x80', b'-')
content = content.replace(b'\xe2\x80\x93', b'-')
content = content.replace(b'\xc2\xa0', b' ')

# Decode to string
text = content.decode('utf-8', errors='ignore')

# Add cluster import after vector_store import line
text = text.replace(
    'from vector_store import store_chunks, query_index',
    'from vector_store import store_chunks, query_index\nfrom cluster import run_clustering'
)

# Add /insights endpoint before the last newline
insights_endpoint = '''

# -- Insights endpoint -------------------------------------------------------

class InsightsRequest(BaseModel):
    session_id: str
    n_clusters: int = 5


@app.post("/insights")
async def insights(req: InsightsRequest):
    """
    Run embedding-based clustering on all stored chunks for a session.
    Returns top N ranked issue clusters with names, counts, and source breakdown.
    """
    if not req.session_id:
        raise HTTPException(status_code=400, detail="session_id is required.")
    try:
        clusters = run_clustering(req.session_id, n_clusters=req.n_clusters)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Clustering failed: {str(e)}")
    return {
        "session_id": req.session_id,
        "clusters": clusters,
        "total_clusters": len(clusters),
    }
'''

text = text.rstrip() + insights_endpoint

open('main.py', 'w', encoding='utf-8').write(text)
print('done')

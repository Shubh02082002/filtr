fetch_code = '''

def fetch_session_vectors(session_id: str):
    index = get_index()
    all_ids = []
    for id_batch in index.list(prefix=session_id):
        if isinstance(id_batch, list):
            all_ids.extend(id_batch)
        else:
            all_ids.append(id_batch)
    if not all_ids:
        return []
    results = []
    for i in range(0, len(all_ids), 100):
        batch = all_ids[i:i+100]
        fetched = index.fetch(ids=batch)
        for vid, vdata in fetched.vectors.items():
            results.append({
                "id": vid,
                "values": vdata.values,
                "metadata": dict(vdata.metadata)
            })
    return results
'''
content = open('vector_store.py', 'r', encoding='utf-8').read()
content = content + fetch_code
open('vector_store.py', 'w', encoding='utf-8').write(content)
print('done')

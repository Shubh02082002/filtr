import PyPDF2
import io
def parse_transcript(file_content: bytes, filename: str) -> list[dict]:
    if filename.endswith(".pdf"):
        reader = PyPDF2.PdfReader(io.BytesIO(file_content))
        text = ""
        for page in reader.pages:
            text += page.extract_text() or ""
    else:
        text = file_content.decode("utf-8", errors="ignore")
    words = text.split()
    chunks = []
    i = 0
    while i < len(words):
        chunk = " ".join(words[i:i+300])
        if chunk.strip():
            chunks.append({
                "text": chunk,
                "source_type": "transcript",
                "author": None,
                "timestamp": None,
                "issue_type": None,
            })
        i += 250
    return chunks

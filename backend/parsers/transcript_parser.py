import PyPDF2
import io

def parse_transcript(file_content: bytes, filename: str) -> list[str]:
    if filename.endswith(".pdf"):
        reader = PyPDF2.PdfReader(io.BytesIO(file_content))
        text = ""
        for page in reader.pages:
            text += page.extract_text() or ""
    else:
        text = file_content.decode("utf-8", errors="ignore")
    
    # Sliding window chunking - 300 words, 50 word overlap
    words = text.split()
    chunks = []
    i = 0
    while i < len(words):
        chunk = " ".join(words[i:i+300])
        if chunk.strip():
            chunks.append(chunk)
        i += 250  # 300 - 50 overlap
    return chunks
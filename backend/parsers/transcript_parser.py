import pdfplumber
import io
import tiktoken
from typing import List, Dict


def parse_transcript(content: bytes, filename: str) -> List[Dict]:
    """
    Parse transcript from PDF or TXT.
    Uses sliding window chunking: 300 tokens per chunk, 50 token overlap.
    """
    # Extract raw text
    if filename.lower().endswith(".pdf"):
        text = _extract_pdf_text(content)
    else:
        text = content.decode("utf-8", errors="ignore")

    if not text.strip():
        return []

    # Chunk using sliding window
    chunks_text = _sliding_window_chunk(text, chunk_size=300, overlap=50)

    chunks = []
    for chunk_text in chunks_text:
        if len(chunk_text.strip()) < 20:
            continue
        chunks.append({
            "text": chunk_text.strip(),
            "source_type": "transcript",
            "author": None,
            "timestamp": None,
            "issue_type": None,
        })

    return chunks


def _extract_pdf_text(content: bytes) -> str:
    text_parts = []
    with pdfplumber.open(io.BytesIO(content)) as pdf:
        for page in pdf.pages:
            page_text = page.extract_text()
            if page_text:
                text_parts.append(page_text)
    return "\n".join(text_parts)


def _sliding_window_chunk(text: str, chunk_size: int = 300, overlap: int = 50) -> List[str]:
    """Split text into overlapping token-based chunks."""
    enc = tiktoken.get_encoding("cl100k_base")
    tokens = enc.encode(text)

    chunks = []
    start = 0
    while start < len(tokens):
        end = start + chunk_size
        chunk_tokens = tokens[start:end]
        chunk_text = enc.decode(chunk_tokens)
        chunks.append(chunk_text)
        if end >= len(tokens):
            break
        start += chunk_size - overlap  # slide forward with overlap

    return chunks

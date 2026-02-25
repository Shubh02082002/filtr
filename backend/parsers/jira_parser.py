import pandas as pd
from typing import List, Dict
import io


def parse_jira(content: bytes) -> List[Dict]:
    """
    Parse Jira CSV export into list of chunks with metadata.
    Looks for common Jira CSV column names.
    """
    df = pd.read_csv(io.BytesIO(content))

    # Normalize column names
    df.columns = [col.strip().lower() for col in df.columns]

    chunks = []

    for _, row in df.iterrows():
        # Try common Jira column names for summary and description
        summary = ""
        description = ""
        issue_type = None
        timestamp = None

        for col in ["summary", "title", "subject"]:
            if col in df.columns and pd.notna(row.get(col)):
                summary = str(row[col]).strip()
                break

        for col in ["description", "body", "details", "comment"]:
            if col in df.columns and pd.notna(row.get(col)):
                description = str(row[col]).strip()
                break

        for col in ["issue type", "issuetype", "type"]:
            if col in df.columns and pd.notna(row.get(col)):
                issue_type = str(row[col]).strip().lower()
                break

        for col in ["created", "date", "timestamp", "updated"]:
            if col in df.columns and pd.notna(row.get(col)):
                timestamp = str(row[col]).strip()
                break

        # Combine summary + description as a single chunk
        text = f"{summary}. {description}".strip(". ") if description else summary
        if not text or len(text) < 5:
            continue

        chunks.append({
            "text": text,
            "source_type": "jira",
            "author": None,
            "timestamp": timestamp,
            "issue_type": issue_type,
        })

    return chunks

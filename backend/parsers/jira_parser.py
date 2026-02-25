import csv
def parse_jira(file_content: str) -> list[dict]:
    chunks = []
    reader = csv.DictReader(file_content.splitlines())
    for row in reader:
        summary = row.get("Summary", "")
        description = row.get("Description", "")
        issue_type = row.get("Issue Type", "")
        text = f"{issue_type}: {summary}. {description}".strip()
        if text and text != ": .":
            chunks.append({
                "text": text,
                "source_type": "jira",
                "author": None,
                "timestamp": None,
                "issue_type": issue_type,
            })
    return chunks

import json
from typing import List, Dict


def parse_slack(content: bytes) -> List[Dict]:
    """
    Parse Slack export JSON into list of chunks with metadata.
    Expects either a single channel export (list of messages)
    or a dict with channel keys.
    """
    data = json.loads(content.decode("utf-8"))
    chunks = []

    # Handle both single channel (list) and multi-channel (dict) exports
    if isinstance(data, list):
        messages = data
    elif isinstance(data, dict):
        messages = []
        for channel, msgs in data.items():
            if isinstance(msgs, list):
                messages.extend(msgs)
    else:
        return chunks

    for msg in messages:
        text = msg.get("text", "").strip()
        if not text or len(text) < 10:  # skip empty or very short messages
            continue
        # Skip bot messages and system messages
        if msg.get("subtype") in ("bot_message", "channel_join", "channel_leave"):
            continue

        chunks.append({
            "text": text,
            "source_type": "slack",
            "author": msg.get("user", None),
            "timestamp": msg.get("ts", None),
            "issue_type": None,
        })

    return chunks

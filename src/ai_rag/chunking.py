"""Structure-aware recursive chunker: paragraphs → sentences → hard split, with overlap."""

from __future__ import annotations

import re

_PARA = re.compile(r"\n\s*\n")
_SENT = re.compile(r"(?<=[.!?])\s+")


def _split(text: str, size: int) -> list[str]:
    if len(text) <= size:
        return [text]
    for pattern in (_PARA, _SENT, re.compile(r"\n"), re.compile(r"\s+")):
        parts = [p for p in pattern.split(text) if p.strip()]
        if len(parts) > 1:
            out: list[str] = []
            for p in parts:
                out.extend(_split(p, size))
            return out
    return [text[i : i + size] for i in range(0, len(text), size)]


def chunk_text(text: str, *, size: int = 900, overlap: int = 150) -> list[str]:
    text = re.sub(r"[ \t]+", " ", text).strip()
    if not text:
        return []
    pieces = _split(text, size)
    chunks: list[str] = []
    current = ""
    for piece in pieces:
        candidate = f"{current}\n{piece}" if current else piece
        if len(candidate) <= size:
            current = candidate
            continue
        if current:
            chunks.append(current.strip())
            tail = current[-overlap:] if overlap else ""
            # start the overlap on a word boundary
            tail = tail[tail.find(" ") + 1 :] if " " in tail else tail
            current = f"{tail}\n{piece}" if tail else piece
            if len(current) > size:
                current = piece
        else:
            current = piece
    if current.strip():
        chunks.append(current.strip())
    return chunks

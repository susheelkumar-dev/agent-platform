"""Document parsers. Returns a list of (page_number | None, text) sections.

Built-in: txt/md/csv/json/log, html, pdf (pypdf), docx (stdlib zip+xml).
Add OCR or other formats by registering a parser for an extension.
"""

from __future__ import annotations

import html
import io
import json
import re
import zipfile
from collections.abc import Callable

from ai_core.errors import RAGError

Section = tuple[int | None, str]
Parser = Callable[[bytes], list[Section]]


def _decode(data: bytes) -> str:
    for enc in ("utf-8-sig", "utf-16", "latin-1"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


def parse_text(data: bytes) -> list[Section]:
    return [(None, _decode(data))]


def parse_json(data: bytes) -> list[Section]:
    try:
        return [(None, json.dumps(json.loads(_decode(data)), indent=2, ensure_ascii=False))]
    except json.JSONDecodeError:
        return parse_text(data)


def parse_html(data: bytes) -> list[Section]:
    text = _decode(data)
    text = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", text)
    text = re.sub(r"(?i)<br\s*/?>|</(p|div|li|h[1-6]|tr)>", "\n", text)
    text = re.sub(r"<[^>]+>", " ", text)
    return [(None, html.unescape(re.sub(r"[ \t]+", " ", text)))]


def parse_pdf(data: bytes) -> list[Section]:
    try:
        from pypdf import PdfReader
    except ImportError as exc:  # pragma: no cover
        raise RAGError("PDF support requires 'pypdf' (pip install .[platform])") from exc
    reader = PdfReader(io.BytesIO(data))
    return [(i + 1, page.extract_text() or "") for i, page in enumerate(reader.pages)]


def parse_docx(data: bytes) -> list[Section]:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            xml = zf.read("word/document.xml").decode("utf-8", errors="replace")
    except (zipfile.BadZipFile, KeyError) as exc:
        raise RAGError("Invalid .docx file") from exc
    xml = re.sub(r"</w:p>", "\n", xml)
    xml = re.sub(r"<w:tab/>", "\t", xml)
    text = re.sub(r"<[^>]+>", "", xml)
    return [(None, html.unescape(text))]


PARSERS: dict[str, Parser] = {
    ".txt": parse_text,
    ".md": parse_text,
    ".markdown": parse_text,
    ".csv": parse_text,
    ".log": parse_text,
    ".json": parse_json,
    ".html": parse_html,
    ".htm": parse_html,
    ".pdf": parse_pdf,
    ".docx": parse_docx,
}


def parse_document(filename: str, data: bytes) -> list[Section]:
    ext = ("." + filename.rsplit(".", 1)[-1].lower()) if "." in filename else ".txt"
    parser = PARSERS.get(ext)
    if parser is None:
        raise RAGError(
            f"Unsupported file type '{ext}'. Supported: {', '.join(sorted(PARSERS))}", code="UNSUPPORTED_TYPE"
        )
    sections = parser(data)
    if not any(text.strip() for _, text in sections):
        raise RAGError(f"No extractable text in '{filename}' (scanned PDFs need an OCR parser)", code="EMPTY_DOCUMENT")
    return sections

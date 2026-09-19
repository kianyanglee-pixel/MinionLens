import io
from pathlib import Path

import pandas as pd
import pdfplumber
from docx import Document

from .llm import ask_json

FIELD_NAMES = (
    "shipper",
    "consignee",
    "notify_party",
    "port_of_loading",
    "port_of_discharge",
    "container_count",
    "gross_weight_kg",
)

EXTRACT_SYSTEM_PROMPT = """You extract shipment fields from a Shipping Instruction (SI) or Bill of Lading (BL) document.
Extract exactly these fields: shipper, consignee, notify_party, port_of_loading, port_of_discharge, container_count, gross_weight_kg.
Documents often label the same field differently (e.g. "Notify" vs "Notify Party", "POL" vs "Port of Loading") — align by meaning, not by header text.
- shipper, consignee, notify_party must be only the party/company name, never the following street address, city, or country lines.
- port_of_loading and port_of_discharge should include the place name (and country/code if given), not vessel or voyage details.
- container_count must be a plain integer (count containers, ignore container type codes like 40HC).
- gross_weight_kg must be an object {"value": <number>, "unit": "<unit exactly as written, e.g. KG, LBS, G, MT>"} — report the raw number and unit as written; do NOT convert units yourself, a separate deterministic step handles that.
- If a field is not present in the text, set it to null (for gross_weight_kg, set the whole field to null, not {"value": null, "unit": null}).
Respond with strict JSON using exactly these keys: shipper, consignee, notify_party, port_of_loading, port_of_discharge, container_count, gross_weight_kg."""


def _extract_from_text(text: str):
    """Returns the 7-field dict, or None if the LLM call succeeded but its
    response couldn't be parsed as JSON — a processing failure, distinct
    from a content problem (§2.4-F), for the caller to flag."""
    result = ask_json(EXTRACT_SYSTEM_PROMPT, text)
    if result.get("error") == "invalid_json":
        return None
    return {name: result.get(name) for name in FIELD_NAMES}


def _text_from_spreadsheet(raw_bytes: bytes) -> str:
    sheets = pd.read_excel(io.BytesIO(raw_bytes), sheet_name=None, header=None, engine="openpyxl")
    chunks = []
    for sheet_name, df in sheets.items():
        chunks.append(f"--- sheet: {sheet_name} ---")
        chunks.append(df.to_csv(index=False, header=False))
    return "\n".join(chunks)


def _text_from_pdf(raw_bytes: bytes) -> str:
    """Text-layer extraction only — a scanned/image-only PDF has no text
    layer and yields an empty string, which the caller treats as unreadable
    rather than attempting OCR."""
    with pdfplumber.open(io.BytesIO(raw_bytes)) as pdf:
        pages = [page.extract_text() or "" for page in pdf.pages]
    return "\n".join(pages).strip()


def _text_from_docx(raw_bytes: bytes) -> str:
    doc = Document(io.BytesIO(raw_bytes))
    chunks = [p.text for p in doc.paragraphs]
    for table in doc.tables:
        for row in table.rows:
            chunks.append("\t".join(cell.text for cell in row.cells))
    return "\n".join(chunks).strip()


def _result(att_path, *, ok, error, fields=None, found=None, text="", processing_failure=False):
    return {
        "path": att_path,
        "ok": ok,
        "error": error,
        "fields": fields or {},
        "found": found or {},
        "text": text,
        "processing_failure": processing_failure,
    }


def extract_fields(inbox, att_path: str) -> dict:
    ext = Path(att_path).suffix.lower()

    if ext == ".txt":
        text = inbox.read_text(att_path)
    elif ext in (".xlsx", ".xls"):
        text = _text_from_spreadsheet(inbox.read_bytes(att_path))
    elif ext == ".pdf":
        text = _text_from_pdf(inbox.read_bytes(att_path))
        if not text:
            return _result(att_path, ok=False, error="unreadable")
    elif ext == ".docx":
        text = _text_from_docx(inbox.read_bytes(att_path))
        if not text:
            return _result(att_path, ok=False, error="unreadable")
    else:
        return _result(att_path, ok=False, error=f"rejected_format:{ext}")

    fields = _extract_from_text(text)
    if fields is None:
        return _result(att_path, ok=False, error="processing_failure", text=text, processing_failure=True)

    found = {name: bool(value is not None and str(value).strip()) for name, value in fields.items()}
    return _result(att_path, ok=True, error=None, fields=fields, found=found, text=text)

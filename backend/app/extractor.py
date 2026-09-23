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

_FIELD_RULES = """- shipper, consignee, notify_party must be ONLY the core company/entity name — never any address, city, country, or postal code text attached to it. This applies even when the source puts the name and its address in the SAME cell or line, separated by a symbol like "|" or ";", instead of on separate lines (common in spreadsheet-derived documents) — still extract just the name portion in that case. The same real-world party must come out identically no matter which document or format it was read from.
- port_of_loading and port_of_discharge should include the place name (and country/code if given), not vessel or voyage details.
- container_count must be a plain integer (count containers, ignore container type codes like 40HC).
- gross_weight_kg must be an object {"value": <number>, "unit": "<unit exactly as written, e.g. KG, LBS, G, MT>"} — report the raw number and unit as written; do NOT convert units yourself, a separate deterministic step handles that.
- If a field is not present in the text, set it to null (for gross_weight_kg, set the whole field to null, not {"value": null, "unit": null})."""

EXTRACT_SYSTEM_PROMPT = f"""You extract shipment fields from a Shipping Instruction (SI) or Bill of Lading (BL) document.
Extract exactly these fields: shipper, consignee, notify_party, port_of_loading, port_of_discharge, container_count, gross_weight_kg.
Documents often label the same field differently (e.g. "Notify" vs "Notify Party", "POL" vs "Port of Loading") — align by meaning, not by header text.
{_FIELD_RULES}
Respond with strict JSON using exactly these keys: shipper, consignee, notify_party, port_of_loading, port_of_discharge, container_count, gross_weight_kg."""

EXTRACT_PAIR_SYSTEM_PROMPT = f"""You extract shipment fields from a pair of shipping documents for the same shipment: a Shipping Instruction (SI) and a draft Bill of Lading (BL).
For EACH document separately, extract exactly these fields: shipper, consignee, notify_party, port_of_loading, port_of_discharge, container_count, gross_weight_kg.
Documents often label the same field differently (e.g. "Notify" vs "Notify Party", "POL" vs "Port of Loading") — align by meaning, not by header text.
{_FIELD_RULES}
Respond with strict JSON of exactly this shape:
{{"si": {{"shipper": ..., "consignee": ..., "notify_party": ..., "port_of_loading": ..., "port_of_discharge": ..., "container_count": ..., "gross_weight_kg": ...}},
 "bl": {{"shipper": ..., "consignee": ..., "notify_party": ..., "port_of_loading": ..., "port_of_discharge": ..., "container_count": ..., "gross_weight_kg": ...}}}}"""


def _fields_from_result(result) -> dict:
    return {name: result.get(name) for name in FIELD_NAMES}


def _extract_from_text(text: str, llm_api_key: str | None = None):
    """One document, one LLM call. Returns the 7-field dict, or None if the
    call succeeded but its response couldn't be parsed as JSON — a
    processing failure, distinct from a content problem (§2.4-F)."""
    result = ask_json(EXTRACT_SYSTEM_PROMPT, text, api_key=llm_api_key)
    if result.get("error") == "invalid_json":
        return None
    return _fields_from_result(result)


def _extract_pair_from_text(si_text: str, bl_text: str, llm_api_key: str | None = None):
    """Both documents, ONE combined LLM call (§6.4) instead of two separate
    calls — halves extraction cost/latency for every BL_COMPARISON email.
    Returns (si_fields, bl_fields), or (None, None) on a parse failure."""
    result = ask_json(
        EXTRACT_PAIR_SYSTEM_PROMPT,
        f"--- SI document ---\n{si_text}\n\n--- BL document ---\n{bl_text}",
        api_key=llm_api_key,
    )
    if result.get("error") == "invalid_json":
        return None, None
    return _fields_from_result(result.get("si") or {}), _fields_from_result(result.get("bl") or {})


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


def _document_text(inbox, att_path: str):
    """Reads and parses one attachment's raw text, dispatched by extension.
    Returns (text, None) on success, or (None, failure_result) if the
    document can't be read at all — the caller then skips the LLM call for
    it entirely rather than sending unreadable content."""
    ext = Path(att_path).suffix.lower()

    if ext == ".txt":
        return inbox.read_text(att_path), None
    if ext in (".xlsx", ".xls"):
        return _text_from_spreadsheet(inbox.read_bytes(att_path)), None
    if ext == ".pdf":
        text = _text_from_pdf(inbox.read_bytes(att_path))
        if not text:
            return None, _result(att_path, ok=False, error="unreadable")
        return text, None
    if ext == ".docx":
        text = _text_from_docx(inbox.read_bytes(att_path))
        if not text:
            return None, _result(att_path, ok=False, error="unreadable")
        return text, None
    return None, _result(att_path, ok=False, error=f"rejected_format:{ext}")


def _fields_result(att_path, text, fields):
    if fields is None:
        return _result(att_path, ok=False, error="processing_failure", text=text, processing_failure=True)
    found = {name: bool(value is not None and str(value).strip()) for name, value in fields.items()}
    return _result(att_path, ok=True, error=None, fields=fields, found=found, text=text)


def extract_fields(inbox, att_path: str, llm_api_key: str | None = None) -> dict:
    """Single-document extraction — one LLM call for one attachment. Use
    extract_field_pair() for a BL_COMPARISON email's SI+BL pair instead,
    which combines both into a single call (§6.4)."""
    text, failure = _document_text(inbox, att_path)
    if failure:
        return failure
    return _fields_result(att_path, text, _extract_from_text(text, llm_api_key))


def extract_field_pair(inbox, si_path: str, bl_path: str, llm_api_key: str | None = None):
    """Extracts both the SI and BL documents' 7 fields in one combined LLM
    call (§6.4) instead of two separate calls. Falls back to a single-
    document call for whichever side is readable if the other side can't be
    parsed at all (a combined call needs both texts to be worth sending).
    Returns (si_result, bl_result), each shaped like extract_fields()'s
    return value."""
    si_text, si_failure = _document_text(inbox, si_path)
    bl_text, bl_failure = _document_text(inbox, bl_path)

    if si_failure and bl_failure:
        return si_failure, bl_failure
    if si_failure:
        return si_failure, _fields_result(bl_path, bl_text, _extract_from_text(bl_text, llm_api_key))
    if bl_failure:
        return _fields_result(si_path, si_text, _extract_from_text(si_text, llm_api_key)), bl_failure

    si_fields, bl_fields = _extract_pair_from_text(si_text, bl_text, llm_api_key)
    return _fields_result(si_path, si_text, si_fields), _fields_result(bl_path, bl_text, bl_fields)

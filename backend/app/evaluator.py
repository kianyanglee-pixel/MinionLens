import re

from rapidfuzz import fuzz

from .llm import ask_json

FIELD_LABELS = {
    "shipper": "Shipper",
    "consignee": "Consignee",
    "notify_party": "Notify party",
    "port_of_loading": "Port of loading",
    "port_of_discharge": "Port of discharge",
    "container_count": "Container count",
    "gross_weight_kg": "Gross weight (kg)",
}
FIELD_NAMES = tuple(FIELD_LABELS)

NUMERIC_FIELDS = {"container_count", "gross_weight_kg"}
FUZZY_MATCH_THRESHOLD = 90
LITERAL_MATCH_THRESHOLD = 90
WEIGHT_TOLERANCE_KG = 1.0

GROUNDING_SYSTEM_PROMPT = """You check whether an extracted value is actually attributable to a source document's text
— i.e. whether it's a normalized or converted form of something the text says, not an invented or hallucinated value.
Respond with strict JSON: {"verdict": "confirmed"|"not_found"|"ambiguous", "reason": "<one short sentence>"}."""


def _normalize_text(value) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip().lower()


def _parse_number(value):
    if value is None:
        return None
    match = re.search(r"-?\d+(\.\d+)?", str(value).replace(",", ""))
    return float(match.group()) if match else None


def _literal_match(value, source_text) -> bool:
    """Literal Match Check ('the clerk'): does an extracted value appear
    verbatim, or near-verbatim, in the document it was extracted from?
    Deterministic, free, no LLM — runs first, on every text field (§2.4-B)."""
    value_norm = _normalize_text(value)
    text_norm = _normalize_text(source_text)
    if not value_norm or not text_norm:
        return False
    if value_norm in text_norm:
        return True

    window = len(value_norm)
    if window > len(text_norm):
        return False
    step = max(1, window // 4)
    return any(
        fuzz.ratio(value_norm, text_norm[i:i + window]) >= LITERAL_MATCH_THRESHOLD
        for i in range(0, len(text_norm) - window + 1, step)
    )


def _grounding_verify(value, source_text) -> str:
    """Grounding Verifier: LLM call, only for a value the Literal Match Check
    couldn't resolve — confirms whether a normalized/converted value is still
    attributable to its source document (§2.4-B). Never compares SI to BL —
    that judgment belongs to the deterministic Comparator below."""
    verdict = ask_json(
        GROUNDING_SYSTEM_PROMPT,
        f"Extracted value: {value}\n\nSource document text:\n{source_text}",
    )
    result = verdict.get("verdict")
    return result if result in ("confirmed", "not_found", "ambiguous") else "ambiguous"


def _grounded(value, source_text) -> bool:
    """Is a single extracted value trustworthy: found literally in its own
    source text, or confirmed by the Grounding Verifier when it isn't."""
    if value is None:
        return False
    if _literal_match(value, source_text):
        return True
    return _grounding_verify(value, source_text) == "confirmed"


def _compare_numeric(field: str, si_value, bl_value) -> bool:
    si_num, bl_num = _parse_number(si_value), _parse_number(bl_value)
    if si_num is None or bl_num is None:
        return False
    if field == "gross_weight_kg":
        return abs(si_num - bl_num) <= WEIGHT_TOLERANCE_KG
    return si_num == bl_num


def _compare_text(si_value, bl_value) -> bool:
    """Comparator: deterministic diff only, no LLM (§2.4-A) — exact match
    after normalization, or a high-confidence fuzzy match to absorb
    whitespace/punctuation noise, never a semantic 'are these the same
    entity' judgment call (a real value mismatch, like the SI/BL consignee
    example in the PRD, must be flagged, not explained away)."""
    si_norm, bl_norm = _normalize_text(si_value), _normalize_text(bl_value)
    if not si_norm or not bl_norm:
        return False
    if si_norm == bl_norm:
        return True
    return fuzz.token_sort_ratio(si_norm, bl_norm) >= FUZZY_MATCH_THRESHOLD


def _needs_review(reason: str, field_comparisons=None) -> dict:
    return {
        "status": "NEEDS_REVIEW",
        "review_reason": reason,
        "has_defect": False,
        "defect_fields": [],
        "field_comparisons": field_comparisons or {},
    }


def compare_documents(si_result: dict, bl_result: dict) -> dict:
    if not si_result["ok"] or not bl_result["ok"]:
        return _needs_review("unreadable")

    if sum(si_result["found"].values()) == 0 or sum(bl_result["found"].values()) == 0:
        return _needs_review("wrong_doc_type")

    si_text = si_result.get("text", "")
    bl_text = bl_result.get("text", "")

    field_comparisons = {}
    for name in FIELD_NAMES:
        si_value = si_result["fields"].get(name)
        bl_value = bl_result["fields"].get(name)
        both_found = si_result["found"].get(name) and bl_result["found"].get(name)

        if not both_found:
            match = None
        elif name in NUMERIC_FIELDS:
            # Numeric fields (container_count, gross_weight_kg) aren't yet
            # covered by a Literal Match Check rule (that's the Tier 3
            # container-count parser / Unit Normalizer work) — compare as
            # today, deterministic only.
            match = _compare_numeric(name, si_value, bl_value)
        elif not _grounded(si_value, si_text) or not _grounded(bl_value, bl_text):
            # Neither the Literal Match Check nor the Grounding Verifier
            # could confirm this value is attributable to its own source —
            # low-confidence, route to review rather than guess (§2.4-B).
            match = None
        else:
            match = _compare_text(si_value, bl_value)

        field_comparisons[name] = {
            "label": FIELD_LABELS[name],
            "siValue": si_value,
            "blValue": bl_value,
            "match": match,
        }

    if any(c["match"] is None for c in field_comparisons.values()):
        return _needs_review("missing_value", field_comparisons)

    defect_fields = [name for name, c in field_comparisons.items() if c["match"] is False]
    return {
        "status": "MISMATCH" if defect_fields else "OK",
        "review_reason": None,
        "has_defect": bool(defect_fields),
        "defect_fields": defect_fields,
        "field_comparisons": field_comparisons,
    }

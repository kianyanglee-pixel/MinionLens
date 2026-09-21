import re

from rapidfuzz import fuzz

from .llm import ask_json
from .unit_normalizer import to_kg

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

FUZZY_MATCH_THRESHOLD = 90
LITERAL_MATCH_THRESHOLD = 90
# Fixed, not relative — this tolerance exists only to absorb unit-conversion
# rounding (a sub-kg, floating-point-precision problem regardless of
# shipment size), not real-world measurement variance. A relative percentage
# badly overshoots on large shipments: confirmed via a real case where a
# genuine 1,000kg / 0.46% discrepancy on a ~217,000kg shipment was silently
# missed under the old +/-0.5% relative tolerance (§2.4-E).
WEIGHT_TOLERANCE_KG = 2.0

# The sample dataset always writes container count as "N x SIZE'TYPE" (e.g.
# "6 x 40'HC") — this pattern lets the Literal Match Check resolve that
# specific transformation itself, permanently graduating the field off the
# Grounding Verifier (§2.4-B).
CONTAINER_COUNT_PATTERN = re.compile(r"(\d+)\s*x\s*\d+'?\s*[a-z]{1,4}\b", re.IGNORECASE)

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


def _weight_parts(value):
    """gross_weight_kg is {"value": <number>, "unit": "<str>"} from the
    extractor (§2.4-E). Tolerate a bare number for robustness against a
    malformed extraction — to_kg() will then correctly return None (no
    unit info), routing it to review rather than guessing kg."""
    if isinstance(value, dict):
        return value.get("value"), value.get("unit")
    return value, None


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


def _parse_container_count(value, source_text):
    """Confirms an extracted container count against the source text's own
    'N x SIZE'TYPE' wording — deterministic, no LLM. Returns the count if
    confirmed, else None (low-confidence, no LLM fallback for this field —
    it's fully graduated off the Grounding Verifier, §2.4-B)."""
    count = _parse_number(value)
    if count is None:
        return None
    text_norm = _normalize_text(source_text)
    for match in CONTAINER_COUNT_PATTERN.finditer(text_norm):
        if int(match.group(1)) == int(count):
            return int(count)
    return None


def _compare_container_count(si_value, bl_value, si_text, bl_text):
    si_count = _parse_container_count(si_value, si_text)
    bl_count = _parse_container_count(bl_value, bl_text)
    if si_count is None or bl_count is None:
        return None
    return si_count == bl_count


def _compare_weight(si_value, bl_value):
    """Unit Normalizer + weight comparison (§2.4-E) — deterministic, no LLM.
    Converts both sides to kg before comparing, with a small fixed-kg
    tolerance to absorb unit-conversion rounding rather than exact-match
    false-flagging. No identifiable unit on either side is low-confidence,
    not a silent kg assumption — routes to review like any other ungrounded
    field."""
    si_kg = to_kg(*_weight_parts(si_value))
    bl_kg = to_kg(*_weight_parts(bl_value))
    if si_kg is None or bl_kg is None:
        return None
    return abs(si_kg - bl_kg) <= WEIGHT_TOLERANCE_KG


def _strip_pipe_suffix(value):
    """Spreadsheet-derived party fields sometimes combine the name and its
    address in one cell, separated by '|' (e.g. "APRIL FINE PAPER TRADING |
    ON BEHALF OF ...; SINGAPORE 068896"), which the extraction prompt is
    told to exclude but doesn't always manage to in practice — confirmed via
    a real case where this caused the identical real-world shipper to be
    extracted with the address attached on one side but not the other,
    flagging a false mismatch. '|' never appears inside a genuine field
    value in this dataset's format, so stripping everything from the first
    one onward is a safe, deterministic redundant layer on top of the
    prompt fix, not a heuristic that risks hiding a real difference."""
    if isinstance(value, str) and "|" in value:
        return value.split("|", 1)[0]
    return value


def _compare_text(si_value, bl_value) -> bool:
    """Comparator: deterministic diff only, no LLM (§2.4-A) — exact match
    after normalization, or a high-confidence fuzzy match to absorb
    whitespace/punctuation noise, never a semantic 'are these the same
    entity' judgment call (a real value mismatch, like the SI/BL consignee
    example in the PRD, must be flagged, not explained away)."""
    si_norm = _normalize_text(_strip_pipe_suffix(si_value))
    bl_norm = _normalize_text(_strip_pipe_suffix(bl_value))
    if not si_norm or not bl_norm:
        return False
    if si_norm == bl_norm:
        return True
    return fuzz.token_sort_ratio(si_norm, bl_norm) >= FUZZY_MATCH_THRESHOLD


def _needs_review(reason: str, field_comparisons=None) -> dict:
    return {
        "status": "NEEDS_REVIEW",
        "review_reason": reason,
        "processing_failure": False,
        "has_defect": False,
        "defect_fields": [],
        "field_comparisons": field_comparisons or {},
    }


def compare_documents(si_result: dict, bl_result: dict) -> dict:
    if si_result.get("processing_failure") or bl_result.get("processing_failure"):
        # A system fault (LLM call failed after retries, a parser threw) —
        # kept visibly separate from the four content review_reason values,
        # no document to view, no judgment to make, just a retry (§2.4-F).
        return {
            "status": "NEEDS_REVIEW",
            "review_reason": None,
            "processing_failure": True,
            "has_defect": False,
            "defect_fields": [],
            "field_comparisons": {},
        }

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
        elif name == "container_count":
            match = _compare_container_count(si_value, bl_value, si_text, bl_text)
        elif name == "gross_weight_kg":
            match = _compare_weight(si_value, bl_value)
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
        "processing_failure": False,
        "has_defect": bool(defect_fields),
        "defect_fields": defect_fields,
        "field_comparisons": field_comparisons,
    }

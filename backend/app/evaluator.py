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
FUZZY_AMBIGUOUS_FLOOR = 70
WEIGHT_TOLERANCE_KG = 1.0

SEMANTIC_SYSTEM_PROMPT = """You check whether two short shipping-document values refer to the same real-world thing
(e.g. a company name written in short form vs full form, or the same value written in different languages).
Respond with strict JSON: {"same": true|false, "reason": "<one short sentence>"}."""


def _normalize_text(value) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip().lower()


def _parse_number(value):
    if value is None:
        return None
    match = re.search(r"-?\d+(\.\d+)?", str(value).replace(",", ""))
    return float(match.group()) if match else None


def _compare_numeric(field: str, si_value, bl_value) -> bool:
    si_num, bl_num = _parse_number(si_value), _parse_number(bl_value)
    if si_num is None or bl_num is None:
        return False
    if field == "gross_weight_kg":
        return abs(si_num - bl_num) <= WEIGHT_TOLERANCE_KG
    return si_num == bl_num


def _compare_text(si_value, bl_value) -> bool:
    si_norm, bl_norm = _normalize_text(si_value), _normalize_text(bl_value)
    if not si_norm or not bl_norm:
        return False
    if si_norm == bl_norm:
        return True

    score = fuzz.token_sort_ratio(si_norm, bl_norm)
    if score >= FUZZY_MATCH_THRESHOLD:
        return True
    if score < FUZZY_AMBIGUOUS_FLOOR:
        return False

    verdict = ask_json(SEMANTIC_SYSTEM_PROMPT, f"Value A: {si_value}\nValue B: {bl_value}")
    return bool(verdict.get("same"))


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

    field_comparisons = {}
    for name in FIELD_NAMES:
        si_value = si_result["fields"].get(name)
        bl_value = bl_result["fields"].get(name)
        both_found = si_result["found"].get(name) and bl_result["found"].get(name)

        if not both_found:
            match = None
        elif name in NUMERIC_FIELDS:
            match = _compare_numeric(name, si_value, bl_value)
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

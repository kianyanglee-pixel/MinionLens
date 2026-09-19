from unittest.mock import patch

from app.evaluator import (
    _literal_match,
    _grounded,
    _compare_text,
    _compare_container_count,
    _compare_weight,
    _parse_container_count,
    compare_documents,
    FIELD_NAMES,
)
from app.unit_normalizer import to_kg


def _extracted(fields, text, ok=True, processing_failure=False):
    found = {name: bool(value is not None and str(value).strip()) for name, value in fields.items()}
    return {
        "path": "x",
        "ok": ok,
        "error": None,
        "fields": fields,
        "found": found,
        "text": text,
        "processing_failure": processing_failure,
    }


def _full_fields(**overrides):
    base = {name: f"value-{name}" for name in FIELD_NAMES}
    base["container_count"] = "4"
    base["gross_weight_kg"] = {"value": 22000, "unit": "KG"}
    base.update(overrides)
    return base


# -- Literal Match Check (deterministic, no LLM) -----------------------------

def test_literal_match_verbatim():
    assert _literal_match("Singapore", "Port of Loading: Singapore") is True


def test_literal_match_near_verbatim_whitespace_noise():
    assert _literal_match("Bright Corp", "consignee:   bright   corp ") is True


def test_literal_match_absent():
    assert _literal_match("Rotterdam", "Port of Loading: Singapore") is False


# -- Grounding: literal match skips the LLM, only the residual calls it -----

def test_grounded_skips_llm_when_literal_match_succeeds():
    with patch("app.evaluator.ask_json") as mock_ask:
        result = _grounded("Singapore", "Port of Loading: Singapore")

    assert result is True
    mock_ask.assert_not_called()


def test_grounded_calls_grounding_verifier_when_literal_match_fails():
    with patch("app.evaluator.ask_json", return_value={"verdict": "confirmed"}) as mock_ask:
        result = _grounded("a paraphrased value", "the source text says something else entirely")

    assert result is True
    mock_ask.assert_called_once()


def test_grounded_false_when_verifier_says_not_found():
    with patch("app.evaluator.ask_json", return_value={"verdict": "not_found"}):
        assert _grounded("Rotterdam", "Port of Loading: Singapore") is False


# -- Comparator: deterministic only, never asks the LLM whether SI/BL agree -

def test_compare_text_never_calls_llm_even_on_a_real_mismatch():
    # This is the PRD's own worked example (SI consignee EAST BRIGHT FZ-LLC vs
    # BL consignee UAB NOVAKOPA) — a genuine mismatch that must be flagged,
    # not smoothed over by an LLM deciding they're "the same".
    with patch("app.evaluator.ask_json") as mock_ask:
        result = _compare_text("EAST BRIGHT FZ-LLC", "UAB NOVAKOPA")

    assert result is False
    mock_ask.assert_not_called()


def test_compare_text_fuzzy_match_absorbs_formatting_noise():
    assert _compare_text("Acme Freight Ltd", "Acme  Freight   Ltd") is True


# -- Container-count graduation: deterministic parser, never calls the LLM --

def test_parse_container_count_confirms_stable_format():
    assert _parse_container_count("6", "6 x 40'HC container shipment") == 6


def test_parse_container_count_no_match_returns_none():
    assert _parse_container_count("6", "no container format mentioned here") is None


def test_compare_container_count_matches_when_both_sides_confirmed():
    with patch("app.evaluator.ask_json") as mock_ask:
        result = _compare_container_count("6", "6", "6 x 40'HC", "6 x 40'HC")

    assert result is True
    mock_ask.assert_not_called()


def test_compare_container_count_none_when_unconfirmed_on_either_side():
    # Graduated off the LLM verifier entirely (§2.4-B) — an unconfirmed count
    # routes to review, it never falls back to asking the LLM.
    with patch("app.evaluator.ask_json") as mock_ask:
        result = _compare_container_count("6", "6", "no matching format", "6 x 40'HC")

    assert result is None
    mock_ask.assert_not_called()


# -- Unit Normalizer + weight comparison: deterministic, no LLM -------------

def test_to_kg_converts_lbs():
    assert to_kg(48502, "LBS") == 48502 * 0.45359237


def test_to_kg_unknown_unit_returns_none():
    assert to_kg(100, "STONE") is None


def test_compare_weight_same_real_weight_different_units_matches():
    si = {"value": 22000, "unit": "KG"}
    bl = {"value": 48502, "unit": "LBS"}  # ~22000 kg
    assert _compare_weight(si, bl) is True


def test_compare_weight_real_discrepancy_does_not_match():
    si = {"value": 22000, "unit": "KG"}
    bl = {"value": 25000, "unit": "KG"}
    assert _compare_weight(si, bl) is False


def test_compare_weight_missing_unit_is_low_confidence_not_a_guess():
    si = {"value": 22000, "unit": None}
    bl = {"value": 22000, "unit": "KG"}
    assert _compare_weight(si, bl) is None


# -- compare_documents: end-to-end gating -------------------------------------

def test_compare_documents_ok_when_all_fields_literal_grounded_and_match():
    shared_text = (
        "Shipper: Acme\nConsignee: East Bright\nNotify: North Star\n"
        "Port of Loading: Singapore\nPort of Discharge: Rotterdam\n"
        "Containers: 4 x 40'HC\nWeight: 22000 KG"
    )
    fields = _full_fields(
        shipper="Acme", consignee="East Bright", notify_party="North Star",
        port_of_loading="Singapore", port_of_discharge="Rotterdam",
        container_count="4", gross_weight_kg={"value": 22000, "unit": "KG"},
    )
    si = _extracted(fields, shared_text)
    bl = _extracted(fields, shared_text)

    with patch("app.evaluator.ask_json") as mock_ask:
        result = compare_documents(si, bl)

    assert result["status"] == "OK"
    assert result["has_defect"] is False
    mock_ask.assert_not_called()


def test_compare_documents_unit_mismatch_resolves_to_ok_not_false_mismatch():
    shared_text = (
        "Shipper: Acme\nConsignee: East Bright\nNotify: North Star\n"
        "Port of Loading: Singapore\nPort of Discharge: Rotterdam\n"
        "Containers: 4 x 40'HC\nWeight: 22000 KG"
    )
    common = dict(
        shipper="Acme", consignee="East Bright", notify_party="North Star",
        port_of_loading="Singapore", port_of_discharge="Rotterdam",
        container_count="4",
    )
    si = _extracted(_full_fields(**common, gross_weight_kg={"value": 22000, "unit": "KG"}), shared_text)
    bl = _extracted(_full_fields(**common, gross_weight_kg={"value": 48502, "unit": "LBS"}), shared_text)

    result = compare_documents(si, bl)

    assert result["status"] == "OK"
    assert result["field_comparisons"]["gross_weight_kg"]["match"] is True


def test_compare_documents_flags_ungrounded_value_as_needs_review():
    si = _extracted(_full_fields(shipper="a name nowhere in this document"), "unrelated body text")
    bl = _extracted(_full_fields(), "also unrelated body text")

    with patch("app.evaluator.ask_json", return_value={"verdict": "not_found"}):
        result = compare_documents(si, bl)

    assert result["status"] == "NEEDS_REVIEW"
    assert result["review_reason"] == "missing_value"


def test_compare_documents_wrong_doc_type_when_nothing_extracted():
    empty_fields = {name: None for name in FIELD_NAMES}
    si = _extracted(empty_fields, "invoice #123, please remit payment")
    bl = _extracted(_full_fields(), "shipper value-shipper ...")

    result = compare_documents(si, bl)

    assert result["status"] == "NEEDS_REVIEW"
    assert result["review_reason"] == "wrong_doc_type"


def test_compare_documents_unreadable_when_extraction_failed():
    si = {"path": "x", "ok": False, "error": "unreadable", "fields": {}, "found": {}, "text": "", "processing_failure": False}
    bl = _extracted(_full_fields(), "text")

    result = compare_documents(si, bl)

    assert result["status"] == "NEEDS_REVIEW"
    assert result["review_reason"] == "unreadable"


def test_compare_documents_processing_failure_is_distinct_from_content_review():
    si = {"path": "x", "ok": False, "error": "processing_failure", "fields": {}, "found": {}, "text": "", "processing_failure": True}
    bl = _extracted(_full_fields(), "text")

    result = compare_documents(si, bl)

    assert result["status"] == "NEEDS_REVIEW"
    assert result["processing_failure"] is True
    assert result["review_reason"] is None

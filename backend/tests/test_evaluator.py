from unittest.mock import patch

from app.evaluator import (
    _literal_match,
    _grounded,
    _compare_text,
    _compare_numeric,
    compare_documents,
    FIELD_NAMES,
)


def _extracted(fields, text, ok=True):
    found = {name: bool(value is not None and str(value).strip()) for name, value in fields.items()}
    return {"path": "x", "ok": ok, "error": None, "fields": fields, "found": found, "text": text}


def _full_fields(**overrides):
    base = {name: f"value-{name}" for name in FIELD_NAMES}
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
        result = _grounded("six containers", "container count: 6 x 40'HC")

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


def test_compare_numeric_weight_tolerance():
    assert _compare_numeric("gross_weight_kg", "22000", "22000.8") is True
    assert _compare_numeric("gross_weight_kg", "22000", "22005") is False


# -- compare_documents: end-to-end gating -------------------------------------

def test_compare_documents_ok_when_all_fields_literal_grounded_and_match():
    shared_text = (
        "Shipper: Acme\nConsignee: East Bright\nNotify: North Star\n"
        "Port of Loading: Singapore\nPort of Discharge: Rotterdam\n"
        "Containers: 4\nWeight: 22000 KG"
    )
    fields = _full_fields(
        shipper="Acme", consignee="East Bright", notify_party="North Star",
        port_of_loading="Singapore", port_of_discharge="Rotterdam",
        container_count="4", gross_weight_kg="22000",
    )
    si = _extracted(fields, shared_text)
    bl = _extracted(fields, shared_text)

    with patch("app.evaluator.ask_json") as mock_ask:
        result = compare_documents(si, bl)

    assert result["status"] == "OK"
    assert result["has_defect"] is False
    mock_ask.assert_not_called()


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
    si = {"path": "x", "ok": False, "error": "unreadable", "fields": {}, "found": {}, "text": ""}
    bl = _extracted(_full_fields(), "text")

    result = compare_documents(si, bl)

    assert result["status"] == "NEEDS_REVIEW"
    assert result["review_reason"] == "unreadable"

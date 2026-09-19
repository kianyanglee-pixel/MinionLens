from app.report import build_report

RUN_ID = "run-test-1"


def _result(email_id="email_001", category="BL_COMPARISON", comparison=None, **overrides):
    result = {
        "email_id": email_id,
        "category": category,
        "confidence": overrides.get("confidence", "high"),
        "reason": overrides.get("reason", "looks like a comparison request"),
        "comparison": comparison,
    }
    if "processing_failure" in overrides:
        result["processing_failure"] = overrides["processing_failure"]
    return result


def _comparison(**overrides):
    base = {
        "status": "OK",
        "review_reason": None,
        "has_defect": False,
        "defect_fields": [],
        "field_comparisons": {},
        "si_path": "attachments/email_001_SI.txt",
        "bl_path": "attachments/email_001_BL.txt",
    }
    base.update(overrides)
    return base


def test_ok_case():
    result = _result(comparison=_comparison())
    entry, row = build_report(result, RUN_ID)

    assert entry == {
        "category": "BL_COMPARISON",
        "status": "OK",
        "review_reason": None,
        "has_defect": False,
        "defect_fields": [],
    }
    assert row["automated_status"] == row["current_status"] == "OK"
    assert row["automated_review_reason"] == row["current_review_reason"] is None
    assert row["is_processing_failure"] is False
    assert row["awaiting_sender_response"] is False
    assert row["run_id"] == RUN_ID
    assert row["trace"]["comparison"]["si_path"] == "attachments/email_001_SI.txt"


def test_mismatch_case():
    comparison = _comparison(status="MISMATCH", has_defect=True, defect_fields=["consignee"])
    entry, row = build_report(_result(comparison=comparison), RUN_ID)

    assert entry["status"] == "MISMATCH"
    assert entry["has_defect"] is True
    assert entry["defect_fields"] == ["consignee"]
    assert row["defect_fields"] == ["consignee"]


def test_needs_review_reasons():
    for reason in ("wrong_doc_type", "missing_attachment", "unreadable", "missing_value"):
        comparison = _comparison(status="NEEDS_REVIEW", review_reason=reason)
        entry, row = build_report(_result(comparison=comparison), RUN_ID)

        assert entry["status"] == "NEEDS_REVIEW"
        assert entry["review_reason"] == reason
        assert row["automated_review_reason"] == row["current_review_reason"] == reason


def test_non_comparison_category_not_dropped():
    entry, row = build_report(_result(email_id="email_002", category="SPAM", comparison=None), RUN_ID)

    assert entry == {
        "category": "SPAM",
        "status": None,
        "review_reason": None,
        "has_defect": False,
        "defect_fields": [],
    }
    assert row["email_id"] == "email_002"
    assert row["automated_status"] is None
    assert row["trace"]["comparison"] is None


def test_processing_failure_flag_defaults_false_and_is_read_when_present():
    entry, row = build_report(_result(comparison=_comparison()), RUN_ID)
    assert row["is_processing_failure"] is False

    comparison = _comparison(status="NEEDS_REVIEW", review_reason="unreadable", processing_failure=True)
    entry, row = build_report(_result(comparison=comparison), RUN_ID)
    assert row["is_processing_failure"] is True


def test_classification_level_processing_failure_is_not_dropped():
    """classify_email() can flag processing_failure before any comparison is
    even attempted (category is None, comparison is None) — must still be
    recorded as a processing failure, not silently treated as a normal
    non-BL_COMPARISON email."""
    result = _result(category=None, comparison=None, processing_failure=True)
    entry, row = build_report(result, RUN_ID)

    assert entry["category"] is None
    assert row["is_processing_failure"] is True

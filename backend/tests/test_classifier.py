from unittest.mock import patch

from app.classifier import classify_email


def _email(**overrides):
    base = {
        "email_id": "email_001",
        "from": "ops@example.com",
        "subject": "BL check please",
        "body": "Please check the attached BL against the SI.",
        "attachments": ["attachments/email_001_SI.txt", "attachments/email_001_BL.txt"],
    }
    base.update(overrides)
    return base


def test_classify_email_happy_path():
    with patch("app.classifier.ask_json", return_value={"category": "BL_COMPARISON", "confidence": "high", "reason": "both docs attached"}):
        result = classify_email(_email())

    assert result["category"] == "BL_COMPARISON"
    assert result["processing_failure"] is False


def test_classify_email_unrecognized_label_defaults_to_general():
    with patch("app.classifier.ask_json", return_value={"category": "NOT_A_REAL_CATEGORY"}):
        result = classify_email(_email())

    assert result["category"] == "GENERAL"
    assert result["confidence"] == "low"
    assert result["processing_failure"] is False


def test_classify_email_llm_parse_failure_is_a_processing_failure_not_general():
    with patch("app.classifier.ask_json", return_value={"error": "invalid_json", "raw": "not json"}):
        result = classify_email(_email())

    assert result["processing_failure"] is True
    assert result["category"] is None

from io import BytesIO
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from docx import Document

from app.extractor import extract_fields, extract_field_pair, _text_from_docx, _text_from_pdf


def _fake_inbox(read_text=None, read_bytes=None):
    return SimpleNamespace(
        read_text=lambda path: read_text,
        read_bytes=lambda path: read_bytes,
    )


def _fake_inbox_multi(text_by_path=None, bytes_by_path=None):
    text_by_path = text_by_path or {}
    bytes_by_path = bytes_by_path or {}
    return SimpleNamespace(
        read_text=lambda path: text_by_path[path],
        read_bytes=lambda path: bytes_by_path.get(path, b""),
    )


def _empty_fields():
    return {
        "shipper": None, "consignee": None, "notify_party": None,
        "port_of_loading": None, "port_of_discharge": None,
        "container_count": None, "gross_weight_kg": None,
    }


def test_text_from_docx_extracts_paragraphs_and_tables():
    doc = Document()
    doc.add_paragraph("Shipper: Acme Freight Ltd")
    table = doc.add_table(rows=1, cols=2)
    table.rows[0].cells[0].text = "Port of Loading"
    table.rows[0].cells[1].text = "Singapore"
    buf = BytesIO()
    doc.save(buf)

    text = _text_from_docx(buf.getvalue())

    assert "Shipper: Acme Freight Ltd" in text
    assert "Port of Loading" in text
    assert "Singapore" in text


def test_text_from_pdf_joins_page_text_and_skips_none():
    fake_page_1 = MagicMock(extract_text=lambda: "Page one text")
    fake_page_2 = MagicMock(extract_text=lambda: None)
    fake_pdf = MagicMock()
    fake_pdf.pages = [fake_page_1, fake_page_2]
    fake_pdf.__enter__.return_value = fake_pdf

    with patch("app.extractor.pdfplumber.open", return_value=fake_pdf):
        text = _text_from_pdf(b"irrelevant")

    assert text == "Page one text"


def test_extract_fields_rejects_unsupported_format():
    inbox = _fake_inbox()

    result = extract_fields(inbox, "attachments/email_001_SI.pptx")

    assert result["ok"] is False
    assert result["error"] == "rejected_format:.pptx"


def test_extract_fields_pdf_with_no_text_layer_is_unreadable():
    inbox = _fake_inbox(read_bytes=b"scanned-image-only")

    with patch("app.extractor._text_from_pdf", return_value=""):
        result = extract_fields(inbox, "attachments/email_002_BL.pdf")

    assert result == {
        "path": "attachments/email_002_BL.pdf",
        "ok": False,
        "error": "unreadable",
        "fields": {},
        "found": {},
        "text": "",
        "processing_failure": False,
    }


def test_extract_fields_flags_llm_parse_failure_as_processing_failure():
    inbox = _fake_inbox(read_text="Shipper: Acme")

    with patch("app.extractor.ask_json", return_value={"error": "invalid_json", "raw": "not json"}):
        result = extract_fields(inbox, "attachments/email_004_SI.txt")

    assert result["ok"] is False
    assert result["processing_failure"] is True
    assert result["error"] == "processing_failure"


def test_extract_fields_txt_happy_path_returns_source_text():
    source_text = "Shipper: Acme\nPort of Loading: Singapore"
    inbox = _fake_inbox(read_text=source_text)
    fake_fields = {
        "shipper": "Acme",
        "consignee": None,
        "notify_party": None,
        "port_of_loading": "Singapore",
        "port_of_discharge": None,
        "container_count": None,
        "gross_weight_kg": None,
    }

    with patch("app.extractor.ask_json", return_value=fake_fields):
        result = extract_fields(inbox, "attachments/email_003_SI.txt")

    assert result["ok"] is True
    assert result["fields"]["shipper"] == "Acme"
    assert result["found"]["shipper"] is True
    assert result["found"]["consignee"] is False
    assert result["text"] == source_text


# -- extract_field_pair: one combined LLM call for SI+BL together (§6.4) ----

def test_extract_field_pair_both_readable_makes_exactly_one_llm_call():
    si_path, bl_path = "attachments/email_005_SI.txt", "attachments/email_005_BL.txt"
    inbox = _fake_inbox_multi({si_path: "Shipper: Acme", bl_path: "Shipper: Acme Corp"})
    combined_response = {
        "si": {**_empty_fields(), "shipper": "Acme"},
        "bl": {**_empty_fields(), "shipper": "Acme Corp"},
    }

    with patch("app.extractor.ask_json", return_value=combined_response) as mock_ask:
        si_result, bl_result = extract_field_pair(inbox, si_path, bl_path)

    mock_ask.assert_called_once()
    assert si_result["ok"] is True
    assert bl_result["ok"] is True
    assert si_result["fields"]["shipper"] == "Acme"
    assert bl_result["fields"]["shipper"] == "Acme Corp"


def test_extract_field_pair_falls_back_to_single_call_when_one_side_unreadable():
    si_path, bl_path = "attachments/email_006_SI.pdf", "attachments/email_006_BL.txt"
    inbox = _fake_inbox_multi({bl_path: "Shipper: Acme"}, {si_path: b"scanned-image-only"})

    with patch("app.extractor._text_from_pdf", return_value=""), \
         patch("app.extractor.ask_json", return_value={**_empty_fields(), "shipper": "Acme"}) as mock_ask:
        si_result, bl_result = extract_field_pair(inbox, si_path, bl_path)

    assert si_result["ok"] is False
    assert si_result["error"] == "unreadable"
    assert bl_result["ok"] is True
    assert bl_result["fields"]["shipper"] == "Acme"
    mock_ask.assert_called_once()  # only for the BL side — no wasted combined attempt


def test_extract_field_pair_both_unreadable_makes_no_llm_call():
    si_path, bl_path = "attachments/email_007_SI.pptx", "attachments/email_007_BL.csv"
    inbox = _fake_inbox_multi()

    with patch("app.extractor.ask_json") as mock_ask:
        si_result, bl_result = extract_field_pair(inbox, si_path, bl_path)

    mock_ask.assert_not_called()
    assert si_result["ok"] is False
    assert bl_result["ok"] is False

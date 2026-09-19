"""Smoke-test server: identical to run.py, except every LLM call site
(classifier.py's classify, extractor.py's combined SI+BL extract, and
evaluator.py's Grounding Verifier) is replaced with a canned, deterministic
fake response. No network call, no real API key needed — just a non-empty
placeholder in .env so llm.py's eager client construction doesn't crash at
import time.

Lets you exercise the full DB/API layer (POST /api/runs, GET /api/emails/...,
POST /api/emails/.../resolve, etc.) end-to-end for free, without spending
LLM quota or having any real provider configured.

Run from backend/:  python tests/smoke_server_no_llm.py
"""
import sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv
load_dotenv()

FAKE_CLASSIFY = {"category": "BL_COMPARISON", "confidence": "high", "reason": "fake: smoke test, no LLM"}
FAKE_EXTRACT = {
    "shipper": "ACME SHIPPER CO",
    "consignee": "ACME CONSIGNEE CO",
    "notify_party": "ACME NOTIFY CO",
    "port_of_loading": "PORT OF LOADING TEST",
    "port_of_discharge": "PORT OF DISCHARGE TEST",
    "container_count": 1,
    "gross_weight_kg": {"value": 1000, "unit": "KG"},
}


def fake_ask_json(system_prompt, user_prompt, model=None):
    """Same SI/BL fake values every time -> every BL_COMPARISON case ends up
    a clean OK match. Fake values won't literally appear in the real source
    text, so the Grounding Verifier prompt also gets faked (as "confirmed")
    so it never needs a real LLM call either."""
    prompt = system_prompt.lower()
    if "triage classifier" in prompt:
        return dict(FAKE_CLASSIFY)
    if "pair of shipping documents" in prompt:
        return {"si": dict(FAKE_EXTRACT), "bl": dict(FAKE_EXTRACT)}
    if "extract shipment fields" in prompt:
        return dict(FAKE_EXTRACT)
    if "attributable to a source document" in prompt:
        return {"verdict": "confirmed", "reason": "fake: assumed confirmed for smoke test"}
    return {"error": "invalid_json", "raw": "fake_ask_json: unrecognized prompt"}


with patch("app.classifier.ask_json", side_effect=fake_ask_json), \
     patch("app.extractor.ask_json", side_effect=fake_ask_json), \
     patch("app.evaluator.ask_json", side_effect=fake_ask_json):
    from flask import Flask
    from flask_cors import CORS
    from app.routes import bp

    app = Flask(__name__)
    CORS(app)
    app.register_blueprint(bp)

    if __name__ == "__main__":
        app.run(debug=False, port=5000)

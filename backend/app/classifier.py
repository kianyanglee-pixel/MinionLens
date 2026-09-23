from .llm import ask_json

CATEGORIES = ("BL_COMPARISON", "SI_REQUEST", "INVOICE_QUERY", "GENERAL", "SPAM")

CLASSIFY_SYSTEM_PROMPT = """You are an email triage classifier for a freight-forwarding inbox.
Classify the email into exactly one of: BL_COMPARISON, SI_REQUEST, INVOICE_QUERY, GENERAL, SPAM.

- BL_COMPARISON: sender wants a draft Bill of Lading (BL) checked against a Shipping Instruction (SI) for an
  EXISTING booking. This is true whether or not the documents are attached yet:
    * Attachment filenames containing both "_SI" and "_BL" (or similar) are a strong, near-decisive signal —
      this is BL_COMPARISON even if the body just says "please check the details and confirm."
    * A request to send/share/forward a draft BL "for checking" / "for review" / "asap", with NO attachments
      yet, is STILL BL_COMPARISON (the sender wants a document check to happen) — it is not GENERAL just
      because nothing is attached yet.
    * A booking/OC/reference number (e.g. "OC 5ALT-01226") being checked or confirmed means this is about an
      EXISTING booking — do not classify it as SI_REQUEST just because the word "SI" appears somewhere.
- SI_REQUEST: sender is submitting a shipping instruction for a booking that does not exist yet — a genuinely
  NEW/fresh booking, not a check or confirmation of something already drafted.
- INVOICE_QUERY: sender is asking about billing, invoices, payment status, or shipment charges — this
  includes demurrage/detention (D&D) charges, a goods-receipt (GR) posting tied to an invoice, or confirming/
  releasing/posting an amount before payment. Do not require the literal word "invoice" to appear.
- SPAM: unsolicited, irrelevant, or scam content.
- GENERAL: anything else (status checks, greetings, unrelated correspondence).

If the email includes a forwarded thread or older quoted messages below the main text, classify based on the
PRIMARY message at the top — a trailing "please follow the previous instruction" quote does not override a
clear request stated above it.

Think through which category fits before answering. Respond with strict JSON in this exact key order:
{"reason": "<one short sentence explaining the decision>", "category": "<one of the five>", "confidence": "high"|"medium"|"low"}."""


def classify_email(email: dict, llm_api_key: str | None = None) -> dict:
    attachment_names = [path.split("/")[-1] for path in email.get("attachments", [])]
    user_prompt = (
        f"Attachment filenames: {attachment_names}\n"
        f"From: {email.get('from', '')}\n"
        f"Subject: {email.get('subject', '')}\n"
        f"Body:\n{email.get('body', '')}"
    )
    result = ask_json(CLASSIFY_SYSTEM_PROMPT, user_prompt, api_key=llm_api_key)

    if result.get("error") == "invalid_json":
        # The LLM call succeeded but its response couldn't be parsed — a
        # processing failure, not a content judgment. Distinct from
        # defaulting to GENERAL, so the Confidence Gate can route this to a
        # retry rather than silently mislabeling the email (§2.4-F).
        return {
            "email_id": email.get("email_id"),
            "category": None,
            "confidence": "low",
            "reason": "LLM response could not be parsed as JSON",
            "processing_failure": True,
        }

    category = result.get("category")
    confidence = result.get("confidence", "low")
    reason = result.get("reason", "")
    if category not in CATEGORIES:
        category = "GENERAL"
        confidence = "low"
        reason = f"unrecognized label from model: {result.get('category')!r}"

    return {
        "email_id": email.get("email_id"),
        "category": category,
        "confidence": confidence,
        "reason": reason,
        "processing_failure": False,
    }

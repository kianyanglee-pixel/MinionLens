from .llm import ask_json

CATEGORIES = ("BL_COMPARISON", "SI_REQUEST", "INVOICE_QUERY", "GENERAL", "SPAM")

CLASSIFY_SYSTEM_PROMPT = """You are an email triage classifier for a freight-forwarding inbox.
Classify the email into exactly one of: BL_COMPARISON, SI_REQUEST, INVOICE_QUERY, GENERAL, SPAM.

- BL_COMPARISON: sender wants a draft Bill of Lading checked against a Shipping Instruction, or attaches both an SI and a BL.
- SI_REQUEST: sender is submitting a brand-new Shipping Instruction for a fresh booking (no comparison requested).
- INVOICE_QUERY: sender is asking about billing, invoices, or payment status.
- SPAM: unsolicited, irrelevant, or scam content.
- GENERAL: anything else (status checks, greetings, unrelated correspondence).

Respond with strict JSON: {"category": "<one of the five>", "confidence": "high"|"medium"|"low", "reason": "<one short sentence>"}."""


def classify_email(email: dict) -> dict:
    attachment_names = [path.split("/")[-1] for path in email.get("attachments", [])]
    user_prompt = (
        f"From: {email.get('from', '')}\n"
        f"Subject: {email.get('subject', '')}\n"
        f"Body:\n{email.get('body', '')}\n"
        f"Attachment filenames: {attachment_names}"
    )
    result = ask_json(CLASSIFY_SYSTEM_PROMPT, user_prompt)

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
    }

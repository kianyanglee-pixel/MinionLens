"""the_invigilator.py — mechanical grader for the llm.py pipeline's output.

Downloads submission.json from Supabase Storage (submissions/submission.json,
the file routes.py's create_run() uploads via Inbox.submit()) and diffs it,
entry by entry, against this folder's ground_truth.json. Writes a plain-text
report card to report_card/performance_{X}.txt, X auto-incrementing per run.

"LLM over LLM": every metric, confusion matrix, and mistake list is computed
with plain deterministic code — no AI involved, same inputs always give the
same numbers. The one deliberate exception is the final AI RECOMMENDATIONS
section, which calls our own llm.py's ask_json() to have the active LLM
provider critique the pipeline's own mistakes and suggest fixes. Nowhere
else in this file calls an LLM.
"""
import json
from collections import Counter
from datetime import datetime, timezone
import subprocess
import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")  # headless — this script never needs an on-screen window
import matplotlib.pyplot as plt  # noqa: E402

STATS_BUNDLE_DIR = Path(__file__).resolve().parent
BACKEND_DIR = STATS_BUNDLE_DIR.parent / "backend"
REPORT_CARD_DIR = STATS_BUNDLE_DIR / "report_card"
SUMMARY_GRAPHS_DIR = STATS_BUNDLE_DIR / "summary_graphs"
sys.path.insert(0, str(BACKEND_DIR))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(BACKEND_DIR / ".env")

from loader import Inbox  # noqa: E402
from app.llm import ask_json, client, DEFAULT_MODEL  # noqa: E402
from app import db  # noqa: E402
from app.classifier import classify_email  # noqa: E402
from app.evaluator import compare_documents  # noqa: E402
from app.extractor import extract_field_pair, extract_fields  # noqa: E402
from app.unit_normalizer import to_kg  # noqa: E402

SUBMISSION_PATH = "submissions/submission.json"


def _detect_llm_provider() -> str:
    """Figures out which of llm.py's provider blocks is currently active by
    inspecting the `client` object it constructed — llm.py only ever
    uncomments one block at a time, so this stays accurate without llm.py
    needing to declare its own provider name anywhere."""
    module_name = type(client).__module__

    if "genai" in module_name:
        return "Google Gemini (direct)"

    base_url = str(getattr(client, "base_url", ""))
    if "openrouter.ai" in base_url:
        return "OpenRouter"
    if "localhost:11434" in base_url or "ollama" in base_url:
        return "Ollama (local)"
    if "api.openai.com" in base_url:
        return "OpenAI (direct)"
    return f"Unknown provider (client={module_name}, base_url={base_url or 'n/a'})"


def _llm_info_line() -> str:
    return f"{_detect_llm_provider()} — model: {DEFAULT_MODEL}"


def _git_username() -> str:
    """Reads the machine's configured git user.name — on this repo that's
    the same as the GitHub username. Falls back to "unknown" if git isn't
    installed/configured, so a missing username never crashes a report."""
    try:
        result = subprocess.run(
            ["git", "config", "user.name"],
            capture_output=True, text=True, check=True,
        )
        return result.stdout.strip() or "unknown"
    except Exception:
        return "unknown"


def _load_ground_truth() -> dict:
    return json.loads((STATS_BUNDLE_DIR / "ground_truth.json").read_text())


def _load_submission(inbox: Inbox) -> dict:
    """Pulled live from Supabase, not a local copy — the_invigilator grades
    whatever the pipeline actually uploaded, not a stale snapshot."""
    return json.loads(inbox._supabase_download(SUBMISSION_PATH))


def _next_index() -> int:
    """Shared counter for performance_{X}.txt and graphs_{X}.jpg, so a run's
    text report and its dashboard always carry the same X."""
    REPORT_CARD_DIR.mkdir(parents=True, exist_ok=True)
    SUMMARY_GRAPHS_DIR.mkdir(parents=True, exist_ok=True)
    x = 1
    while (REPORT_CARD_DIR / f"performance_{x}.txt").exists() or (SUMMARY_GRAPHS_DIR / f"graphs_{x}.jpg").exists():
        x += 1
    return x


def _label(value) -> str:
    """Normalizes a raw field value (incl. None) to a stable string label
    for use as a dict key / class name in the metrics below."""
    return "null" if value is None else str(value)


# -- multinomial classification metrics (category / status / review_reason) --

def _multinomial_metrics(triples: list) -> dict:
    """triples: list of (email_id, true_label, predicted_label) strings."""
    labels = sorted({t for _, t, _ in triples} | {p for _, _, p in triples})
    total = len(triples)
    correct = sum(1 for _, t, p in triples if t == p)
    accuracy = correct / total if total else 0.0

    per_class = {}
    for label in labels:
        tp = sum(1 for _, t, p in triples if t == label and p == label)
        fp = sum(1 for _, t, p in triples if t != label and p == label)
        fn = sum(1 for _, t, p in triples if t == label and p != label)
        precision = tp / (tp + fp) if (tp + fp) else 0.0
        recall = tp / (tp + fn) if (tp + fn) else 0.0
        f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) else 0.0
        support = sum(1 for _, t, _ in triples if t == label)
        per_class[label] = {
            "precision": round(precision, 4),
            "recall": round(recall, 4),
            "f1": round(f1, 4),
            "support": support,
        }

    macro_f1 = sum(c["f1"] for c in per_class.values()) / len(per_class) if per_class else 0.0

    confusion_matrix = {t: {p: 0 for p in labels} for t in labels}
    for _, t, p in triples:
        confusion_matrix[t][p] += 1

    errors = [{"email_id": eid, "true": t, "predicted": p} for eid, t, p in triples if t != p]

    return {
        "correct": correct,
        "total": total,
        "accuracy": round(accuracy, 4),
        "accuracy_comment": "How often the pipeline's answer exactly matched the correct one, out of every email checked.",
        "macro_f1": round(macro_f1, 4),
        "macro_f1_comment": "One overall score that treats every label fairly, so rare labels can't hide behind common ones.",
        "per_class": per_class,
        "per_class_comment": "For each label: how trustworthy a guess of it is (precision), and how many real cases it caught (recall).",
        "confusion_matrix": confusion_matrix,
        "confusion_matrix_comment": "Shows what it actually predicted versus the correct answer, so you can see which labels get confused for which.",
        "errors": errors,
    }


# -- binary metrics (has_defect) ---------------------------------------------

def _binary_metrics(triples: list) -> dict:
    """triples: list of (email_id, true_bool, predicted_bool)."""
    tp = sum(1 for _, t, p in triples if t and p)
    tn = sum(1 for _, t, p in triples if not t and not p)
    fp = sum(1 for _, t, p in triples if not t and p)
    fn = sum(1 for _, t, p in triples if t and not p)
    total = len(triples)

    accuracy = (tp + tn) / total if total else 0.0
    precision = tp / (tp + fp) if (tp + fp) else 0.0
    recall = tp / (tp + fn) if (tp + fn) else 0.0
    f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) else 0.0

    # Cohen's Kappa: agreement beyond what chance alone would produce, given
    # each side's own marginal (positive-rate) distribution.
    p_observed = accuracy
    p_true_positive_rate = (tp + fn) / total if total else 0.0
    p_pred_positive_rate = (tp + fp) / total if total else 0.0
    p_expected = (
        p_true_positive_rate * p_pred_positive_rate
        + (1 - p_true_positive_rate) * (1 - p_pred_positive_rate)
    )
    kappa = (p_observed - p_expected) / (1 - p_expected) if (1 - p_expected) else 0.0

    errors = [{"email_id": eid, "true": t, "predicted": p} for eid, t, p in triples if t != p]

    return {
        "total": total,
        "accuracy": round(accuracy, 4),
        "accuracy_comment": "How often 'has a defect or not' matched the real answer, out of every email checked.",
        "precision": round(precision, 4),
        "precision_comment": "When it raised a defect flag, how often that flag turned out to be correct.",
        "recall": round(recall, 4),
        "recall_comment": "Out of every email that truly had a defect, how many it actually caught.",
        "f1": round(f1, 4),
        "f1_comment": "One score balancing precision and recall together, so neither can be gamed alone.",
        "confusion_matrix": {"tp": tp, "fp": fp, "tn": tn, "fn": fn},
        "confusion_matrix_comment": "Splits results into caught defects, false alarms, missed defects, and correctly cleared emails.",
        "cohens_kappa": round(kappa, 4),
        "cohens_kappa_comment": "How much better than random guessing this is — 0 means pure luck, 1 means perfect.",
        "errors": errors,
    }


# -- set-valued metrics (defect_fields) --------------------------------------

def _defect_fields_metrics(triples: list) -> dict:
    """triples: list of (email_id, true_fields, predicted_fields), each a
    list of field-name strings."""
    total = len(triples)
    exact_matches = sum(1 for _, t, p in triples if set(t) == set(p))
    exact_match_accuracy = exact_matches / total if total else 0.0

    jaccards = []
    field_tp, field_fp, field_fn = {}, {}, {}
    errors = []

    for eid, t, p in triples:
        t_set, p_set = set(t), set(p)
        union = t_set | p_set
        jaccards.append(len(t_set & p_set) / len(union) if union else 1.0)

        if t_set != p_set:
            errors.append({
                "email_id": eid,
                "true": sorted(t_set),
                "predicted": sorted(p_set),
                "missing": sorted(t_set - p_set),
                "extra": sorted(p_set - t_set),
            })

        for field in union:
            if field in t_set and field in p_set:
                field_tp[field] = field_tp.get(field, 0) + 1
            elif field in p_set:
                field_fp[field] = field_fp.get(field, 0) + 1
            else:
                field_fn[field] = field_fn.get(field, 0) + 1

    all_fields = sorted(set(field_tp) | set(field_fp) | set(field_fn))
    per_field = {}
    for field in all_fields:
        tp, fp, fn = field_tp.get(field, 0), field_fp.get(field, 0), field_fn.get(field, 0)
        precision = tp / (tp + fp) if (tp + fp) else 0.0
        recall = tp / (tp + fn) if (tp + fn) else 0.0
        per_field[field] = {"precision": round(precision, 4), "recall": round(recall, 4), "tp": tp, "fp": fp, "fn": fn}

    mean_jaccard = sum(jaccards) / len(jaccards) if jaccards else 0.0

    return {
        "total": total,
        "exact_match_accuracy": round(exact_match_accuracy, 4),
        "exact_match_accuracy_comment": "How often it flagged the exact right set of broken fields — nothing missing, nothing extra.",
        "mean_jaccard_similarity": round(mean_jaccard, 4),
        "mean_jaccard_similarity_comment": "On average, how much its flagged fields overlapped with the truly broken ones — partial credit allowed.",
        "per_field": per_field,
        "per_field_comment": "For each field name: how reliably it gets correctly flagged as broken, across every email.",
        "errors": errors,
    }


# -- report-level rollups -----------------------------------------------------

def _rollups(ground_truth: dict, submission: dict, common_ids: list) -> dict:
    exact_row_matches = sum(
        1 for eid in common_ids
        if ground_truth[eid].get("category") == submission[eid].get("category")
        and ground_truth[eid].get("status") == submission[eid].get("status")
        and ground_truth[eid].get("review_reason") == submission[eid].get("review_reason")
        and ground_truth[eid].get("has_defect") == submission[eid].get("has_defect")
        and set(ground_truth[eid].get("defect_fields") or []) == set(submission[eid].get("defect_fields") or [])
    )
    row_exact_match_rate = exact_row_matches / len(common_ids) if common_ids else 0.0

    processing_failures = sum(
        1 for eid in common_ids
        if submission[eid].get("status") == "NEEDS_REVIEW" and submission[eid].get("review_reason") is None
    )
    processing_failure_rate = processing_failures / len(common_ids) if common_ids else 0.0

    coverage = len(common_ids) / len(ground_truth) if ground_truth else 0.0

    return {
        "row_exact_match_count": exact_row_matches,
        "row_exact_match_total": len(common_ids),
        "row_exact_match_rate": round(row_exact_match_rate, 4),
        "row_exact_match_rate_comment": "Percent of emails where every single field was predicted correctly, not just one or two.",
        "processing_failure_count": processing_failures,
        "processing_failure_rate": round(processing_failure_rate, 4),
        "processing_failure_rate_comment": "Percent of emails the pipeline itself choked on — a system hiccup, not a wrong content guess.",
        "coverage": round(coverage, 4),
        "coverage_comment": "Percent of our answer-key emails that the pipeline actually produced a result for.",
    }


def evaluate(ground_truth: dict, submission: dict) -> dict:
    common_ids = sorted(set(ground_truth) & set(submission))
    missing_in_submission = sorted(set(ground_truth) - set(submission))
    extra_in_submission = sorted(set(submission) - set(ground_truth))

    category_triples = [(eid, _label(ground_truth[eid].get("category")), _label(submission[eid].get("category"))) for eid in common_ids]
    status_triples = [(eid, _label(ground_truth[eid].get("status")), _label(submission[eid].get("status"))) for eid in common_ids]
    review_reason_triples = [(eid, _label(ground_truth[eid].get("review_reason")), _label(submission[eid].get("review_reason"))) for eid in common_ids]
    has_defect_triples = [(eid, bool(ground_truth[eid].get("has_defect")), bool(submission[eid].get("has_defect"))) for eid in common_ids]
    defect_fields_triples = [
        (eid, ground_truth[eid].get("defect_fields") or [], submission[eid].get("defect_fields") or [])
        for eid in common_ids
    ]

    review_reason = _multinomial_metrics(review_reason_triples)
    defect_fields = _defect_fields_metrics(defect_fields_triples)
    has_defect = _binary_metrics(has_defect_triples)

    # True-positive-subset stats: review_reason/defect_fields can only ever
    # be non-null/non-empty when the pipeline itself decided NEEDS_REVIEW/
    # MISMATCH, so scoring them over every email pads the headline accuracy
    # with cases that can't meaningfully be wrong. These numbers restrict to
    # just the emails where the answer key says a real value should be
    # there, so they can't be inflated by that padding.
    review_reason_subset = [t for t in review_reason_triples if t[1] != "null"]
    review_reason_subset_correct = sum(1 for _, t, p in review_reason_subset if t == p)
    defect_fields_subset = [t for t in defect_fields_triples if t[1]]
    defect_fields_subset_correct = sum(1 for _, t, p in defect_fields_subset if set(t) == set(p))
    review_reason["subset"] = {"total": len(review_reason_subset), "correct": review_reason_subset_correct}
    defect_fields["subset"] = {"total": len(defect_fields_subset), "correct": defect_fields_subset_correct}
    has_defect["subset"] = {
        "total": has_defect["confusion_matrix"]["tp"] + has_defect["confusion_matrix"]["fn"],
        "correct": has_defect["confusion_matrix"]["tp"],
    }

    return {
        "evaluated_at": datetime.now(timezone.utc).isoformat(),
        "ground_truth_count": len(ground_truth),
        "submission_count": len(submission),
        "evaluated_count": len(common_ids),
        "missing_in_submission": missing_in_submission,
        "extra_in_submission": extra_in_submission,
        "category": _multinomial_metrics(category_triples),
        "status": _multinomial_metrics(status_triples),
        "review_reason": review_reason,
        "defect_fields": defect_fields,
        "has_defect": has_defect,
        "rollups": _rollups(ground_truth, submission, common_ids),
    }


# -- plain-text rendering ------------------------------------------------------

RULE = "=" * 70
SUBRULE = "-" * 70


def _pct(fraction: float) -> str:
    return f"{fraction * 100:.1f}%"


def _render_subset_line(subset: dict, noun: str) -> str:
    total, correct = subset["total"], subset["correct"]
    if total == 0:
        return f"(No emails in the answer key actually needed {noun} — nothing to check here.)"
    return f"Of the {total} emails that truly {noun}, {correct} got it exactly right ({_pct(correct / total)})."


def _render_multinomial_section(title: str, description: str, section: dict) -> list:
    lines = [SUBRULE, title, description, SUBRULE, ""]
    lines.append(f"Accuracy: {_pct(section['accuracy'])} ({section['correct']}/{section['total']} correct)")
    lines.append(f"  -> {section['accuracy_comment']}")
    lines.append(f"Macro-F1: {section['macro_f1']}")
    lines.append(f"  -> {section['macro_f1_comment']}")
    lines.append("")
    lines.append(f"Per-label breakdown ({section['per_class_comment']}):")
    for label, stats in sorted(section["per_class"].items()):
        lines.append(
            f"  {label:<20} precision {stats['precision']:.2f}   recall {stats['recall']:.2f}   "
            f"f1 {stats['f1']:.2f}   ({stats['support']} in answer key)"
        )
    lines.append("")
    lines.append(f"Confusion matrix ({section['confusion_matrix_comment']}):")
    for true_label, predicted_counts in sorted(section["confusion_matrix"].items()):
        breakdown = ", ".join(f"{p}={c}" for p, c in sorted(predicted_counts.items()) if c)
        lines.append(f"  actual {true_label:<20} -> predicted: {breakdown or '(nothing)'}")
    lines.append("")
    return lines


def _render_defect_fields_section(section: dict) -> list:
    lines = [
        SUBRULE,
        "DEFECT_FIELDS — which specific fields it flagged as broken",
        SUBRULE,
        "",
        f"Exact-match accuracy: {_pct(section['exact_match_accuracy'])}",
        f"  -> {section['exact_match_accuracy_comment']}",
        f"Mean Jaccard overlap: {section['mean_jaccard_similarity']}",
        f"  -> {section['mean_jaccard_similarity_comment']}",
        "",
        f"Per-field breakdown ({section['per_field_comment']}):",
    ]
    for field, stats in sorted(section["per_field"].items()):
        lines.append(f"  {field:<20} precision {stats['precision']:.2f}   recall {stats['recall']:.2f}")
    lines.append("")
    return lines


def _render_has_defect_section(section: dict) -> list:
    cm = section["confusion_matrix"]
    lines = [
        SUBRULE,
        "HAS_DEFECT — yes/no, did it think this shipment had a problem",
        SUBRULE,
        "",
        f"Accuracy: {_pct(section['accuracy'])}",
        f"  -> {section['accuracy_comment']}",
        f"Precision: {section['precision']}",
        f"  -> {section['precision_comment']}",
        f"Recall: {section['recall']}",
        f"  -> {section['recall_comment']}",
        f"F1: {section['f1']}",
        f"  -> {section['f1_comment']}",
        f"Cohen's Kappa: {section['cohens_kappa']}",
        f"  -> {section['cohens_kappa_comment']}",
        "",
        f"Confusion matrix ({section['confusion_matrix_comment']}):",
        f"  caught defects (true positive):  {cm['tp']}",
        f"  false alarms (false positive):   {cm['fp']}",
        f"  correctly cleared (true negative): {cm['tn']}",
        f"  missed defects (false negative): {cm['fn']}",
        "",
    ]
    return lines


def _render_mistakes_section(report: dict) -> list:
    lines = [RULE, "MISTAKES", RULE, ""]

    def _multinomial_mistakes(title, section):
        lines.append(f"{title} ({len(section['errors'])} total):")
        if section["errors"]:
            for err in section["errors"]:
                lines.append(f"  {err['email_id']}: actual={err['true']}, predicted={err['predicted']}")
        else:
            lines.append("  no mistakes — every email in this field matched the answer key.")
        lines.append("")

    _multinomial_mistakes("CATEGORY MISTAKES", report["category"])
    _multinomial_mistakes("STATUS MISTAKES", report["status"])
    _multinomial_mistakes("REVIEW_REASON MISTAKES", report["review_reason"])

    defect_fields_errors = report["defect_fields"]["errors"]
    lines.append(f"DEFECT_FIELDS MISTAKES ({len(defect_fields_errors)} total):")
    if defect_fields_errors:
        for err in defect_fields_errors:
            lines.append(
                f"  {err['email_id']}: actual={err['true']}, predicted={err['predicted']}"
                f" (missing={err['missing']}, extra={err['extra']})"
            )
    else:
        lines.append("  no mistakes — every email's flagged-field set matched the answer key exactly.")
    lines.append("")

    has_defect_errors = report["has_defect"]["errors"]
    lines.append(f"HAS_DEFECT MISTAKES ({len(has_defect_errors)} total):")
    if has_defect_errors:
        for err in has_defect_errors:
            lines.append(f"  {err['email_id']}: actual={err['true']}, predicted={err['predicted']}")
    else:
        lines.append("  no mistakes — has_defect matched the answer key for every email.")
    lines.append("")

    return lines


# -- AI recommendations (the one deliberate exception to "no LLM calls") -----

RECOMMENDATIONS_SYSTEM_PROMPT = """You are reviewing a mechanical grading report for a freight-forwarding email
pipeline with three LLM-driven stages: classifier.py (picks an email's category), extractor.py (pulls fields off
a Shipping Instruction / Bill of Lading), and evaluator.py (compares the two extractions and also runs an LLM
"grounding verifier" to confirm a value is attributable to its source text). You'll be given (1) a summary of
where its predictions diverged from the correct answers on a real batch of graded emails — accuracy/F1 per field,
confusion matrices, the worst-performing labels/fields, the most common misclassification patterns — and (2) the
real email and SI/BL attachment content behind a handful of emails it got wrong, so you can see exactly what
those documents actually said.

Suggest concrete, specific next steps to improve accuracy, split into three groups:
- "harness_changes": deterministic, non-LLM logic changes in evaluator.py (e.g. fuzzy-match thresholds, the
  grounding/literal-match logic, weight tolerance) that could fix a pattern of errors without touching any prompt.
- "prompt_changes": specific wording changes to the system prompts in classifier.py, evaluator.py's grounding
  verifier, or extractor.py.
- "general_advice": anything worth flagging that doesn't fit either bucket above — e.g. the active LLM/model
  itself may be a poor fit for this task (too small, weak JSON-mode support, weak instruction-following for its
  size), a pattern that looks like noisy or ambiguous ground truth rather than a pipeline bug, a stage that may
  need a different approach entirely rather than a prompt tweak, or a systemic issue spanning multiple stages.

Every suggestion must reference the actual pattern in the data given to you — and, where relevant, what the
real document text actually said — not generic advice. Respond with strict JSON:
{"harness_changes": [{"file": "<filename>", "change": "<specific change>", "why": "<pattern that motivates it>"}],
"prompt_changes": [{"file": "<filename>", "change": "<specific change>", "why": "<pattern that motivates it>"}],
"general_advice": [{"observation": "<specific observation or suggestion>", "why": "<pattern that motivates it>"}]}"""


def _pick_evidence_email_ids(report: dict, limit: int = 6) -> list:
    """A small, representative sample of mistaken email_ids across fields —
    not all 500+ — to fetch real documents for."""
    ids = []

    def add_from(errors, n):
        for err in errors[:n]:
            if err["email_id"] not in ids:
                ids.append(err["email_id"])

    add_from(report["category"]["errors"], 2)
    add_from(report["status"]["errors"], 2)
    add_from(report["defect_fields"]["errors"], 1)
    add_from(report["has_defect"]["errors"], 1)
    return ids[:limit]


def _gather_evidence(inbox: Inbox, email_ids: list) -> list:
    """Pulls the real email + SI/BL attachment text for a handful of
    mistaken emails straight from the emails_and_attachment Supabase bucket
    (same bucket/methods the pipeline itself uses), so the AI recommendation
    is grounded in actual documents, not just labels."""
    evidence = []
    for email_id in email_ids:
        try:
            email = inbox.get(email_id)
        except Exception:
            continue

        attachments = {}
        for att_path in email.get("attachments", []):
            try:
                text = inbox.read_text(att_path)
            except Exception:
                continue
            attachments[att_path.rsplit("/", 1)[-1]] = text[:1500]  # capped, keeps the LLM call small

        evidence.append({
            "email_id": email_id,
            "subject": email.get("subject"),
            "body": (email.get("body") or "")[:1000],
            "attachments": attachments,
        })
    return evidence


def _top_confusions(errors: list, limit: int = 5) -> list:
    counts = Counter((e["true"], e["predicted"]) for e in errors)
    return [{"true": t, "predicted": p, "count": c} for (t, p), c in counts.most_common(limit)]


def _worst_entries(stats_by_key: dict, limit: int = 5) -> list:
    """Lowest-F1 (or lowest precision+recall, for defect_fields) entries first."""
    def score(stats):
        return stats.get("f1", stats.get("precision", 0) + stats.get("recall", 0))

    ranked = sorted(stats_by_key.items(), key=lambda kv: score(kv[1]))
    return [{"label": label, **stats} for label, stats in ranked[:limit]]


def _build_llm_summary(report: dict) -> dict:
    """Condenses the full report into worst-offenders + top patterns, instead
    of dumping every raw mistake — keeps the LLM call cheap and focused."""
    def multinomial_summary(section):
        return {
            "accuracy": section["accuracy"],
            "macro_f1": section["macro_f1"],
            "worst_labels": _worst_entries(section["per_class"]),
            "most_common_confusions": _top_confusions(section["errors"]),
        }

    return {
        "category": multinomial_summary(report["category"]),
        "status": multinomial_summary(report["status"]),
        "review_reason": multinomial_summary(report["review_reason"]),
        "has_defect": {
            "accuracy": report["has_defect"]["accuracy"],
            "precision": report["has_defect"]["precision"],
            "recall": report["has_defect"]["recall"],
            "f1": report["has_defect"]["f1"],
            "cohens_kappa": report["has_defect"]["cohens_kappa"],
            "confusion_matrix": report["has_defect"]["confusion_matrix"],
        },
        "defect_fields": {
            "exact_match_accuracy": report["defect_fields"]["exact_match_accuracy"],
            "mean_jaccard_similarity": report["defect_fields"]["mean_jaccard_similarity"],
            "worst_fields": _worst_entries(report["defect_fields"]["per_field"]),
        },
        "overall": {
            "row_exact_match_rate": report["rollups"]["row_exact_match_rate"],
            "processing_failure_rate": report["rollups"]["processing_failure_rate"],
            "coverage": report["rollups"]["coverage"],
        },
    }


def get_ai_recommendations(report: dict, inbox: Inbox) -> dict:
    """The one place in this file that calls an LLM — deliberately, to have
    the active provider critique its own pipeline's mistakes, backed by the
    real documents (also fetched live from Supabase, not a local copy)
    behind a sample of those mistakes. Never raises: a failed/unparsable
    call just becomes an "error" the report renders."""
    summary = _build_llm_summary(report)
    evidence = _gather_evidence(inbox, _pick_evidence_email_ids(report))

    user_prompt = (
        "Today's evaluation summary:\n\n" + json.dumps(summary, indent=2)
        + "\n\nReal documents behind a few representative mistakes:\n\n"
        + json.dumps(evidence, indent=2)
    )

    try:
        result = ask_json(RECOMMENDATIONS_SYSTEM_PROMPT, user_prompt)
    except Exception as exc:
        return {"error": f"LLM call failed: {exc}"}

    if not isinstance(result, dict) or result.get("error") == "invalid_json":
        return {"error": "LLM response could not be parsed as JSON"}

    harness_changes = result.get("harness_changes")
    prompt_changes = result.get("prompt_changes")
    general_advice = result.get("general_advice")
    return {
        "harness_changes": harness_changes if isinstance(harness_changes, list) else [],
        "prompt_changes": prompt_changes if isinstance(prompt_changes, list) else [],
        "general_advice": general_advice if isinstance(general_advice, list) else [],
    }


def _render_recommendation_items(lines: list, title: str, items: list) -> None:
    lines.append(f"{title}:")
    if items:
        for item in items:
            if not isinstance(item, dict):
                continue
            file = item.get("file", "?")
            change = item.get("change", "")
            why = item.get("why")
            lines.append(f"  [{file}] {change}")
            if why:
                lines.append(f"    why: {why}")
    else:
        lines.append("  (none suggested)")
    lines.append("")


def _render_general_advice_items(lines: list, items: list) -> None:
    lines.append("General advice (model choice, data quality, or anything else outside harness/prompt tweaks):")
    if items:
        for item in items:
            if not isinstance(item, dict):
                continue
            observation = item.get("observation", "")
            why = item.get("why")
            lines.append(f"  - {observation}")
            if why:
                lines.append(f"    why: {why}")
    else:
        lines.append("  (none suggested)")
    lines.append("")


def _render_recommendations_section(recommendations: dict) -> list:
    lines = [
        RULE,
        "AI RECOMMENDATIONS — LLM-generated advice, not a graded metric. Review before applying.",
        RULE,
        "",
    ]
    if recommendations.get("error"):
        lines.append(f"Could not generate recommendations: {recommendations['error']}")
        lines.append("")
        return lines

    _render_recommendation_items(
        lines, "Hardcoded harness changes to consider (evaluator.py logic, no prompt involved)",
        recommendations["harness_changes"],
    )
    _render_recommendation_items(
        lines, "Prompt wording changes to consider (classifier.py / evaluator.py / extractor.py)",
        recommendations["prompt_changes"],
    )
    _render_general_advice_items(lines, recommendations["general_advice"])
    return lines


def render_text(report: dict, recommendations: dict) -> str:
    lines = [
        RULE,
        "THE INVIGILATOR — Pipeline Report Card",
        f"Run by: {_git_username()}",
        f"Evaluated at: {report['evaluated_at']}",
        f"AI recommendations powered by: {_llm_info_line()}",
        RULE,
        "",
        f"Emails in answer key:     {report['ground_truth_count']}",
        f"Emails in submission:     {report['submission_count']}",
        f"Emails actually graded:   {report['evaluated_count']} ({_pct(report['rollups']['coverage'])} coverage)",
        f"  -> {report['rollups']['coverage_comment']}",
    ]
    if report["missing_in_submission"]:
        lines.append(f"Missing from submission ({len(report['missing_in_submission'])}): {', '.join(report['missing_in_submission'])}")
    else:
        lines.append("Missing from submission: none")
    if report["extra_in_submission"]:
        lines.append(f"Extra in submission, not in answer key ({len(report['extra_in_submission'])}): {', '.join(report['extra_in_submission'])}")
    else:
        lines.append("Extra in submission, not in answer key: none")
    lines.append("")

    lines += _render_multinomial_section(
        "CATEGORY — what type of email it thought this was",
        "(BL_COMPARISON / SI_REQUEST / INVOICE_QUERY / GENERAL / SPAM)",
        report["category"],
    )
    lines += _render_multinomial_section(
        "STATUS — the overall verdict on the shipment documents",
        "(OK / MISMATCH / NEEDS_REVIEW)",
        report["status"],
    )
    lines += _render_multinomial_section(
        "REVIEW_REASON — why it asked a human to take a look",
        "(only set when status is NEEDS_REVIEW)",
        report["review_reason"],
    )
    lines.append(_render_subset_line(report["review_reason"]["subset"], "needed review"))
    lines.append("")
    lines += _render_defect_fields_section(report["defect_fields"])
    lines.append(_render_subset_line(report["defect_fields"]["subset"], "had a defect"))
    lines.append("")
    lines += _render_has_defect_section(report["has_defect"])
    lines.append(_render_subset_line(report["has_defect"]["subset"], "had a defect"))
    lines.append("")

    rollups = report["rollups"]
    lines += [
        RULE,
        "OVERALL SUMMARY",
        RULE,
        "",
        f"Row-level exact match: {_pct(rollups['row_exact_match_rate'])} ({rollups['row_exact_match_count']}/{rollups['row_exact_match_total']})",
        f"  -> {rollups['row_exact_match_rate_comment']}",
        f"Processing-failure rate: {_pct(rollups['processing_failure_rate'])} ({rollups['processing_failure_count']} emails)",
        f"  -> {rollups['processing_failure_rate_comment']}",
        f"Coverage: {_pct(rollups['coverage'])}",
        f"  -> {rollups['coverage_comment']}",
        RULE,
        "",
    ]

    lines += _render_mistakes_section(report)
    lines += _render_recommendations_section(recommendations)

    return "\n".join(lines)


# -- visual dashboard (deterministic — same evaluate() results, no AI) -------

def _plot_accuracy_bar(ax, report: dict) -> None:
    labels = ["Category", "Status", "Review\nreason", "Has\ndefect", "Defect fields\n(exact match)"]
    values = [
        report["category"]["accuracy"],
        report["status"]["accuracy"],
        report["review_reason"]["accuracy"],
        report["has_defect"]["accuracy"],
        report["defect_fields"]["exact_match_accuracy"],
    ]
    bars = ax.bar(labels, [v * 100 for v in values], color="#4C72B0")
    ax.set_ylim(0, 105)
    ax.set_ylabel("Accuracy (%)")
    ax.set_title("Accuracy by field")
    for bar, v in zip(bars, values):
        ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + 1.5, f"{v * 100:.1f}%", ha="center", fontsize=9)


def _plot_confusion_heatmap(ax, section: dict, title: str) -> None:
    labels = sorted(section["confusion_matrix"].keys())
    matrix = [[section["confusion_matrix"][t].get(p, 0) for p in labels] for t in labels]
    peak = max((max(row) for row in matrix), default=1) or 1
    ax.imshow(matrix, cmap="Blues", vmin=0, vmax=peak)
    ax.set_xticks(range(len(labels)))
    ax.set_xticklabels(labels, rotation=45, ha="right", fontsize=8)
    ax.set_yticks(range(len(labels)))
    ax.set_yticklabels(labels, fontsize=8)
    ax.set_xlabel("Predicted")
    ax.set_ylabel("Actual")
    ax.set_title(title)
    for i, row in enumerate(matrix):
        for j, value in enumerate(row):
            if value:
                ax.text(j, i, str(value), ha="center", va="center", fontsize=8,
                        color="white" if value > peak / 2 else "black")


def _plot_defect_fields_correct_wrong(ax, section: dict) -> None:
    total = section["total"]
    wrong = len(section["errors"])
    correct = total - wrong
    values = [correct, wrong]
    bars = ax.bar(["Correct\n(every field right)", "Wrong\n(at least one field off)"], values, color=["#4C72B0", "#DD8452"])
    ax.set_ylabel("Emails")
    ax.set_title("Defect fields — exact match or not")
    for bar, v in zip(bars, values):
        pct = v / total * 100 if total else 0.0
        ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + max(total * 0.02, 0.5), f"{v} ({pct:.1f}%)", ha="center", fontsize=9)


def _plot_has_defect_matrix(ax, section: dict) -> None:
    cm = section["confusion_matrix"]
    matrix = [[cm["tp"], cm["fn"]], [cm["fp"], cm["tn"]]]
    peak = max(max(row) for row in matrix) or 1
    ax.imshow(matrix, cmap="Oranges", vmin=0, vmax=peak)
    ax.set_xticks([0, 1])
    ax.set_xticklabels(["Predicted:\ndefect", "Predicted:\nno defect"], fontsize=8)
    ax.set_yticks([0, 1])
    ax.set_yticklabels(["Actual:\ndefect", "Actual:\nno defect"], fontsize=8)
    ax.set_title("Has-defect confusion matrix")
    for i, row in enumerate(matrix):
        for j, value in enumerate(row):
            ax.text(j, i, str(value), ha="center", va="center", fontsize=11,
                    color="white" if value > peak / 2 else "black")


def _plot_headline_numbers(ax, report: dict) -> None:
    ax.axis("off")
    rollups = report["rollups"]
    text = (
        f"Row-level exact match\n{_pct(rollups['row_exact_match_rate'])}\n\n"
        f"Processing-failure rate\n{_pct(rollups['processing_failure_rate'])}\n\n"
        f"Coverage\n{_pct(rollups['coverage'])}"
    )
    ax.text(0.5, 0.5, text, ha="center", va="center", fontsize=13, fontweight="bold", linespacing=1.8, transform=ax.transAxes)
    ax.set_title("Overall summary")


def render_graphs(report: dict, output_path: Path) -> None:
    """One-image dashboard, deterministic and AI-free, built straight from
    the same evaluate() results as the text report. Image format is
    inferred from output_path's extension (the_invigilator.py passes
    .jpg; the_coach.py passes .png) so the bytes always match the name."""
    fig, axes = plt.subplots(4, 2, figsize=(14, 21))
    fig.suptitle(f"Pipeline Report Card — {report['evaluated_at']}", fontsize=14, fontweight="bold")

    _plot_accuracy_bar(axes[0][0], report)
    _plot_confusion_heatmap(axes[0][1], report["category"], "Category confusion matrix")
    _plot_confusion_heatmap(axes[1][0], report["status"], "Status confusion matrix")
    _plot_confusion_heatmap(axes[1][1], report["review_reason"], "Review reason confusion matrix")
    _plot_has_defect_matrix(axes[2][0], report["has_defect"])
    _plot_defect_fields_correct_wrong(axes[2][1], report["defect_fields"])
    _plot_headline_numbers(axes[3][0], report)
    axes[3][1].axis("off")

    fig.tight_layout(rect=[0, 0, 1, 0.96])
    output_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(output_path, format=output_path.suffix.lstrip(".") or "jpg", dpi=150)
    plt.close(fig)


def main():
    print(f"Active LLM: {_llm_info_line()}")
    ground_truth = _load_ground_truth()
    inbox = Inbox("supabase")
    submission = _load_submission(inbox)
    report = evaluate(ground_truth, submission)
    recommendations = get_ai_recommendations(report, inbox)

    x = _next_index()
    report_path = REPORT_CARD_DIR / f"performance_{x}.txt"
    graph_path = SUMMARY_GRAPHS_DIR / f"graphs_{x}.jpg"

    report_path.write_text(render_text(report, recommendations), encoding="utf-8")
    render_graphs(report, graph_path)

    print(f"Wrote {report_path}")
    print(f"Wrote {graph_path}")
    print(f"  evaluated {report['evaluated_count']}/{report['ground_truth_count']} emails")
    print(f"  category accuracy:  {_pct(report['category']['accuracy'])}")
    print(f"  status accuracy:    {_pct(report['status']['accuracy'])}")
    print(f"  row exact match:    {_pct(report['rollups']['row_exact_match_rate'])}")


if __name__ == "__main__":
    main()

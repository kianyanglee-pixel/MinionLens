"""Deterministic weight-unit normalization (PRD §2.4-E).

Converting a number from one unit to another is arithmetic, not judgment,
so this stays plain code — no LLM call, ever — consistent with keeping the
comparison trust boundary deterministic (§2.4-A).
"""

_TO_KG = {
    "KG": 1.0,
    "KGS": 1.0,
    "KILOGRAM": 1.0,
    "KILOGRAMS": 1.0,
    "G": 0.001,
    "GRAM": 0.001,
    "GRAMS": 0.001,
    "LB": 0.45359237,
    "LBS": 0.45359237,
    "POUND": 0.45359237,
    "POUNDS": 0.45359237,
    "T": 1000.0,
    "MT": 1000.0,
    "TON": 1000.0,
    "TONS": 1000.0,
    "TONNE": 1000.0,
    "TONNES": 1000.0,
}


def to_kg(value, unit) -> float | None:
    """Converts a numeric value + unit string to kilograms.

    Returns None if the value or unit is missing, unparseable, or an
    unrecognized unit — the caller treats that as low-confidence and routes
    to human review, never silently assumes kg (§2.4-E).
    """
    if value is None or unit is None:
        return None
    factor = _TO_KG.get(str(unit).strip().upper())
    if factor is None:
        return None
    try:
        return float(value) * factor
    except (TypeError, ValueError):
        return None

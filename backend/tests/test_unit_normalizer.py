from app.unit_normalizer import to_kg


def test_to_kg_identity_for_kg():
    assert to_kg(22000, "KG") == 22000.0


def test_to_kg_grams():
    assert to_kg(500, "G") == 0.5


def test_to_kg_tonnes():
    assert to_kg(1, "MT") == 1000.0


def test_to_kg_case_insensitive_and_whitespace_tolerant():
    assert to_kg(10, " kg ") == 10.0


def test_to_kg_none_value_or_unit_returns_none():
    assert to_kg(None, "KG") is None
    assert to_kg(10, None) is None


def test_to_kg_unrecognized_unit_returns_none():
    assert to_kg(10, "STONE") is None


def test_to_kg_non_numeric_value_returns_none():
    assert to_kg("not-a-number", "KG") is None

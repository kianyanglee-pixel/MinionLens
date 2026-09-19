import sys
from pathlib import Path

# backend/app has no __init__.py (implicit namespace package); make backend/
# importable as top-level so `from app.report import build_report` resolves
# the same way routes.py already relies on for `from app.classifier import ...`.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

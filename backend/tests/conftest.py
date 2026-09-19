import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# app.llm builds a genai.Client at import time, which requires *a* key to be
# present (not a valid one — every LLM call in these tests is mocked, so this
# never reaches the network). Only set a placeholder if the environment
# doesn't already have a real one.
os.environ.setdefault("GEMINI_API_KEY", "test-placeholder-key")

import json
import os
import time
from dotenv import load_dotenv

load_dotenv()

MAX_RETRIES = 3
RETRYABLE_STATUS_CODES = {429, 500, 503}

# ============================================================================
# Pick ONE provider block below (uncomment it, comment the others). Every
# block ends up defining the same `client`/`DEFAULT_MODEL` contract, so only
# this file needs to change to switch providers — classifier.py/extractor.py/
# evaluator.py just call ask_json(...) and don't care which provider it is.
# ============================================================================

# -- OpenRouter -----------------------------------------------------
# One key, routes to many providers' models (Gemini, GPT, Claude, Llama, ...)
# through an OpenAI-compatible API. https://openrouter.ai/docs
# Needs OPENROUTER_API_KEY (and optionally OPENROUTER_MODEL) in .env.
# from openai import OpenAI
#
# client = OpenAI(
#     base_url="https://openrouter.ai/api/v1",
#     api_key=os.getenv("OPENROUTER_API_KEY"),
# )
# DEFAULT_MODEL = os.getenv("OPENROUTER_MODEL", "google/gemini-2.5-flash")

# -- Google Gemini (direct) ---------------------------------------------------
# Needs GEMINI_API_KEY (and optionally GEMINI_MODEL) in .env.
# from google import genai
# from google.genai import errors, types

# client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
# DEFAULT_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")

# -- OpenAI (direct) ----------------------------------------------------------
# Needs OPENAI_API_KEY (and optionally OPENAI_MODEL) in .env.
# from openai import OpenAI
#
# client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
# DEFAULT_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

# -- Ollama (local) (ACTIVE) --------------------------------------------------
# Runs entirely on your own machine via `ollama serve` (default port 11434) —
# free, no API key, and no rate limit/quota from a third party, since nothing
# leaves your computer. Trade-off: speed and output quality depend on your
# hardware and the model you pull, so worth testing on a few emails before
# trusting it for a full batch run. Install: https://ollama.com/download,
# then pull the model first, e.g. `ollama pull llama3.1:8b`.
# Uses Ollama's OpenAI-compatible endpoint, so it shares the OpenRouter/OpenAI
# call shape below — no new dependency needed.
# Needs nothing in .env by default; OLLAMA_BASE_URL/OLLAMA_MODEL optional.
from openai import OpenAI

client = OpenAI(
    base_url=os.getenv("OLLAMA_BASE_URL", "http://localhost:11434/v1"),
    api_key="ollama",  # unused by Ollama, but the client requires a value
)
DEFAULT_MODEL = os.getenv("OLLAMA_MODEL", "llama3.1:8b")


# -- ask_json for the Gemini (direct) block above, if you switch back to it -
# def ask_json(system_prompt: str, user_prompt: str, model: str = DEFAULT_MODEL) -> dict:
#     """Gemini (direct) call shape. If you switch to the OpenRouter or OpenAI
#     block above instead, swap this function body for the one commented out
#     below it (different call shape, different response shape)."""
#     for attempt in range(MAX_RETRIES):
#         try:
#             response = client.models.generate_content(
#                 model=model,
#                 contents=user_prompt,
#                 config=types.GenerateContentConfig(
#                     system_instruction=system_prompt,
#                     response_mime_type="application/json",
#                     temperature=0,
#                 ),
#             )
#             break
#         except errors.APIError as e:
#             if e.code not in RETRYABLE_STATUS_CODES or attempt == MAX_RETRIES - 1:
#                 raise
#             time.sleep(2 ** attempt)
#
#     try:
#         return json.loads(response.text)
#     except json.JSONDecodeError:
#         return {"error": "invalid_json", "raw": response.text}


# -- ask_json for the OpenRouter/OpenAI/Ollama blocks above (ACTIVE) --------
# -- (all three go through the `openai` package's chat.completions API, so
# -- this one body covers whichever of them is uncommented above) ----------
# -- NOTE for Ollama: not every local model reliably honors
# -- response_format={"type": "json_object"} the way hosted models do — if
# -- you see a lot of {"error": "invalid_json"} results, try a model known
# -- for good JSON-mode support (e.g. llama3.1) before assuming it's a bug.
def ask_json(system_prompt: str, user_prompt: str, model: str = DEFAULT_MODEL) -> dict:
    for attempt in range(MAX_RETRIES):
        try:
            response = client.chat.completions.create(
                model=model,
                temperature=0,
                response_format={"type": "json_object"},
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
            )
            break
        except Exception as e:
            status = getattr(e, "status_code", None)
            if status not in RETRYABLE_STATUS_CODES or attempt == MAX_RETRIES - 1:
                raise
            time.sleep(2 ** attempt)

    content = response.choices[0].message.content
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        return {"error": "invalid_json", "raw": content}

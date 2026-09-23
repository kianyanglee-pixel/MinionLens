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

# -- Google Gemini (direct) (ACTIVE) -------------------------------------------
# Needs GEMINI_API_KEY (and optionally GEMINI_MODEL) in .env or Render.
from google import genai
from google.genai import errors, types

DEFAULT_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.6-flash")
_default_api_key = os.getenv("GEMINI_API_KEY")
_default_client = genai.Client(api_key=_default_api_key) if _default_api_key else None

# -- OpenAI (direct) ----------------------------------------------------------
# Needs OPENAI_API_KEY (and optionally OPENAI_MODEL) in .env.
# from openai import OpenAI
#
# client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
# DEFAULT_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

# -- Ollama (local) ------------------------------------------------------------
# Runs entirely on your own machine via `ollama serve` (default port 11434) —
# free, no API key, and no rate limit/quota from a third party, since nothing
# leaves your computer. Trade-off: speed and output quality depend on your
# hardware and the model you pull, so worth testing on a few emails before
# trusting it for a full batch run. Install: https://ollama.com/download,
# then pull the model first, e.g. `ollama pull qwen2.5:7b`.
# Uses Ollama's OpenAI-compatible endpoint, so it shares the OpenRouter/OpenAI
# call shape below — no new dependency needed.
# Needs nothing in .env by default; OLLAMA_BASE_URL/OLLAMA_MODEL optional.
# NOTE: this only works for local development — a cloud-hosted backend
# (Render/Railway/etc.), or a teammate without Ollama installed, needs one of
# the cloud provider blocks above instead.
# Ollama is intentionally disabled for the deployed backend.


# -- ask_json for the Gemini (direct) block above, if you switch to it -------
# def ask_json(system_prompt: str, user_prompt: str, model: str = DEFAULT_MODEL) -> dict:
#     """Gemini (direct) call shape. If you switch to the OpenRouter/OpenAI/
#     Ollama block above instead, swap this function body for the one
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
#             # If rate limited (429) or transient 500/503, backoff exponentially
#             if e.code not in RETRYABLE_STATUS_CODES or attempt == MAX_RETRIES - 1:
#                 raise
#             time.sleep(2 ** attempt)
#         except Exception:
#             if attempt == MAX_RETRIES - 1:
#                 raise
#             time.sleep(2 ** attempt)
#
#     try:
#         return json.loads(response.text)
#     except (json.JSONDecodeError, AttributeError):
#         return {"error": "invalid_json", "raw": getattr(response, "text", "")}


# -- Active Gemini JSON call ---------------------------------------------------
def ask_json(
    system_prompt: str,
    user_prompt: str,
    model: str = DEFAULT_MODEL,
    api_key: str | None = None,
) -> dict:
    active_client = genai.Client(api_key=api_key) if api_key else _default_client
    if active_client is None:
        raise RuntimeError("No Gemini API key configured. Add one in the UI or GEMINI_API_KEY on the server.")

    for attempt in range(MAX_RETRIES):
        try:
            response = active_client.models.generate_content(
                model=model,
                contents=user_prompt,
                config=types.GenerateContentConfig(
                    system_instruction=system_prompt,
                    response_mime_type="application/json",
                    temperature=0,
                ),
            )
            break
        except errors.APIError as error:
            status = getattr(error, "code", None)
            if status not in RETRYABLE_STATUS_CODES or attempt == MAX_RETRIES - 1:
                raise
            time.sleep(2 ** attempt)
        except Exception:
            if attempt == MAX_RETRIES - 1:
                raise
            time.sleep(2 ** attempt)

    try:
        return json.loads(response.text)
    except (json.JSONDecodeError, AttributeError):
        return {"error": "invalid_json", "raw": getattr(response, "text", "")}

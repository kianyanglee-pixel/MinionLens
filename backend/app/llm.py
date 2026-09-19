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

# -- Google Gemini (direct) (ACTIVE) -----------------------------------------
# Needs GEMINI_API_KEY (and optionally GEMINI_MODEL) in .env.
from google import genai
from google.genai import errors, types

client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
DEFAULT_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")

# -- OpenAI (direct) ----------------------------------------------------------
# Needs OPENAI_API_KEY (and optionally OPENAI_MODEL) in .env.
# from openai import OpenAI
#
# client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
# DEFAULT_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")


def ask_json(system_prompt: str, user_prompt: str, model: str = DEFAULT_MODEL) -> dict:
    """Gemini (direct) call shape. If you switch to the OpenRouter or OpenAI
    block above instead, swap this function body for the one commented out
    below it (different call shape, different response shape)."""
    for attempt in range(MAX_RETRIES):
        try:
            response = client.models.generate_content(
                model=model,
                contents=user_prompt,
                config=types.GenerateContentConfig(
                    system_instruction=system_prompt,
                    response_mime_type="application/json",
                    temperature=0,
                ),
            )
            break
        except errors.APIError as e:
            if e.code not in RETRYABLE_STATUS_CODES or attempt == MAX_RETRIES - 1:
                raise
            time.sleep(2 ** attempt)

    try:
        return json.loads(response.text)
    except json.JSONDecodeError:
        return {"error": "invalid_json", "raw": response.text}


# -- ask_json for the OpenRouter/OpenAI (direct) blocks above, if you switch
# -- to either of those (both go through the `openai` package's
# -- chat.completions API, so this one body covers either) -----------------
# def ask_json(system_prompt: str, user_prompt: str, model: str = DEFAULT_MODEL) -> dict:
#     for attempt in range(MAX_RETRIES):
#         try:
#             response = client.chat.completions.create(
#                 model=model,
#                 temperature=0,
#                 response_format={"type": "json_object"},
#                 messages=[
#                     {"role": "system", "content": system_prompt},
#                     {"role": "user", "content": user_prompt},
#                 ],
#             )
#             break
#         except Exception as e:
#             status = getattr(e, "status_code", None)
#             if status not in RETRYABLE_STATUS_CODES or attempt == MAX_RETRIES - 1:
#                 raise
#             time.sleep(2 ** attempt)
#
#     content = response.choices[0].message.content
#     try:
#         return json.loads(content)
#     except json.JSONDecodeError:
#         return {"error": "invalid_json", "raw": content}

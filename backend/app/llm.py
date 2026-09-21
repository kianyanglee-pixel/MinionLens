import json
import os
import time
from dotenv import load_dotenv
from google import genai
from google.genai import errors, types

load_dotenv()

MAX_RETRIES = 3
RETRYABLE_STATUS_CODES = {429, 500, 503}

client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

# Reads from .env if set, otherwise defaults to a stable flash model
DEFAULT_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.6-flash")


def ask_json(system_prompt: str, user_prompt: str, model: str = DEFAULT_MODEL) -> dict:
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
            # If rate limited (429) or transient 500/503, backoff exponentially
            if e.code not in RETRYABLE_STATUS_CODES or attempt == MAX_RETRIES - 1:
                raise
            time.sleep(2 ** attempt)

    try:
        return json.loads(response.text)
    except (json.JSONDecodeError, AttributeError):
        return {"error": "invalid_json", "raw": getattr(response, "text", "")}
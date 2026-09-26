import json
import os
import time
from dotenv import load_dotenv

load_dotenv()

MAX_RETRIES = 3
PROVIDER = os.getenv("LLM_PROVIDER", "gemini").strip().lower()

_PROVIDER_SETTINGS = {
    "gemini": ("GEMINI_API_KEY", "GEMINI_MODEL", "gemini-3.6-flash"),
    "ollama": (None, "OLLAMA_MODEL", "qwen2.5:7b"),
    "openai": ("OPENAI_API_KEY", "OPENAI_MODEL", "gpt-4o-mini"),
    "openrouter": ("OPENROUTER_API_KEY", "OPENROUTER_MODEL", "google/gemini-2.5-flash"),
}


def provider_requires_api_key() -> bool:
    return PROVIDER != "ollama"


def provider_has_default_api_key() -> bool:
    setting = _PROVIDER_SETTINGS.get(PROVIDER)
    return bool(setting and setting[0] and os.getenv(setting[0]))


def provider_model() -> str:
    setting = _PROVIDER_SETTINGS.get(PROVIDER)
    if not setting:
        return ""
    return os.getenv(setting[1], setting[2])


DEFAULT_MODEL = provider_model()


def _openai_client(api_key: str | None):
    from openai import OpenAI

    if PROVIDER == "ollama":
        return OpenAI(
            base_url=os.getenv("OLLAMA_BASE_URL", "http://localhost:11434/v1"),
            api_key=api_key or "ollama",
        )
    if PROVIDER == "openrouter":
        key = api_key or os.getenv("OPENROUTER_API_KEY")
        base_url = "https://openrouter.ai/api/v1"
    elif PROVIDER == "openai":
        key = api_key or os.getenv("OPENAI_API_KEY")
        base_url = None
    else:
        raise RuntimeError(f"Unsupported LLM_PROVIDER: {PROVIDER!r}")

    if not key:
        raise RuntimeError(f"No API key configured for the {PROVIDER} provider.")
    return OpenAI(api_key=key, base_url=base_url)


def _parse_json(text: str | None) -> dict:
    try:
        return json.loads(text)
    except (json.JSONDecodeError, TypeError):
        return {"error": "invalid_json", "raw": text or ""}


def ask_json(
    system_prompt: str,
    user_prompt: str,
    model: str = DEFAULT_MODEL,
    api_key: str | None = None,
) -> dict:
    if PROVIDER not in _PROVIDER_SETTINGS:
        raise RuntimeError(f"Unsupported LLM_PROVIDER: {PROVIDER!r}")

    for attempt in range(MAX_RETRIES):
        try:
            if PROVIDER == "gemini":
                from google import genai
                from google.genai import types

                key = api_key or os.getenv("GEMINI_API_KEY")
                if not key:
                    raise RuntimeError("No Gemini API key configured. Add one in the UI or GEMINI_API_KEY in .env.")
                response = genai.Client(api_key=key).models.generate_content(
                    model=model,
                    contents=user_prompt,
                    config=types.GenerateContentConfig(
                        system_instruction=system_prompt,
                        response_mime_type="application/json",
                        temperature=0,
                    ),
                )
                response_text = response.text
            else:
                response = _openai_client(api_key).chat.completions.create(
                    model=model,
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                    response_format={"type": "json_object"},
                    temperature=0,
                )
                response_text = response.choices[0].message.content
            return _parse_json(response_text)
        except Exception as error:
            status = getattr(error, "status_code", getattr(error, "code", None))
            if (status is not None and status not in {429, 500, 503}) or attempt == MAX_RETRIES - 1:
                raise
            time.sleep(2 ** attempt)

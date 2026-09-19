import json
import os
import time
from dotenv import load_dotenv
from google import genai
from google.genai import errors, types
#from openai import OpenAI

load_dotenv()
#gemini
client = genai.Client(api_key=os.getenv('GEMINI_API_KEY'))
DEFAULT_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite")
#openai
#client = OpenAI(api_key=os.getenv('OPENAI_API_KEY'))
#DEFAULT_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

#you guys can test whether the API is connected or not. Later pls remove the comment.
#this file is for connecting any kind llm, this file will be further used for the proejct's operations


MAX_RETRIES = 3
RETRYABLE_STATUS_CODES = {429, 500, 503}


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
            if e.code not in RETRYABLE_STATUS_CODES or attempt == MAX_RETRIES - 1:
                raise
            time.sleep(2 ** attempt)

    try:
        return json.loads(response.text)
    except json.JSONDecodeError:
        return {"error": "invalid_json", "raw": response.text}



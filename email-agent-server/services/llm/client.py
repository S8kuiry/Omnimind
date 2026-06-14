"""Gemini primary with automatic Groq fallback on quota / rate-limit errors."""

import json
import re
import httpx
from pydantic import BaseModel
from google import genai
from google.genai import types
from config import settings

GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions"

_ASTERISK_HINT = (
    "Source emails may wrap words in *asterisks* for emphasis (common in LinkedIn "
    "notifications). Treat those markers as plain-text emphasis, not markdown. "
    "Return raw JSON only — no code fences, no surrounding prose."
)


def _extract_json_object(text: str) -> dict:
    """Parse JSON from Groq output that may include markdown fences or extra text."""
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r"\s*```$", "", cleaned)

    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start != -1 and end > start:
        cleaned = cleaned[start : end + 1]

    return json.loads(cleaned)


def _is_rate_limit(exc: Exception) -> bool:
    msg = str(exc).lower()
    return (
        "429" in msg
        or "resource_exhausted" in msg
        or "quota exceeded" in msg
        or "rate limit" in msg
        or "rate_limit" in msg
    )


async def _gemini_json(
    system_instruction: str,
    user_content: str,
    schema: type[BaseModel],
    temperature: float,
) -> dict:
    client = genai.Client(api_key=settings.gemini_api_key)
    response = await client.aio.models.generate_content(
        model=settings.gemini_model,
        contents=user_content,
        config=types.GenerateContentConfig(
            system_instruction=system_instruction,
            response_mime_type="application/json",
            response_schema=schema,
            temperature=temperature,
        ),
    )
    return json.loads(response.text)


async def _groq_json(
    system_instruction: str,
    user_content: str,
    schema: type[BaseModel],
    temperature: float,
) -> dict:
    if not settings.groq_api_key:
        raise RuntimeError("GROQ_API_KEY not configured")

    schema_hint = json.dumps(schema.model_json_schema())
    system = (
        f"{system_instruction}\n\n"
        f"{_ASTERISK_HINT}\n\n"
        "Respond with valid JSON only, matching this schema exactly:\n"
        f"{schema_hint}"
    )

    async with httpx.AsyncClient(timeout=90) as http:
        resp = await http.post(
            GROQ_CHAT_URL,
            headers={
                "Authorization": f"Bearer {settings.groq_api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": settings.groq_model,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user_content},
                ],
                "temperature": temperature,
                "response_format": {"type": "json_object"},
            },
        )
        resp.raise_for_status()
        data = resp.json()

    text = data["choices"][0]["message"]["content"]
    return _extract_json_object(text)


async def generate_structured_json(
    system_instruction: str,
    user_content: str,
    schema: type[BaseModel],
    temperature: float = 0.1,
) -> dict:
    """
    Try Gemini first. On 429 / quota errors, automatically retry via Groq.
    If only GROQ_API_KEY is set, uses Groq directly.
    """
    if settings.gemini_api_key:
        try:
            return await _gemini_json(system_instruction, user_content, schema, temperature)
        except Exception as exc:
            if _is_rate_limit(exc) and settings.groq_api_key:
                print(
                    f"[LLM] Gemini rate limit hit — falling back to Groq "
                    f"({settings.groq_model})"
                )
                return await _groq_json(system_instruction, user_content, schema, temperature)
            raise

    if settings.groq_api_key:
        return await _groq_json(system_instruction, user_content, schema, temperature)

    raise RuntimeError("No LLM API key configured (GEMINI_API_KEY or GROQ_API_KEY)")

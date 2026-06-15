import asyncio
import logging

from pydantic import BaseModel, Field

from lib.gmail_client import fetch_message_detail
from services.llm.client import generate_structured_json

logger = logging.getLogger("summarizer")


class AnalysisArtifact(BaseModel):
    summary: str = Field(description="Concise bulleted summary.")
    suggested_draft: str = Field(description="Professional suggested reply draft.")


async def _analyze_content_core(email_data: dict, tone_instruction: str) -> dict:
    subject = email_data.get("subject", "(No Subject)")
    body_text = email_data.get("body_text", "") or email_data.get("snippet", "")
    sender = email_data.get("from_name") or email_data.get("from_address", "Sender")

    user_content = (
        f"From: {sender}\nSubject: {subject}\n\nContent:\n\"\"\"\n{body_text}\n\"\"\"\n\n"
        f"Tone for draft: {tone_instruction}"
    )
    system = (
        "Analyze the email. Return a bulleted summary and a production-ready reply draft. "
        "No placeholders."
    )

    try:
        result = await generate_structured_json(system, user_content, AnalysisArtifact, temperature=0.2)
        return {
            "summary": result.get("summary", ""),
            "draft_body": result.get("suggested_draft", ""),
            "suggested_draft": result.get("suggested_draft", ""),
        }
    except Exception as exc:
        logger.error(f"Deep analysis failed: {exc}")
        fallback = (
            f"Hello,\n\nThank you for your message regarding '{subject}'. "
            "I will follow up shortly.\n\nBest regards."
        )
        return {
            "summary": f"Message from {sender} about: {subject}",
            "draft_body": fallback,
            "suggested_draft": fallback,
        }


async def generate_full_summary(creds, message_id: str) -> dict:
    email_detail = await asyncio.to_thread(fetch_message_detail, creds=creds, message_id=message_id)
    return await _analyze_content_core(email_detail, "professional, clear, and helpful")


async def regenerate_draft_with_tone(
    creds,
    message_id: str,
    tone: str,
    instructions: str | None = None,
) -> dict:
    email_detail = await asyncio.to_thread(fetch_message_detail, creds=creds, message_id=message_id)
    tone_instruction = tone
    if instructions:
        tone_instruction = f"{tone}. Additional instructions: {instructions}"
    return await _analyze_content_core(email_detail, tone_instruction)

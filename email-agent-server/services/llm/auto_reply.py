import logging

from pydantic import BaseModel, Field

from services.llm.client import generate_structured_json

logger = logging.getLogger("auto_reply")


class AutoReplyOutput(BaseModel):
    body: str = Field(
        description="Short, polite reply body only. No subject line, no signature block, no placeholders."
    )


def _tone_hint(category: str) -> str:
    if category == "personal":
        return "Warm and casual (1-2 sentences). Mirror their greeting."
    return "Concise and professional (2-3 sentences). Acknowledge and say you'll follow up if needed."


async def generate_auto_reply_body(email_meta: dict, category: str = "work") -> str:
    subject = email_meta.get("subject") or "(no subject)"
    snippet = email_meta.get("snippet", "")
    from_name = email_meta.get("from_name") or "there"
    body_content = email_meta.get("body_text") or snippet

    user_content = (
        f"From: {from_name}\nSubject: {subject}\n\n{body_content}\n\n"
        f"{_tone_hint(category)} Do not commit to specific dates or promises."
    )
    system = (
        "You write brief email auto-replies on behalf of the inbox owner. "
        "Sound human. No placeholders like [Your Name]. Output only the reply body."
    )

    try:
        result = await generate_structured_json(system, user_content, AutoReplyOutput, temperature=0.3)
        text = (result.get("body") or "").strip()
        if text and len(text) <= 600:
            return text
    except Exception as exc:
        logger.error(f"Auto-reply generation failed for {email_meta.get('id')}: {exc}")

    if category == "personal":
        name = from_name.split()[0] if from_name and from_name != "there" else "there"
        return f"Hey {name}!\n\nGot your message — I'll get back to you soon.\n\nCheers"

    return (
        f"Hi {from_name},\n\n"
        "Thanks for your email — I've received it and will follow up shortly.\n\n"
        "Best regards"
    )

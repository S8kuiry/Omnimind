import time
import json
from typing import Optional
from pydantic import BaseModel, Field
from google import genai
from google.genai import types
from config import settings

# 1. Expanded structural contract to handle triage and auto-replies
class EmailAnalysisOutput(BaseModel):
    summary: str = Field(
        description="A concise, high-impact overview of the email context, restricted to exactly 1 or 2 sentences."
    )
    action_items: list[str] = Field(
        description="An array of concrete actions, deadlines, or explicit requests mentioned. Leave empty if none."
    )
    category: str = Field(
        description="Classify into exactly one: work | personal | newsletter | bill | spam | critical"
    )
    priority: str = Field(
        description="Classify urgency based on context: high | medium | low"
    )
    requires_auto_reply: bool = Field(
        description="Set to True ONLY if this is a basic operational work inquiry from a real human that can be fully addressed with a neutral, standard confirmation or basic info reply."
    )
    auto_reply_body: Optional[str] = Field(
        default=None,
        description="If requires_auto_reply is True, write a concise, helpful response in a completely neutral, professional corporate tone. Do not include placeholders like [Your Name]. If False, leave this null."
    )


async def analyze_and_triage_email(subject: str, body: str) -> dict:
    start_time = time.time()
    
    api_key = settings.gemini_api_key or None
    client = genai.Client(api_key=api_key)
    
    system_instruction = (
        "You are an advanced operational email triage agent. Your objective is to strip "
        "noise from incoming messages, extract structured data, classify incoming intent, "
        "and draft safe, professional, ultra-neutral automatic responses for basic work inquiries."
    )
    
    user_content = f"""
    Analyze the following email details:
    SUBJECT: {subject}
    BODY:
    \"\"\"{body}\"\"\"
    """
    
    try:
        response = await client.aio.models.generate_content(
            model=settings.gemini_model,
            contents=user_content,
            config=types.GenerateContentConfig(
                system_instruction=system_instruction,
                response_mime_type="application/json",
                response_schema=EmailAnalysisOutput,
                temperature=0.1, # Dropped to 0.1 to maximize deterministic classification
            )
        )
        
        result = json.loads(response.text)
        result["latency_ms"] = int((time.time() - start_time) * 1000)
        return result
        
    except Exception as e:
        print(f"[LLM Core Error] Analysis failure: {e}")
        return {
            "summary": f"Failed to auto-summarize email regarding: '{subject}'.",
            "action_items": [],
            "category": "work",
            "priority": "medium",
            "requires_auto_reply": False,
            "auto_reply_body": None,
            "latency_ms": int((time.time() - start_time) * 1000)
        }
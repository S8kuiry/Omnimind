# category + priority + action decision
import time
import json
from pydantic import BaseModel, Field
from google import genai
from google.genai import types
from config import settings

# 1. Define the explicit data structure using Pydantic
class EmailCategoryOutput(BaseModel):
    category: str = Field(
        description="Must be exactly one of: 'work', 'personal', 'billing', 'newsletter', 'spam', 'critical'"
    )
    priority: str = Field(
        description="Must be exactly one of: 'high', 'medium', 'low'"
    )
    reasoning: str = Field(
        description="A concise 1-sentence analytical reason for assigning this category."
    )
    is_actionable: bool = Field(
        description="True if this email requires an automated or manual reply/action. False if it is just info/read-only."
    )


async def categorize_email(sender: str, subject: str, body: str) -> dict:
    """
    Processes incoming raw email text using Gemini 1.5 Flash.
    Guarantees structured output parsing and records system latency for analytics.
    """
    start_time = time.time()
    
    api_key = settings.gemini_api_key or None
    client = genai.Client(api_key=api_key)
    
    # Construct an explicitly bounded system prompt
    system_instruction = (
        "You are an elite automated executive assistant engine. Your sole task is to triage incoming "
        "raw emails. Be highly conservative with 'critical' tags—reserve them for actual operational emergencies."
    )
    
    user_content = f"""
    Please analyze this incoming email structure:
    FROM: {sender}
    SUBJECT: {subject}
    BODY DATA:
    \"\"\"{body}\"\"\"
    """
    
    try:
        # Execute asynchronous context generation using the lightweight Flash architecture
        response = await client.aio.models.generate_content(
            model=settings.gemini_model,
            contents=user_content,
            config=types.GenerateContentConfig(
                system_instruction=system_instruction,
                response_mime_type="application/json",
                response_schema=EmailCategoryOutput,
                temperature=0.1,  # Low temperature keeps categorization deterministic
            )
        )
        
        # Because we supplied a response_schema, response.text is guaranteed to be clean JSON
        result = json.loads(response.text)
        
        # Inject live performance telemetry details required by routes/agent.py
        result["latency_ms"] = int((time.time() - start_time) * 1000)
        return result
        
    except Exception as e:
        print(f"[LLM Categorizer Error] Core inference failure: {e}")
        # Robust architectural fallback so an upstream API blink doesn't freeze your background daemon
        return {
            "category": "work",
            "priority": "medium",
            "reasoning": "Fallback safety block invoked due to runtime exception error.",
            "is_actionable": True,
            "latency_ms": int((time.time() - start_time) * 1000)
        }
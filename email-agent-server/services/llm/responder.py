import time
import json
from pydantic import BaseModel, Field
from google import genai
from google.genai import types
from config import settings

# 1. Define the structural output schema for responses
class EmailDraftOutput(BaseModel):
    draft_body: str = Field(
        description="The full body content of the generated email reply. Keep it concise, professional, and clear."
    )
    tone_applied: str = Field(
        description="The tone profile utilized for generation (e.g., 'formal', 'casual', 'assertive', 'conciliatory')."
    )
    suggest_human_review: bool = Field(
        description="Set to True if the incoming email is highly complex, angry, or involves legal/financial risk requiring human oversight."
    )
    confidence_score: float = Field(
        description="Model confidence rating for the response accuracy, ranging strictly from 0.0 to 1.0."
    )


async def generate_draft_response(sender: str, subject: str, body: str, summary: str) -> dict:
    """
    Generates tailored, context-aware email draft replies using Gemini 1.5 Flash.
    Ensures safe output structures and records generation processing latency.
    """
    start_time = time.time()
    
    # Initialize the unified GenAI Client
    api_key = settings.gemini_api_key or None
    client = genai.Client(api_key=api_key)
    
    system_instruction = (
        "You are an expert executive communications agent. Your task is to compose an elegant, "
        "context-aware email reply based on the original message and its summary. "
        "Do not include placeholders like '[Your Name]'; sign off as 'Automated Assistant'. "
        "Be extremely honest with 'suggest_human_review'—flag it if things look uncertain or high-risk."
    )
    
    user_content = f"""
    Context for Response Generation:
    SENDER: {sender}
    SUBJECT: {subject}
    ORIGINAL BODY:
    \"\"\"{body}\"\"\"
    PRE-COMPUTED SUMMARY: {summary}
    """
    
    try:
        response = await client.aio.models.generate_content(
            model=settings.gemini_model,
            contents=user_content,
            config=types.GenerateContentConfig(
                system_instruction=system_instruction,
                response_mime_type="application/json",
                response_schema=EmailDraftOutput,
                temperature=0.3, # Balanced to allow natural phrasing while staying on-topic
            )
        )
        
        result = json.loads(response.text)
        result["latency_ms"] = int((time.time() - start_time) * 1000)
        return result
        
    except Exception as e:
        print(f"[LLM Responder Error] Generation failure: {e}")
        return {
            "draft_body": "Thank you for your email. We have received it and are reviewing the details.",
            "tone_applied": "formal",
            "suggest_human_review": True,
            "confidence_score": 0.0,
            "latency_ms": int((time.time() - start_time) * 1000)
        }
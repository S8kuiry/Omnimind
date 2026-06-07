# writes daily/weekly digest content

import time
import json
from pydantic import BaseModel, Field
from google import genai
from google.genai import types
from config import settings

# 1. Define data structure models for handling arrays of emails
class CriticalAlertItem(BaseModel):
    sender: str
    subject: str
    risk_factor: str = Field(description="Why this specific thread is flagged as a high-priority risk factor.")

class ExecutiveDigestOutput(BaseModel):
    executive_summary: str = Field(
        description="A cohesive macro-overview of the business traffic and inquiries received across this entire email block."
    )
    critical_alerts: list[CriticalAlertItem] = Field(
        description="List of any high-risk, urgent, or catastrophic emails found in the batch. Leave empty if none."
    )
    primary_topics_discovered: list[str] = Field(
        description="Top 3 to 5 categorical trends or topics observed across the email batch (e.g., 'Server Downtime', 'Client Invoicing')."
    )


async def generate_batch_digest(emails_batch: list[dict]) -> dict:
    """
    Processes a collection list of raw email documents simultaneously.
    Generates a structural, high-density situational intelligence markdown/JSON digest summary.
    """
    start_time = time.time()
    
    api_key = settings.gemini_api_key or None
    client = genai.Client(api_key=api_key)
    
    system_instruction = (
        "You are a principal operational risk officer. You are reading a collection of recent emails "
        "received by a company. Synthesize them into an itemized, structural intelligence brief. "
        "Isolate corporate noise, identify core technical or business blocker trends, and pull out any immediate emergencies."
    )
    
    # Format the array list of emails cleanly for the context window
    formatted_emails = []
    for idx, item in enumerate(emails_batch):
        formatted_emails.append(
            f"--- EMAIL #{idx+1} ---\n"
            f"FROM: {item.get('sender', 'Unknown')}\n"
            f"SUBJECT: {item.get('subject', 'No Subject')}\n"
            f"BODY: {item.get('body', '')[:800]}\n" # Truncate inner bodies slightly to prevent token blowouts
        )
    
    user_content = "Please generate an operational summary brief for the following emails:\n\n" + "\n".join(formatted_emails)
    
    try:
        response = await client.aio.models.generate_content(
            model=settings.gemini_model,
            contents=user_content,
            config=types.GenerateContentConfig(
                system_instruction=system_instruction,
                response_mime_type="application/json",
                response_schema=ExecutiveDigestOutput,
                temperature=0.2, # Kept low to enforce strict summaries without hallucinations
            )
        )
        
        result = json.loads(response.text)
        result["generated_at"] = int(time.time())
        result["total_processed"] = len(emails_batch)
        result["latency_ms"] = int((time.time() - start_time) * 1000)
        return result
        
    except Exception as e:
        print(f"[LLM Digest Error] System compilation failure: {e}")
        return {
            "executive_summary": "Failed to compile the current email batch due to a system processing exception.",
            "critical_alerts": [],
            "primary_topics_discovered": ["System Errors"],
            "generated_at": int(time.time()),
            "total_processed": len(emails_batch),
            "latency_ms": int((time.time() - start_time) * 1000)
        }
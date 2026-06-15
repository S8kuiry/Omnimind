# import logging
# from typing import Literal

# from pydantic import BaseModel, Field

# from services.llm.client import generate_structured_json

# logger = logging.getLogger("categorizer_light")


# class EmailTriageResponse(BaseModel):
#     category: Literal["work", "personal", "newsletter", "spam", "critical"] = Field(
#         description="Broad category of the email."
#     )
#     priority: Literal["low", "medium", "high"] = Field(description="Urgency level.")
#     needs_manual_review: bool = Field(
#         description=(
#             "True when a human must read before any action: work mail, job/recruiter messages, "
#             "bills, legal/financial items, complaints, delivery failures, or anything requiring judgment."
#         )
#     )


# async def triage_email_light(email_meta: dict) -> dict:
#     subject = email_meta.get("subject", "No Subject")
#     snippet = email_meta.get("snippet", "")
#     from_address = email_meta.get("from_address", "")

#     user_content = f"From: {from_address}\nSubject: {subject}\nSnippet: {snippet}"
#     system = (
#         "You are a fast email triage agent. Classify category and priority. "
#         "Default to needs_manual_review=true for work mail, recruiter/job alerts, bills, "
#         "delivery failures, and anything business-critical. "
#         "Set needs_manual_review=false only for trivial personal chit-chat that is clearly safe to acknowledge."
#     )

#     try:
#         return await generate_structured_json(system, user_content, EmailTriageResponse, temperature=0.0)
#     except Exception as exc:
#         logger.error(f"Light triage failed for {email_meta.get('id')}: {exc}")
#         # Fail safe — route to human attention
#         return {"category": "work", "priority": "medium", "needs_manual_review": True}



import logging
from typing import Literal

from pydantic import BaseModel, Field

from services.llm.client import generate_structured_json

logger = logging.getLogger("categorizer_light")


# 1. Internal Validation: Prevents bad input fields from corrupting downstream logic
class EmailMetadataInput(BaseModel):
    id: str
    from_name: str = ""
    from_address: str
    subject: str = "No Subject"
    snippet: str = ""


# 2. Hidden Chain-of-Thought Model: Used ONLY by the LLM engine to increase accuracy
class InternalTriageResponse(BaseModel):
    reasoning: str = Field(
        description="Concise logical justification explaining the classification choice."
    )
    category: Literal["work", "personal", "newsletter", "spam", "critical"] = Field(
        description="Broad category classification."
    )
    priority: Literal["low", "medium", "high"] = Field(description="Urgency scale.")
    needs_manual_review: bool = Field(
        description="True if a human must take action, False only if safe to automate."
    )


async def triage_email_light(email_meta: dict) -> dict:
    """
    Performs fast metadata-driven email triage.
    
    Returns a standard dictionary with the exact 3 fields expected by the frontend:
    {"category": str, "priority": str, "needs_manual_review": bool}
    """
    # Defensive programming: ensure incoming structure has basic keys to avoid KeyError
    try:
        validated_input = EmailMetadataInput(**email_meta)
    except Exception as err:
        logger.error(f"[triage] Malformed input dictionary schema: {err}")
        return {"category": "work", "priority": "medium", "needs_manual_review": True}

    # Isolated XML containment boundaries for the prompt
    user_content = (
        f"<incoming_email>\n"
        f"Sender Name: {validated_input.from_name}\n"
        f"Sender Address: {validated_input.from_address}\n"
        f"Subject: {validated_input.subject}\n"
        f"Snippet: {validated_input.snippet}\n"
        f"</incoming_email>"
    )

    system_instruction = (
        "You are an elite, high-throughput email parsing engine. "
        "Analyze the metadata inside <incoming_email> tags.\n\n"
        "Categories: critical (urgent/billing/legal), work (B2B, collaboration, internal updates), "
        "personal (friends/family), newsletter (digests/marketing lists), spam.\n\n"
        "needs_manual_review rules:\n"
        "- ALWAYS true for: job postings, job offers, interview invites, apply-here links, "
        "hiring messages, recruiter outreach, salary/role offers — user must decide first.\n"
        "- true: negotiations, complaints, contracts, ambiguous requests, high-stakes decisions.\n"
        "- false (auto-reply OK): routine work mail — meeting confirmations, status FYI, "
        "simple thanks, scheduling pings, internal team updates, low-stakes acknowledgments.\n"
        "- false: trivial personal chit-chat.\n"
        "If clearly a job/application email → needs_manual_review=true. "
        "If clearly routine work with no decision needed → needs_manual_review=false. "
        "When uncertain about jobs, default true; for routine work FYI prefer false."
    )

    try:
        # Ask LLM for the internal structured JSON model containing reasoning
        llm_output = await generate_structured_json(
            system_instruction,
            user_content,
            InternalTriageResponse,
            temperature=0.0  # Maximizes deterministic choices
        )
        
        # Normalize response variant layouts (Dict vs Pydantic class object wrapper)
        if hasattr(llm_output, "model_dump"):
            data = llm_output.model_dump()
        else:
            data = dict(llm_output)

        # Print the AI's thought processes inside your backend terminal logs for debugging
        logger.info(f"[triage] Email {validated_input.id} Logic: {data.get('reasoning')}")

        return {
            "category": data.get("category", "work"),
            "priority": data.get("priority", "medium"),
            "needs_manual_review": data.get("needs_manual_review", True),
        }

    except Exception as exc:
        logger.error(f"Light triage failed for {email_meta.get('id')}: {exc}")
        # Rock-solid fallback path matching your exact frontend design patterns
        return {"category": "work", "priority": "medium", "needs_manual_review": True}
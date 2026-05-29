"""Parse and render universal document QA JSON responses."""
from __future__ import annotations

import json
import re
from typing import Any

DOCUMENT_JSON_SCHEMA_HINT = """{
  "mode": "document",
  "sections": [
    {
      "title": "Section name or null for a single-topic answer",
      "body": "Plain paragraph text. No markdown, asterisks, or citations.",
      "items": ["Optional plain bullet strings"]
    }
  ]
}"""

JSON_EXAMPLE_NARROW = """{"mode":"document","sections":[{"title":null,"body":"The study enrolled 412 participants across three sites.","items":[]}]}"""
JSON_EXAMPLE_LIST = """{"mode":"document","sections":[{"title":"Key Deadlines","body":"","items":["Submission due March 15","Review period ends April 30","Final approval by June 1"]}]}"""
JSON_EXAMPLE_MULTI = """{"mode":"document","sections":[{"title":"Termination","body":"Either party may terminate with 30 days written notice.","items":[]},{"title":"Liability","body":"Total liability is capped at the fees paid in the prior twelve months.","items":[]}]}"""
JSON_EXAMPLE_SUMMARY = """{"mode":"document","sections":[{"title":"Purpose","body":"This agreement governs software licensing between the parties.","items":[]},{"title":"Key Terms","body":"","items":["Annual license fee","Support SLA of 99.9%","Data processing addendum required"]}]}"""

_REASONING_RE = re.compile(
    r"<think(?:ing)?>[\s\S]*?</think(?:ing)?>",
    re.IGNORECASE,
)


def strip_reasoning_blocks(text: str) -> str:
    return _REASONING_RE.sub("", text or "").strip()


def _strip_json_fences(raw: str) -> str:
    text = strip_reasoning_blocks(raw)
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.I)
        text = re.sub(r"\s*```$", "", text)
    return text.strip()


def _extract_json_object(raw: str) -> str | None:
    clean = _strip_json_fences(raw)
    if clean.startswith("{") and clean.endswith("}"):
        return clean
    start = clean.find("{")
    end = clean.rfind("}")
    if start >= 0 and end > start:
        return clean[start : end + 1]
    return None


def _normalize_section(sec: Any) -> dict | None:
    if not isinstance(sec, dict):
        return None
    title = sec.get("title")
    if isinstance(title, str):
        title = title.strip() or None
    elif title is not None:
        title = str(title).strip() or None

    body = (sec.get("body") or "").strip()
    items_raw = sec.get("items") or []
    items: list[str] = []
    if isinstance(items_raw, list):
        for item in items_raw:
            if item is None:
                continue
            s = str(item).strip()
            if s:
                items.append(s)

    if not body and not items:
        return None
    return {"title": title, "body": body, "items": items}


def parse_document_json(raw: str) -> tuple[list[dict], str | None]:
    if not (raw or "").strip():
        return [], "empty response"

    candidates: list[str] = []
    extracted = _extract_json_object(raw)
    if extracted:
        candidates.append(extracted)
    candidates.append(_strip_json_fences(raw))

    last_err = "invalid json"
    for candidate in candidates:
        if not candidate:
            continue
        try:
            data = json.loads(candidate)
        except json.JSONDecodeError as exc:
            last_err = str(exc)
            continue

        sections: list[dict] = []
        if isinstance(data, dict) and isinstance(data.get("sections"), list):
            for sec in data["sections"]:
                norm = _normalize_section(sec)
                if norm:
                    sections.append(norm)
        elif isinstance(data, dict) and isinstance(data.get("answer"), str):
            answer = data["answer"].strip()
            if answer:
                sections.append({"title": None, "body": answer, "items": []})

        if sections:
            return sections, None

    return [], last_err


def sections_to_markdown(sections: list[dict]) -> str:
    blocks: list[str] = []
    for sec in sections:
        title = sec.get("title")
        body = (sec.get("body") or "").strip()
        items = sec.get("items") or []

        content_parts: list[str] = []
        if body:
            content_parts.append(body)
        if items:
            content_parts.append("\n".join(f"- {item.strip()}" for item in items if str(item).strip()))

        if not content_parts:
            continue

        inner = "\n\n".join(content_parts)
        if title:
            blocks.append(f"## {str(title).strip()}\n\n{inner}")
        else:
            blocks.append(inner)

    return "\n\n---\n\n".join(blocks).strip()


def fallback_sections_from_text(text: str) -> list[dict]:
    stripped = strip_reasoning_blocks(text).strip()
    if not stripped:
        return []
    if re.search(r"^#{2,3}\s+", stripped, flags=re.M):
        return [{"title": None, "body": stripped, "items": [], "_raw_markdown": True}]
    return [{"title": None, "body": stripped, "items": []}]


def resolve_document_display(raw: str) -> tuple[list[dict], str, bool]:
    sections, err = parse_document_json(raw)
    used_json = err is None and bool(sections)

    if not sections:
        sections = fallback_sections_from_text(raw)
        used_json = False

    if not sections:
        return [], "", False

    if sections[0].get("_raw_markdown"):
        body = (sections[0].get("body") or "").strip()
        return sections, body, False

    return sections, sections_to_markdown(sections), used_json

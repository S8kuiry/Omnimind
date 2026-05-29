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
JSON_EXAMPLE_MULTI = """{"mode":"document","sections":[{"title":"Hazard and Disaster","body":"A hazard is a potential threat; a disaster is when a hazard causes significant damage.","items":[]},{"title":"Types of Natural Disasters","body":"","items":["Earthquakes","Floods","Cyclones","Landslides"]},{"title":"Mitigation with Example","body":"Mitigation reduces risk, e.g. earthquake-resistant building codes.","items":[]}]}"""
JSON_EXAMPLE_SUMMARY = """{"mode":"document","sections":[{"title":"Purpose","body":"This agreement governs software licensing between the parties.","items":[]},{"title":"Key Terms","body":"","items":["Annual license fee","Support SLA of 99.9%","Data processing addendum required"]}]}"""

_REASONING_RE = re.compile(
    r"<think(?:ing)?>[\s\S]*?</think(?:ing)?>",
    re.IGNORECASE,
)
# Topic markers the model emits when it jams exam answers into one string.
_TOPIC_AT_LINE = re.compile(
    r"(?:^|\n)\s*"
    r"(?:(?P<num>\d+)\.\s*)?"
    r"(?:\*\*)?(?P<title>[A-Z][A-Za-z0-9 /&()-]{2,100}?)(?:\*\*)?:\*\*\s*",
    re.MULTILINE,
)
_TOPIC_NUM_INCOMPLETE = re.compile(
    r"(?:^|\n)\s*(?P<num>\d+)\.\s*\*\*(?P<title>[^*\n]+?):(?:\*\*)?\s*",
    re.MULTILINE,
)
_TOPIC_INLINE = re.compile(
    r"(?<=[.!?)\]])[ \t]+(?P<title>[A-Z][A-Za-z]+(?: [A-Za-z]+){1,10}):\*\*\s*"
)


def _find_exam_markers(text: str) -> list[tuple[int, int, str, int | None]]:
    found: dict[int, tuple[int, int, str, int | None]] = {}

    def add(match: re.Match, *, num_group: str | None = "num", title_group: str = "title") -> None:
        start = match.start()
        if start in found:
            return
        num = None
        if num_group and match.groupdict().get(num_group):
            num = int(match.group(num_group))
        title = (match.group(title_group) or "").strip().rstrip(":")
        if len(title) < 2 or "\n" in title:
            return
        found[start] = (start, match.end(), title, num)

    for m in _TOPIC_AT_LINE.finditer(text):
        add(m)
    for m in _TOPIC_NUM_INCOMPLETE.finditer(text):
        add(m)
    for m in _TOPIC_INLINE.finditer(text):
        add(m, num_group=None)

    return sorted(found.values(), key=lambda x: x[0])

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


def _count_numbered_questions(question: str) -> int:
    nums = re.findall(r"(?:^|\n)\s*(\d+)\.\s", question or "")
    if nums:
        return len(nums)
    return len(re.findall(r"\d+\.\s", question or ""))


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


def _parse_body_and_items(chunk: str) -> tuple[str, list[str]]:
    chunk = (chunk or "").strip()
    if not chunk:
        return "", []

    lines = [ln.strip() for ln in chunk.splitlines() if ln.strip()]
    body_lines: list[str] = []
    items: list[str] = []

    for ln in lines:
        if re.match(r"^[-*•]\s+", ln):
            items.append(re.sub(r"^[-*•]\s+", "", ln).strip())
        else:
            body_lines.append(ln)

    body = " ".join(body_lines).strip()

    if not items and body and re.search(r"[A-Za-z]-\s+[A-Z]", body):
        parts = [p.strip() for p in re.split(r"\s*-\s*", body) if p.strip()]
        if len(parts) >= 2:
            return "", parts

    return body, items


def _split_exam_body(body: str) -> list[dict]:
    text = (body or "").replace("\r\n", "\n").strip()
    if not text:
        return []

    markers = _find_exam_markers(text)
    if len(markers) < 2:
        return [{"title": None, "body": text, "items": []}]

    sections: list[dict] = []
    for i, (_start, end, title, _num) in enumerate(markers):
        chunk_end = markers[i + 1][0] if i + 1 < len(markers) else len(text)
        chunk = text[end:chunk_end].strip()
        body_part, items = _parse_body_and_items(chunk)
        sections.append({"title": title, "body": body_part, "items": items})
    return sections


def _dedupe_sections(sections: list[dict]) -> list[dict]:
    out: list[dict] = []
    index_by_title: dict[str, int] = {}

    for sec in sections:
        title = (sec.get("title") or "").strip()
        key = re.sub(r"\s+", " ", title.lower())
        if not key:
            out.append(sec)
            continue
        if key in index_by_title:
            prev = out[index_by_title[key]]
            if len(sec.get("body") or "") > len(prev.get("body") or ""):
                out[index_by_title[key]] = sec
            continue
        index_by_title[key] = len(out)
        out.append(sec)
    return out


def _rehydrate_jammed_sections(sections: list[dict]) -> list[dict]:
    if len(sections) != 1:
        return sections

    sec = sections[0]
    body = (sec.get("body") or "").strip()
    title = sec.get("title")
    items = sec.get("items") or []

    if title or items:
        return sections

    jammed = body.count(":**") >= 2 or bool(re.search(r"[A-Z][^:\n]{3,80}:\*\*", body))
    if not jammed:
        return sections

    split = _split_exam_body(body)
    return _dedupe_sections(split) if len(split) >= 2 else sections


def _format_numbered_section(index: int, sec: dict) -> str:
    title = (sec.get("title") or "").strip()
    body = (sec.get("body") or "").strip()
    items = [str(item).strip() for item in (sec.get("items") or []) if str(item).strip()]

    header = f"{index}. **{title}:**" if title else f"{index}."
    if body and items:
        bullets = "\n".join(f"- {item}" for item in items)
        return f"{header} {body}\n{bullets}"
    if items and not body:
        bullets = "\n".join(f"- {item}" for item in items)
        return f"{header}\n{bullets}"
    if body:
        return f"{header} {body}"
    return ""


def sections_to_markdown(sections: list[dict], *, numbered: bool = False) -> str:
    if numbered and len(sections) >= 2:
        blocks = [
            block
            for i, sec in enumerate(sections, 1)
            if (block := _format_numbered_section(i, sec))
        ]
        return "\n\n".join(blocks).strip()

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


def resolve_document_display(
    raw: str,
    *,
    layout: str = "narrow",
) -> tuple[list[dict], str, bool]:
    sections, err = parse_document_json(raw)
    used_json = err is None and bool(sections)

    if not sections:
        sections = fallback_sections_from_text(raw)
        used_json = False

    if not sections:
        return [], "", False

    if sections[0].get("_raw_markdown"):
        body = (sections[0].get("body") or "").strip()
        sections = _rehydrate_jammed_sections([{"title": None, "body": body, "items": []}])
        numbered = layout == "multi_part" and len(sections) >= 2
        return sections, sections_to_markdown(sections, numbered=numbered), False

    sections = _rehydrate_jammed_sections(sections)
    if layout == "multi_part" and len(sections) == 1:
        only_body = (sections[0].get("body") or "").strip()
        if only_body:
            split = _split_exam_body(only_body)
            if len(split) >= 2:
                sections = split

    numbered = layout == "multi_part" and len(sections) >= 2
    return sections, sections_to_markdown(sections, numbered=numbered), used_json

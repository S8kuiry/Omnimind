"""Map ## sections in LLM output to retrieved chunks for per-section citation chips."""
import re

_STOP = frozenset(
    "a an the and or for with from your you are is in on at to of by as be has have".split()
)


def _tokens(text: str) -> set[str]:
    words = re.findall(r"[a-z0-9]{3,}", (text or "").lower())
    return {w for w in words if w not in _STOP}


def _overlap(a: str, b: str) -> float:
    ta, tb = _tokens(a), _tokens(b)
    if not ta or not tb:
        return 0.0
    n = len(ta & tb)
    return n / (len(ta) * len(tb)) ** 0.5


def _parse_sections(content: str) -> list[dict]:
    text = re.sub(r"\[Source:[^\]]*\]", "", content, flags=re.I).strip()
    if not text:
        return []
    parts = re.split(r"(?=^#{2,3}\s+)", text, flags=re.M)
    sections: list[dict] = []
    for part in parts:
        block = part.strip()
        if not block:
            continue
        m = re.match(r"^#{2,3}\s+(.+?)(?:\r?\n|$)([\s\S]*)", block)
        if m:
            sections.append({"heading": m.group(1).strip(), "body": m.group(2).strip()})
        elif not sections:
            sections.append({"heading": None, "body": block})
        else:
            sections[-1]["body"] += f"\n\n{block}"
    return sections


def build_section_sources(content: str, chunks: list[dict]) -> list[dict]:
    """One citation per ## heading, matched to best chunk by text overlap."""
    if not content or not chunks:
        return []

    out: list[dict] = []
    seen_labels: set[str] = set()

    for sec in _parse_sections(content):
        heading = sec.get("heading")
        if not heading:
            continue
        key = re.sub(r"[^a-z0-9]+", " ", heading.lower()).strip()
        if key in seen_labels:
            continue
        seen_labels.add(key)

        probe = f"{heading} {sec.get('body', '')}"
        best = chunks[0]
        best_score = -1.0
        for c in chunks:
            score = _overlap(probe, c.get("text", ""))
            if score > best_score:
                best_score = score
                best = c

        snippet = (best.get("text") or "")[:280]
        out.append({
            "source": best.get("source", ""),
            "page": int(best.get("page") or 1),
            "label": heading,
            "snippet": snippet,
            "sectionContext": (sec.get("body") or "")[:800],
        })

    return out

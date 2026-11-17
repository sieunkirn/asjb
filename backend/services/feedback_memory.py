"""
검수 피드백 기억 — 사람이 고친 점수를 다음 채점의 참고 사례로 쓴다.

모델을 다시 학습시키지 않고, 채점 요청에 "과거에 검수자가 이렇게 고쳤다"는 사례를
함께 보내는 방식(컨텍스트/메모리)이라 바로 적용되고 언제든 끌 수 있다.
- 기본은 꺼져 있다. SCORING_USE_FEEDBACK=1 로 켠다.
- 개인정보 보호: 사례에는 이름 · 부서를 넣지 않는다(요약 속 이름은 '○○'로 지운다).
- 채점 규칙(시스템 프롬프트)이 항상 우선하며, 사례는 판단이 애매할 때의 보정용이다.
- DB 조회 실패 · 사례 없음이면 조용히 빈 값을 돌려줘 채점을 막지 않는다.
- 문서 한 건을 채점할 때 기사마다 DB를 조회하지 않도록 10분간 결과를 재사용한다.
"""

from __future__ import annotations

import logging
import os
import re
import threading
import time
from typing import Any

logger = logging.getLogger(__name__)

_CACHE_SECONDS = 600
_MAX_EXAMPLES = int(os.getenv("SCORING_FEEDBACK_EXAMPLES", "6"))
_lock = threading.Lock()
_cache: dict[str, Any] = {"at": 0.0, "block": ""}


def feedback_enabled() -> bool:
    return os.getenv("SCORING_USE_FEEDBACK", "").strip().lower() in {"1", "true", "yes", "on"}


def _anonymize(text: str, names: list[str]) -> str:
    """요약에서 이름을 '○○'로 지우고, 한 줄 · 200자로 줄인다 (프롬프트 주입 · 개인정보 방지)."""
    out = re.sub(r"\s+", " ", str(text or "")).strip()
    for name in sorted(
        {n.strip() for n in names if n and len(n.strip()) >= 2}, key=len, reverse=True
    ):
        out = out.replace(name, "○○")
    return out[:200]


def build_feedback_block(corrections: list[dict[str, Any]]) -> str:
    """수정 사례 목록 → 사용자 프롬프트에 덧붙일 문장. 사례가 없으면 빈 문자열."""
    lines: list[str] = []
    for c in corrections[:_MAX_EXAMPLES]:
        summary = _anonymize(c.get("summary", ""), c.get("names", []))
        if not summary:
            continue
        lines.append(
            f"- AI judged {c.get('ai_type') or 'UNKNOWN'} ({c.get('ai_score'):g} pt); "
            f"the human reviewer finally decided {c.get('human_score'):g} pt. Action: {summary}"
        )
    if not lines:
        return ""
    return (
        "Reviewer corrections from earlier articles (anonymized). Use them only to calibrate "
        "borderline judgments. The scoring rules in the system prompt always take priority, "
        "and never copy names or facts from these examples:\n" + "\n".join(lines)
    )


def get_feedback_block() -> str:
    """채점 때 사용자 프롬프트에 덧붙일 참고 사례 문장 (꺼져 있으면 빈 문자열)."""
    if not feedback_enabled():
        return ""
    now = time.monotonic()
    with _lock:
        if now - _cache["at"] < _CACHE_SECONDS:
            return str(_cache["block"])
    try:
        from db import list_recent_corrections

        block = build_feedback_block(list_recent_corrections(limit=_MAX_EXAMPLES * 2))
    except Exception:
        logger.exception("Could not load reviewer feedback; scoring continues without it")
        block = ""
    with _lock:
        _cache.update(at=now, block=block)
    return block

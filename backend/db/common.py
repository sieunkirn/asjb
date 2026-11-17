"""DB 모듈이 함께 쓰는 작은 도구."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID


def utcnow() -> datetime:
    """현재 시각 (UTC, 시간대 포함)."""
    return datetime.now(UTC)


def as_uuid(value: str | UUID) -> UUID:
    """문자열이나 UUID를 UUID로 바꾼다. 형식이 틀리면 ValueError."""
    return value if isinstance(value, UUID) else UUID(str(value))


def as_optional_uuid(value: str | UUID | None) -> UUID | None:
    """as_uuid + 비어 있는 값(None, "")은 None."""
    if value is None or value == "":
        return None
    return as_uuid(value)

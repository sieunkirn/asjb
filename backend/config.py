"""Application settings loaded from the project-level .env file."""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parent
load_dotenv(PROJECT_ROOT / ".env")


def _parse_int(name: str, default: int, *, minimum: int = 1) -> int:
    raw = os.getenv(name, str(default)).strip()
    try:
        value = int(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer, got: {raw!r}") from exc
    if value < minimum:
        raise ValueError(f"{name} must be at least {minimum}, got: {value}")
    return value


def _parse_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "y", "on"}


def _project_path(raw: str) -> Path:
    path = Path(raw).expanduser()
    if not path.is_absolute():
        path = PROJECT_ROOT / path
    return path.resolve()


@dataclass(frozen=True)
class Settings:
    upload_dir: Path
    clipped_dir: Path
    max_upload_mb: int
    max_pdf_pages: int
    pdf_render_dpi: int
    allowed_origins: tuple[str, ...]
    keep_uploaded_files: bool


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    origins = tuple(
        value.strip()
        for value in os.getenv(
            "ALLOWED_ORIGINS",
            "http://localhost:3000,http://localhost:5173",
        ).split(",")
        if value.strip()
    )

    return Settings(
        upload_dir=_project_path(os.getenv("UPLOAD_DIR", "storage/uploads")),
        clipped_dir=_project_path(os.getenv("CLIPPED_DIR", "storage/clipped")),
        max_upload_mb=_parse_int("MAX_UPLOAD_MB", 150),
        max_pdf_pages=_parse_int("MAX_PDF_PAGES", 400),
        pdf_render_dpi=_parse_int("PDF_RENDER_DPI", 200, minimum=72),
        allowed_origins=origins,
        keep_uploaded_files=_parse_bool("KEEP_UPLOADED_FILES", True),
    )

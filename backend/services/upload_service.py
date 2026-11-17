"""Save and validate PDFs uploaded from the frontend."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path

import fitz
from fastapi import UploadFile

CHUNK_SIZE = 1024 * 1024  # 1 MiB


class UploadValidationError(ValueError):
    """Raised when an uploaded file is not a supported PDF."""


class UploadTooLargeError(UploadValidationError):
    """Raised when an uploaded file exceeds the configured size limit."""


@dataclass(frozen=True)
class SavedUpload:
    original_filename: str
    stored_path: Path
    size_bytes: int
    sha256: str
    page_count: int


def _safe_original_filename(filename: str | None) -> str:
    name = Path(filename or "upload.pdf").name.strip() or "upload.pdf"
    # Most filesystems permit 255 bytes; keep a conservative character limit.
    if len(name) > 180:
        suffix = Path(name).suffix
        name = f"{Path(name).stem[:160]}{suffix}"
    return name


async def save_and_validate_pdf(
    upload: UploadFile,
    destination: Path,
    *,
    max_bytes: int,
    max_pages: int,
) -> SavedUpload:
    """Stream an upload to disk and verify that it is a readable PDF."""
    if max_bytes <= 0:
        raise ValueError("max_bytes must be positive")
    if max_pages <= 0:
        raise ValueError("max_pages must be positive")

    original_filename = _safe_original_filename(upload.filename)
    destination = Path(destination)
    partial_path = destination.with_name(f"{destination.name}.part")
    total_size = 0
    digest = hashlib.sha256()

    try:
        if Path(original_filename).suffix.lower() != ".pdf":
            raise UploadValidationError("PDF 파일만 업로드할 수 있습니다.")

        destination.parent.mkdir(parents=True, exist_ok=True)
        partial_path.unlink(missing_ok=True)
        with partial_path.open("wb") as output:
            while True:
                chunk = await upload.read(CHUNK_SIZE)
                if not chunk:
                    break

                total_size += len(chunk)
                if total_size > max_bytes:
                    raise UploadTooLargeError(
                        f"파일 크기는 최대 {max_bytes // (1024 * 1024)}MB입니다."
                    )

                digest.update(chunk)
                output.write(chunk)

        if total_size == 0:
            raise UploadValidationError("빈 파일은 업로드할 수 없습니다.")

        # The PDF header is normally first, but the spec permits it within the
        # first 1024 bytes. This is stricter than trusting only the extension.
        with partial_path.open("rb") as file:
            header = file.read(1024)
        if b"%PDF-" not in header:
            raise UploadValidationError("실제 PDF 형식이 아닙니다.")

        try:
            document = fitz.open(str(partial_path))
        except Exception as exc:
            raise UploadValidationError("PDF 파일을 열 수 없습니다.") from exc

        try:
            if document.needs_pass:
                raise UploadValidationError("암호가 설정된 PDF는 처리할 수 없습니다.")
            if document.page_count < 1:
                raise UploadValidationError("페이지가 없는 PDF입니다.")
            if document.page_count > max_pages:
                raise UploadValidationError(f"PDF는 최대 {max_pages}쪽까지 처리할 수 있습니다.")
            page_count = document.page_count
        finally:
            document.close()

        destination.unlink(missing_ok=True)
        partial_path.replace(destination)

        return SavedUpload(
            original_filename=original_filename,
            stored_path=destination,
            size_bytes=total_size,
            sha256=digest.hexdigest(),
            page_count=page_count,
        )

    except Exception:
        partial_path.unlink(missing_ok=True)
        destination.unlink(missing_ok=True)
        raise

    finally:
        await upload.close()

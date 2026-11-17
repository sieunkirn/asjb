"""PDF upload, extraction status, article result, and clipped-PDF APIs."""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

from fastapi import (
    APIRouter,
    BackgroundTasks,
    File,
    HTTPException,
    Query,
    UploadFile,
)
from fastapi.responses import FileResponse

from config import get_settings
from db import (
    create_document,
    get_document,
    list_articles,
    list_documents,
)
from services.extraction_job import process_document
from services.upload_service import (
    UploadTooLargeError,
    UploadValidationError,
    save_and_validate_pdf,
)
from utils.pdf_pages import find_love_page_indices, save_selected_pages_pdf

router = APIRouter()
settings = get_settings()
FINAL_STATUSES = {"completed", "completed_with_errors", "failed"}


def _public_document(document: dict[str, Any]) -> dict[str, Any]:
    """Remove server-only paths and add a frontend-friendly progress value."""
    total = int(document.get("total_love_pages") or 0)
    processed = int(document.get("processed_pages") or 0)
    progress = round(processed / total * 100, 1) if total else 0.0

    public = {
        key: value for key, value in document.items() if key not in {"stored_path", "file_sha256"}
    }
    public["document_id"] = public.pop("id", document.get("id"))
    public["progress_percent"] = progress
    public["is_finished"] = public.get("status") in FINAL_STATUSES
    return public


def _not_found() -> HTTPException:
    return HTTPException(
        status_code=404,
        detail={
            "code": "DOCUMENT_NOT_FOUND",
            "message": "문서를 찾을 수 없습니다.",
        },
    )


@router.get("")
async def get_document_history(
    limit: int = Query(default=50, ge=1, le=200),
) -> dict[str, Any]:
    """Return recent upload/extraction history."""
    try:
        documents = await asyncio.to_thread(list_documents, limit=limit)
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "DATABASE_ERROR",
                "message": "문서 이력을 조회할 수 없습니다.",
            },
        ) from exc

    return {
        "count": len(documents),
        "documents": [_public_document(document) for document in documents],
    }


@router.post("", status_code=202)
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
) -> dict[str, Any]:
    """Upload one PDF, detect love pages, and enqueue article extraction."""
    document_id = str(uuid4())
    stored_path = settings.upload_dir / f"{document_id}.pdf"

    try:
        saved = await save_and_validate_pdf(
            file,
            stored_path,
            max_bytes=settings.max_upload_mb * 1024 * 1024,
            max_pages=settings.max_pdf_pages,
        )
    except UploadTooLargeError as exc:
        raise HTTPException(
            status_code=413,
            detail={"code": "FILE_TOO_LARGE", "message": str(exc)},
        ) from exc
    except UploadValidationError as exc:
        raise HTTPException(
            status_code=415,
            detail={"code": "INVALID_PDF", "message": str(exc)},
        ) from exc

    # 같은 내용의 PDF가 이미 올라와 있으면 재추출(OpenAI 비용) 대신 기존 결과로 안내
    def _find_same_file() -> dict[str, Any] | None:
        from db.connection import get_connection

        with get_connection() as conn:
            return conn.execute(
                """
                SELECT id, original_filename, created_at
                FROM documents
                WHERE file_sha256 = %s
                  AND status != 'failed'
                  -- 서버 재시작 등으로 30분 넘게 진척 없이 멈춘 업로드는
                  -- 중복으로 보지 않아 같은 PDF를 다시 올릴 수 있게 한다.
                  AND NOT (
                        status IN ('queued', 'processing')
                        AND updated_at < NOW() - INTERVAL '30 minutes'
                  )
                ORDER BY created_at DESC LIMIT 1
                """,
                (saved.sha256,),
            ).fetchone()

    try:
        duplicate = await asyncio.to_thread(_find_same_file)
    except Exception:
        duplicate = None
    if duplicate is not None:
        saved.stored_path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=409,
            detail={
                "code": "DUPLICATE_FILE",
                "message": (
                    f"같은 PDF가 이미 업로드되어 있습니다 "
                    f"({duplicate['original_filename']}, {str(duplicate['created_at'])[:10]})."
                ),
                "document_id": str(duplicate["id"]),
            },
        )

    try:
        page_indices = await asyncio.to_thread(
            find_love_page_indices,
            saved.stored_path,
        )
    except Exception as exc:
        saved.stored_path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=422,
            detail={
                "code": "PDF_PAGE_SCAN_ERROR",
                "message": "PDF 페이지를 검사하지 못했습니다.",
            },
        ) from exc

    if not page_indices:
        saved.stored_path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=422,
            detail={
                "code": "LOVE_PAGES_NOT_FOUND",
                "message": (
                    "PDF에서 '사랑의 챔피언' 페이지를 찾지 못했습니다. "
                    "텍스트가 없는 스캔 PDF인지 확인해 주세요."
                ),
            },
        )

    page_numbers = [index + 1 for index in page_indices]

    try:
        document = await asyncio.to_thread(
            create_document,
            document_id=document_id,
            original_filename=saved.original_filename,
            stored_path=str(saved.stored_path),
            file_sha256=saved.sha256,
            file_size_bytes=saved.size_bytes,
            total_pages=saved.page_count,
            love_page_numbers=page_numbers,
        )
    except Exception as exc:
        saved.stored_path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=503,
            detail={
                "code": "UPLOAD_REGISTRATION_ERROR",
                "message": (
                    "업로드 파일은 확인했지만 작업을 DB에 등록하지 못했습니다. "
                    "DATABASE_URL과 DB 연결을 확인해 주세요."
                ),
            },
        ) from exc

    background_tasks.add_task(
        process_document,
        document_id=document_id,
        pdf_path=str(saved.stored_path),
        original_filename=saved.original_filename,
        page_indices=page_indices,
        dpi=settings.pdf_render_dpi,
        keep_uploaded_file=settings.keep_uploaded_files,
    )

    return _public_document(document)


@router.get("/{document_id}")
async def get_document_status(document_id: UUID) -> dict[str, Any]:
    try:
        document = await asyncio.to_thread(get_document, document_id)
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "DATABASE_ERROR",
                "message": "문서 상태를 조회할 수 없습니다.",
            },
        ) from exc

    if document is None:
        raise _not_found()
    return _public_document(document)


@router.get("/{document_id}/articles")
async def get_document_articles(
    document_id: UUID,
    needs_review: bool | None = None,
) -> dict[str, Any]:
    try:
        document = await asyncio.to_thread(get_document, document_id)
        if document is None:
            raise _not_found()
        articles = await asyncio.to_thread(
            list_articles,
            document_id=document_id,
            needs_review=needs_review,
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "DATABASE_ERROR",
                "message": "추출 기사 결과를 조회할 수 없습니다.",
            },
        ) from exc

    return {
        "document_id": str(document_id),
        "status": document["status"],
        "article_count": len(articles),
        "articles": articles,
    }


@router.get("/{document_id}/clipped-pdf")
async def download_clipped_pdf(document_id: UUID) -> FileResponse:
    """Generate/download a PDF containing only detected love-article pages."""
    try:
        document = await asyncio.to_thread(get_document, document_id)
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "DATABASE_ERROR",
                "message": "문서 정보를 조회할 수 없습니다.",
            },
        ) from exc

    if document is None:
        raise _not_found()

    source_path = Path(str(document.get("stored_path") or ""))
    if not source_path.is_file():
        raise HTTPException(
            status_code=404,
            detail={
                "code": "SOURCE_FILE_NOT_FOUND",
                "message": "서버에 원본 PDF가 남아 있지 않습니다.",
            },
        )

    page_numbers = [int(number) for number in document.get("love_page_numbers") or []]
    page_indices = [number - 1 for number in page_numbers]
    clipped_path = settings.clipped_dir / f"{document_id}.pdf"

    try:
        if not clipped_path.is_file():
            await asyncio.to_thread(
                save_selected_pages_pdf,
                source_path,
                clipped_path,
                page_indices,
            )
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail={
                "code": "CLIPPED_PDF_ERROR",
                "message": "사랑기사 전용 PDF를 만들지 못했습니다.",
            },
        ) from exc

    original_stem = Path(str(document["original_filename"])).stem
    return FileResponse(
        path=clipped_path,
        media_type="application/pdf",
        filename=f"{original_stem}_사랑기사.pdf",
    )

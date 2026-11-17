"""Love-article scoring execution, result, and Excel APIs."""

from __future__ import annotations

import asyncio
from io import BytesIO
from pathlib import Path
from typing import Any
from urllib.parse import quote
from uuid import UUID

from fastapi import (
    APIRouter,
    BackgroundTasks,
    HTTPException,
    Query,
)
from fastapi.responses import (
    StreamingResponse,
)

from db import (
    get_article,
    get_document,
    get_document_evaluation_summary,
    get_evaluation,
    list_article_reviews,
    list_document_evaluations,
)
from services.excel_export import (
    evaluation_results_to_excel_bytes,
)
from services.scoring_job import (
    process_document_scoring,
    process_single_article_scoring,
)

router = APIRouter()


EXTRACTION_READY_STATUSES = {
    "completed",
    "completed_with_errors",
}


def _document_not_found() -> HTTPException:
    return HTTPException(
        status_code=404,
        detail={
            "code": "DOCUMENT_NOT_FOUND",
            "message": "문서를 찾을 수 없습니다.",
        },
    )


def _article_not_found() -> HTTPException:
    return HTTPException(
        status_code=404,
        detail={
            "code": "ARTICLE_NOT_FOUND",
            "message": "기사를 찾을 수 없습니다.",
        },
    )


@router.post(
    "/documents/{document_id}/evaluate",
    status_code=202,
)
async def start_document_evaluation(
    document_id: UUID,
    background_tasks: BackgroundTasks,
    force: bool = Query(
        default=False,
        description=("true이면 완료된 평가도 다시 실행합니다."),
    ),
) -> dict[str, Any]:
    """
    한 문서의 모든 기사를 점수화한다.
    """

    try:
        document = await asyncio.to_thread(
            get_document,
            document_id,
        )

        if document is None:
            raise _document_not_found()

        if document.get("status") not in EXTRACTION_READY_STATUSES:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "EXTRACTION_NOT_FINISHED",
                    "message": ("기사 추출이 완료된 뒤 점수화를 실행해 주세요."),
                },
            )

        summary = await asyncio.to_thread(
            get_document_evaluation_summary,
            document_id,
        )

        if summary["total"] == 0:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "NO_ARTICLES_TO_EVALUATE",
                    "message": "점수화할 기사가 없습니다.",
                },
            )

        if summary["processing"] > 0:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "EVALUATION_ALREADY_RUNNING",
                    "message": ("이 문서의 점수화가 이미 진행 중입니다."),
                },
            )

        if summary["done"] == summary["total"] and not force:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "EVALUATION_ALREADY_COMPLETED",
                    "message": ("이미 평가된 문서입니다. 재평가하려면 force=true를 사용하세요."),
                },
            )

    except HTTPException:
        raise

    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "DATABASE_ERROR",
                "message": ("점수화 작업을 준비하지 못했습니다."),
            },
        ) from exc

    background_tasks.add_task(
        process_document_scoring,
        str(document_id),
        force=force,
    )

    return {
        **summary,
        "status": "queued",
        "message": "사랑기사 실천자 점수화를 시작했습니다.",
    }


@router.get("/documents/{document_id}/evaluations")
async def get_document_evaluations(
    document_id: UUID,
    needs_review: bool | None = None,
) -> dict[str, Any]:
    """
    문서의 평가 진행률과 상세 결과를 조회한다.
    """

    try:
        document = await asyncio.to_thread(
            get_document,
            document_id,
        )

        if document is None:
            raise _document_not_found()

        summary = await asyncio.to_thread(
            get_document_evaluation_summary,
            document_id,
        )

        evaluations = await asyncio.to_thread(
            list_document_evaluations,
            document_id,
            needs_review=needs_review,
        )

    except HTTPException:
        raise

    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "DATABASE_ERROR",
                "message": ("평가 결과를 조회하지 못했습니다."),
            },
        ) from exc

    return {
        "summary": summary,
        "evaluation_count": len(evaluations),
        "evaluations": evaluations,
    }


@router.get("/documents/{document_id}/evaluations.xlsx")
async def download_document_evaluations_excel(
    document_id: UUID,
) -> StreamingResponse:
    """
    로쏘 기존 6개 컬럼 형식으로
    사랑평가 결과를 다운로드한다.
    """

    try:
        document = await asyncio.to_thread(
            get_document,
            document_id,
        )

        if document is None:
            raise _document_not_found()

        summary = await asyncio.to_thread(
            get_document_evaluation_summary,
            document_id,
        )

        if summary["processing"] > 0 or summary["pending"] > 0:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "EVALUATION_NOT_FINISHED",
                    "message": ("점수화가 아직 진행 중입니다. 완료 후 다운로드해 주세요."),
                },
            )

        if summary["done"] == 0:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "EVALUATION_NOT_READY",
                    "message": ("완료된 평가 결과가 없습니다. 점수화를 먼저 실행해 주세요."),
                },
            )

        evaluations = await asyncio.to_thread(
            list_document_evaluations,
            document_id,
        )

        # 검수 화면에서 사람이 확정한 점수·중복 제외를 엑셀에 반영
        reviews = await asyncio.to_thread(
            list_article_reviews,
            [int(e["article_id"]) for e in evaluations if e.get("article_id") is not None],
        )

        workbook_bytes = await asyncio.to_thread(
            evaluation_results_to_excel_bytes,
            document=document,
            summary=summary,
            evaluations=evaluations,
            reviews=reviews,
        )

    except HTTPException:
        raise

    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail={
                "code": "EVALUATION_EXCEL_ERROR",
                "message": ("점수 결과 엑셀을 만들지 못했습니다."),
            },
        ) from exc

    original_stem = Path(str(document.get("original_filename") or "사랑기사")).stem

    filename = f"{original_stem}_사랑평가결과.xlsx"

    encoded_filename = quote(filename)

    return StreamingResponse(
        BytesIO(workbook_bytes),
        media_type=("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
        headers={"Content-Disposition": (f"attachment; filename*=UTF-8''{encoded_filename}")},
    )


@router.post(
    "/articles/{article_id}/evaluate",
    status_code=202,
)
async def start_single_article_evaluation(
    article_id: int,
    background_tasks: BackgroundTasks,
) -> dict[str, Any]:
    """
    기사 한 편만 재평가한다.
    """

    try:
        article = await asyncio.to_thread(
            get_article,
            article_id,
        )

    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "DATABASE_ERROR",
                "message": "기사를 조회하지 못했습니다.",
            },
        ) from exc

    if article is None:
        raise _article_not_found()

    background_tasks.add_task(
        process_single_article_scoring,
        article_id,
        force=True,
    )

    return {
        "article_id": article_id,
        "status": "queued",
        "message": "기사 재평가를 시작했습니다.",
    }


@router.get("/articles/{article_id}/evaluation")
async def get_single_article_evaluation(
    article_id: int,
) -> dict[str, Any]:
    """
    기사 한 편의 평가 결과를 조회한다.
    """

    try:
        article = await asyncio.to_thread(
            get_article,
            article_id,
        )

        if article is None:
            raise _article_not_found()

        evaluation = await asyncio.to_thread(
            get_evaluation,
            article_id,
        )

    except HTTPException:
        raise

    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "DATABASE_ERROR",
                "message": ("평가 결과를 조회하지 못했습니다."),
            },
        ) from exc

    if evaluation is None:
        return {
            "article_id": article_id,
            "status": "not_created",
            "evaluation": None,
        }

    return {
        "article_id": article_id,
        "status": evaluation["status"],
        "evaluation": evaluation,
    }

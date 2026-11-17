"""Excel export helpers for article extraction and love-evaluation results."""

from __future__ import annotations

import json
from io import BytesIO
from pathlib import Path
from typing import Any

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill

ARTICLE_HEADERS = [
    "원본 PDF",
    "페이지",
    "기사 제목",
    "작성자",
    "칭찬 대상자",
    "기사 내용",
    "검토 필요",
    "검토 사유",
]

ROSSO_EVALUATION_HEADERS = [
    "작성자",
    "실천자",
    "실천자 부서",
    "실천 내용 요약",
    "실천 내용 점수",
    "특이사항",
]


SCORE_TYPE_LABELS = {
    "TYPE_4": "4번 유형",
    "TYPE_5": "5번 유형",
    "EXCLUDED": "점수제외",
    "REVIEW_TYPE_1": "1번 유형 후보",
    "REVIEW_TYPE_2": "2번 유형 후보",
    "REVIEW_OTHER": "기타내용 유형 후보",
}


REVIEW_REASON_LABELS = {
    "review_type_1_candidate": "1번 유형 후보",
    "review_type_2_candidate": "2번 유형 후보",
    "review_other_candidate": "기타내용 유형 후보",
}


WARNING_LABELS = {
    "writer_score_not_automated": "작성자 점수 미자동화",
    "duplicate_check_unavailable": "회차 간 중복 확인 필요",
    "ambiguous_multiple_practitioners": "여러 실천자의 행동 귀속이 불명확함",
    "evidence_not_found_in_article": "원문 근거 문구 재확인 필요",
    "duplicate_practitioner_results": "동일 실천자 결과 중복 가능성",
    "unsupported_basis_kind_replaced": "행동 분류값 보정됨",
    "unsupported_confidence_replaced": "신뢰도 값 보정됨",
    "unsupported_overall_confidence_replaced": "전체 신뢰도 값 보정됨",
}


def _neutralize_formulas(sheet: Any) -> None:
    """
    기사 본문처럼 외부에서 온 텍스트가 '='로 시작하면 openpyxl이 수식으로 저장한다
    (엑셀에서 열 때 실행됨). 모든 문자열 셀을 일반 문자열로 고정한다.
    """
    for row in sheet.iter_rows():
        for cell in row:
            if isinstance(cell.value, str) and cell.data_type == "f":
                cell.data_type = "s"


def _text(value: Any) -> str:
    return str(value or "").strip()


def _string_list(value: Any) -> list[str]:
    if value is None:
        return []

    if isinstance(value, list):
        return [text for item in value if (text := _text(item))]

    text = _text(value)

    return [text] if text else []


def _join(value: Any) -> str:
    return ", ".join(_string_list(value))


def _format_datetime(value: Any) -> str:
    if value is None:
        return ""

    isoformat = getattr(
        value,
        "isoformat",
        None,
    )

    if callable(isoformat):
        return str(isoformat())

    return _text(value)


def json_to_excel(
    json_path: str | Path,
    output_path: str | Path,
) -> Path:
    """
    기존 기사 추출 articles.json을 엑셀로 저장한다.

    기존 export_excel.py와의 호환성을 위해
    이 함수는 그대로 유지한다.
    """

    json_path = Path(json_path)

    output_path = Path(output_path)

    if not json_path.exists():
        raise FileNotFoundError(f"JSON 파일을 찾을 수 없습니다: {json_path}")

    with json_path.open(
        "r",
        encoding="utf-8",
    ) as file:
        payload: dict[str, Any] = json.load(file)

    articles = payload.get(
        "articles",
        [],
    )

    if not isinstance(
        articles,
        list,
    ):
        raise ValueError("JSON의 articles 값은 배열이어야 합니다.")

    workbook = Workbook()

    sheet = workbook.active
    sheet.title = "사랑기사 추출 결과"

    sheet.append(ARTICLE_HEADERS)

    header_fill = PatternFill(
        fill_type="solid",
        fgColor="D9EAD3",
    )

    for cell in sheet[1]:
        cell.font = Font(bold=True)

        cell.fill = header_fill

        cell.alignment = Alignment(
            horizontal="center",
            vertical="center",
        )

    pdf_name = payload.get(
        "pdf",
        "",
    )

    for article in articles:
        sheet.append(
            [
                pdf_name,
                article.get(
                    "source_page",
                    "",
                ),
                article.get(
                    "title",
                    "",
                ),
                article.get(
                    "writer",
                    "",
                ),
                article.get(
                    "target",
                    "",
                ),
                article.get(
                    "content",
                    "",
                ),
                (
                    "Y"
                    if article.get(
                        "needs_review",
                        False,
                    )
                    else "N"
                ),
                _join(article.get("review_reasons")),
            ]
        )

    for row in sheet.iter_rows(min_row=2):
        for cell in row:
            cell.alignment = Alignment(
                vertical="top",
                wrap_text=True,
            )

    sheet.auto_filter.ref = sheet.dimensions

    sheet.freeze_panes = "A2"

    column_widths = {
        "A": 28,
        "B": 10,
        "C": 28,
        "D": 18,
        "E": 22,
        "F": 70,
        "G": 12,
        "H": 30,
    }

    for column, width in column_widths.items():
        sheet.column_dimensions[column].width = width

    for row_number in range(
        2,
        sheet.max_row + 1,
    ):
        sheet.row_dimensions[row_number].height = 80

    output_path.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    _neutralize_formulas(sheet)

    workbook.save(output_path)

    return output_path


def _review_reason_text(
    value: Any,
) -> str:
    labels = [
        REVIEW_REASON_LABELS.get(
            item,
            item,
        )
        for item in _string_list(value)
    ]

    return ", ".join(labels)


def _warning_text(
    value: Any,
) -> str:
    labels = [
        WARNING_LABELS.get(
            item,
            item,
        )
        for item in _string_list(value)
        if item != "writer_score_not_automated"
    ]

    return ", ".join(labels)


def _build_special_note(
    *,
    evaluation: dict[str, Any],
    result: dict[str, Any] | None,
) -> str:
    """
    로쏘 엑셀의 특이사항 칸에 들어갈 내용을 만든다.
    """

    notes: list[str] = []

    status = _text(evaluation.get("status"))

    if status == "error":
        notes.append("평가 오류: " + _text(evaluation.get("error_message")))

    if result is not None:
        score_type = _text(result.get("score_type"))

        rule_id = _text(result.get("rule_id"))

        score_type_label = SCORE_TYPE_LABELS.get(
            score_type,
            score_type,
        )

        if result.get("needs_review"):
            notes.append("기업 검토 필요")

            review_text = _review_reason_text(result.get("review_reasons"))

            if review_text:
                notes.append(f"검토 유형: {review_text}")

            candidate_score = result.get("candidate_score_if_confirmed")

            if candidate_score is not None:
                notes.append(f"기업 확인 후 후보 점수: {candidate_score}점")

        if score_type_label:
            type_note = f"점수 유형: {score_type_label}"

            if rule_id:
                type_note += f" ({rule_id})"

            notes.append(type_note)

        matched_rule = _text(result.get("matched_rule"))

        if matched_rule:
            notes.append(f"적용 기준: {matched_rule}")

        evidence = _text(result.get("evidence"))

        if evidence:
            notes.append(f"원문 근거: {evidence}")

        reason = _text(result.get("reason"))

        if reason:
            notes.append(f"판정 근거: {reason}")

        confidence = _text(result.get("confidence"))

        if confidence:
            notes.append(f"신뢰도: {confidence}")

    warning_text = _warning_text(evaluation.get("quality_warnings"))

    if warning_text:
        notes.append(f"기술 확인사항: {warning_text}")

    evaluated_at = _format_datetime(evaluation.get("evaluated_at"))

    if evaluated_at:
        notes.append(f"평가 시각: {evaluated_at}")

    return "\n".join(notes)


def _norm_name(value: Any) -> str:
    return "".join(str(value or "").split())


def _find_review(
    reviews: dict[tuple[int, int], dict[str, Any]] | None,
    article_id: Any,
    index: int,
    name: str,
) -> dict[str, Any] | None:
    """
    (기사, 실천자 순번)의 사람 검수 결과. 재채점으로 순서가 바뀐 경우를 대비해
    저장된 실천자 이름이 다르면 같은 이름의 검수 결과를 찾는다. (webapp.py와 동일 규칙)
    """
    if not reviews or article_id is None:
        return None
    try:
        aid = int(article_id)
    except (TypeError, ValueError):
        return None
    review = reviews.get((aid, index))
    if index <= 0 or not name:
        return review
    if review is not None:
        stored = _norm_name(review.get("practitioner_name"))
        if not stored or stored == _norm_name(name):
            return review
    for (a, i), rv in reviews.items():
        stored = _norm_name(rv.get("practitioner_name"))
        if a == aid and i > 0 and stored and stored == _norm_name(name):
            return rv
    return None


def _human_score(review: dict[str, Any] | None) -> float | int | None:
    """검수에서 확정한 최종 점수 (없으면 None). 정수면 int로."""
    if not review or review.get("final_score") is None:
        return None
    value = float(review["final_score"])
    return int(value) if value.is_integer() else value


def evaluation_results_to_excel_bytes(
    *,
    document: dict[str, Any],
    summary: dict[str, Any],
    evaluations: list[dict[str, Any]],
    reviews: dict[tuple[int, int], dict[str, Any]] | None = None,
) -> bytes:
    """
    로쏘 기존 결과물 형식으로 사랑평가 결과를 생성한다.

    컬럼:
    작성자
    실천자
    실천자 부서
    실천 내용 요약
    실천 내용 점수
    특이사항
    """

    # 기존 로쏘 결과물과 동일하게
    # 결과 시트에는 여섯 개 컬럼만 만든다.
    del document
    del summary

    workbook = Workbook()

    sheet = workbook.active
    sheet.title = "사랑평가 결과"

    sheet.append(ROSSO_EVALUATION_HEADERS)

    header_fill = PatternFill(
        fill_type="solid",
        fgColor="FCE5CD",
    )

    review_fill = PatternFill(
        fill_type="solid",
        fgColor="FFF2CC",
    )

    error_fill = PatternFill(
        fill_type="solid",
        fgColor="F4CCCC",
    )

    for cell in sheet[1]:
        cell.font = Font(bold=True)

        cell.fill = header_fill

        cell.alignment = Alignment(
            horizontal="center",
            vertical="center",
            wrap_text=True,
        )

    for evaluation in evaluations:
        practitioner_results = evaluation.get("practitioner_results") or []

        article_id = evaluation.get("article_id")

        # 평가 결과가 없거나 오류가 난 기사
        if not practitioner_results:
            review0 = _find_review(reviews, article_id, 0, "")
            if review0 and review0.get("review_status") == "excluded":
                continue  # 중복 제외된 기사는 점수에 반영하지 않는다
            human0 = _human_score(review0)
            sheet.append(
                [
                    _text(evaluation.get("writer")),
                    _text(evaluation.get("target")),
                    _text(evaluation.get("target_department")),
                    (_text(evaluation.get("rationale")) or _text(evaluation.get("title"))),
                    human0 if human0 is not None else "",
                    _build_special_note(
                        evaluation=evaluation,
                        result=None,
                    ),
                ]
            )

            if _text(evaluation.get("status")) == "error":
                for cell in sheet[sheet.max_row]:
                    cell.fill = error_fill

            continue

        # 실천자 한 명당 한 행
        single = len(practitioner_results) == 1

        for position, result in enumerate(
            practitioner_results,
            start=1,
        ):
            review = _find_review(
                reviews,
                article_id,
                0 if single else position,
                _text(result.get("person_name")),
            )

            # 중복 제외된 실천자 행은 내보내지 않는다
            if review and review.get("review_status") == "excluded":
                continue

            human = _human_score(review)

            score = human if human is not None else result.get("score")

            score_cell: int | float | str = score if score is not None else ""

            practitioner_department = (
                _text(result.get("practitioner_department"))
                or _text(result.get("department"))
                or _text(evaluation.get("target_department"))
            )

            action_summary = (
                _text(result.get("basis_item_or_action"))
                or _text(evaluation.get("rationale"))
                or _text(evaluation.get("title"))
            )

            sheet.append(
                [
                    _text(evaluation.get("writer")),
                    (_text(result.get("person_name")) or _text(evaluation.get("target"))),
                    practitioner_department,
                    action_summary,
                    score_cell,
                    _build_special_note(
                        evaluation=evaluation,
                        result=result,
                    ),
                ]
            )

            # 사람이 확정한 행은 '검토 필요' 색을 칠하지 않는다
            if human is None and result.get("needs_review"):
                for cell in sheet[sheet.max_row]:
                    cell.fill = review_fill

    if sheet.max_row == 1:
        sheet.append(
            [
                "",
                "",
                "",
                "평가 결과 없음",
                "",
                "",
            ]
        )

    for row in sheet.iter_rows(min_row=2):
        for cell in row:
            cell.alignment = Alignment(
                vertical="top",
                wrap_text=True,
            )

    sheet.auto_filter.ref = sheet.dimensions

    sheet.freeze_panes = "A2"

    column_widths = {
        "A": 18,
        "B": 18,
        "C": 22,
        "D": 42,
        "E": 16,
        "F": 72,
    }

    for column, width in column_widths.items():
        sheet.column_dimensions[column].width = width

    for row_number in range(
        2,
        sheet.max_row + 1,
    ):
        sheet.row_dimensions[row_number].height = 105

    buffer = BytesIO()

    _neutralize_formulas(sheet)

    workbook.save(buffer)

    return buffer.getvalue()

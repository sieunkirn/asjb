"""실천자 호칭 검토 규칙 테스트 — 이름이 있으면 통과, 호칭뿐이면 확인 필요."""

from article_extract import apply_review_heuristics


def _flags(target: str) -> list[str]:
    article = {
        "title": "제목",
        "writer": "김작성",
        "target": target,
        "content": "본문" * 30,
        "needs_review": False,
        "review_reasons": [],
    }
    return apply_review_heuristics(article)["review_reasons"]


def test_name_with_honorific_is_not_flagged():
    assert "honorific_in_target" not in _flags("임영진 대표이사님")
    assert "honorific_in_target" not in _flags("홍주님")
    assert "honorific_in_target" not in _flags("한결님, 유나님")
    assert "honorific_in_target" not in _flags("문화사업부 김미진 이사님")
    assert "honorific_in_target" not in _flags("보영주임님")


def test_title_only_honorific_is_flagged():
    assert "honorific_in_target" in _flags("고객님")
    assert "honorific_in_target" in _flags("셰프님")
    assert "honorific_in_target" in _flags("사장님")


def test_no_honorific_is_not_flagged():
    assert "honorific_in_target" not in _flags("박실천")

# 업로드 API v1 변경 내역

- 누락되어 있던 `article_extract.py`, `services/openai_client.py`, 프롬프트, 평가·엑셀·테스트 원본을 Git `main` 이력에서 복구했습니다.
- `input/`과 샘플 PDF 의존성을 제거했습니다.
- `POST /api/v1/documents` PDF 업로드 API를 추가했습니다.
- 업로드 파일을 청크 단위로 저장하고 PDF 형식·크기·암호·페이지 수를 검사합니다.
- 표지의 목차 문구를 제외하고 실제 사랑기사 페이지를 자동 탐색합니다.
- 업로드 작업 이력용 `documents` 테이블과 `articles.document_id` 연결을 추가했습니다.
- 페이지별 GPT 추출, DB 저장, 진행률 갱신, 오류 페이지 검토 표시를 구현했습니다.
- 문서 상태·기사 결과·업로드 이력·사랑기사 전용 PDF 다운로드 API를 추가했습니다.
- `db/articles.py`의 잘못된 `click.UUID` 사용과 `document_id` 전달 누락을 수정했습니다.
- `utils/pdf_pages.py`의 미정의 `text` 변수 오류를 수정했습니다.
- `.env`가 API 라우트 설정보다 늦게 로드되던 문제를 수정했습니다.
- 브라우저에서 바로 시험할 수 있는 `/` 업로드 화면을 추가했습니다.
- Windows용 `setup_windows.bat`, `run_api.bat`을 추가했습니다.
- PDF 탐색·업로드 서비스·업로드 API 단위 테스트를 추가했습니다.

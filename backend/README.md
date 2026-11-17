# 성심당 사랑평가 백엔드 — PDF 업로드 버전

이 프로젝트는 프론트에서 잡지 PDF를 업로드받아 다음 순서로 처리합니다.

```text
PDF 업로드
→ 실제 PDF인지 검사
→ "사랑의 챔피언" 페이지 자동 탐색
→ 페이지별 PNG 변환
→ GPT Vision 기사 추출
→ PostgreSQL 저장
→ 진행 상태·기사 결과 조회
```

기존 `input/` 폴더는 사용하지 않습니다. 프론트가 올린 원본은 `storage/uploads/`에 UUID 파일명으로 저장됩니다.

## 1. 처음 한 번만 설정

### Windows에서 가장 쉬운 방법

프로젝트 폴더의 `setup_windows.bat`을 한 번 실행합니다. 설치가 끝나면 `.env`를 입력하고 `run_api.bat`을 실행합니다.

### Windows 명령으로 설치

```bat
python -m venv .venv
.venv\Scripts\activate
python -m pip install -r requirements.txt
copy .env.example .env
```

Python 3.14 전용 의존성이 필요한 환경에서는 다음 파일을 사용합니다.

```bat
python -m pip install -r requirements-python314.txt
```

### macOS/Linux

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
cp .env.example .env
```

## 2. `.env` 입력

프로젝트 최상위 `.env`에서 최소 두 값을 입력합니다.

```env
OPENAI_API_KEY=실제_OpenAI_API_키
DATABASE_URL=postgresql://USER:PASSWORD@HOST/DB이름?sslmode=require
```

프론트 주소가 다른 경우 다음 값도 수정합니다.

```env
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173
```

## 3. 서버 실행

```bash
python -m uvicorn api.app:app --reload --host 127.0.0.1 --port 8000
```

Windows에서는 `run_api.bat`을 실행해도 됩니다.

## 4. PDF 업로드 시험

브라우저에서 아래 주소를 엽니다.

```text
http://127.0.0.1:8000/
```

화면에서 PDF를 선택하고 **PDF 업로드**를 누르면 됩니다. 진행률, 추출 기사, 검토 필요 여부를 같은 화면에서 확인할 수 있습니다.

FastAPI 자동 API 문서는 아래 주소입니다.

```text
http://127.0.0.1:8000/docs
```

## 5. 프론트에서 호출할 API

### PDF 업로드

```http
POST /api/v1/documents
Content-Type: multipart/form-data
폼 필드 이름: file
```

JavaScript 예시:

```javascript
const formData = new FormData();
formData.append("file", selectedFile);

const response = await fetch("http://127.0.0.1:8000/api/v1/documents", {
  method: "POST",
  body: formData,
});

const job = await response.json();
console.log(job.document_id);
```

`Content-Type` 헤더는 직접 넣지 않습니다. 브라우저가 multipart boundary를 자동 생성해야 합니다.

### 진행 상태 조회

```http
GET /api/v1/documents/{document_id}
```

완료 상태는 다음 두 가지입니다.

```text
completed
completed_with_errors
```

### 추출 기사 조회

```http
GET /api/v1/documents/{document_id}/articles
```

검토 필요 기사만 조회:

```http
GET /api/v1/documents/{document_id}/articles?needs_review=true
```

### 사랑기사 페이지만 PDF로 다운로드

```http
GET /api/v1/documents/{document_id}/clipped-pdf
```

### 최근 업로드 이력

```http
GET /api/v1/documents?limit=50
```

## 6. 주요 파일

```text
api/app.py                     FastAPI 서버 시작점 + 테스트 업로드 화면
api/routes/documents.py        업로드·상태·기사·clipped PDF API
services/upload_service.py     업로드 스트리밍 저장 및 PDF 검증
services/extraction_job.py     페이지별 GPT 추출 백그라운드 작업
utils/pdf_pages.py             사랑기사 페이지 탐색·렌더링·PDF 자르기
db/documents.py                업로드 작업 이력 저장
db/articles.py                 추출 기사 저장 및 document_id별 조회
db/connection.py               documents/articles/evaluations 테이블 생성
main.py                        로컬 파일을 직접 처리하는 개발용 CLI
```

## 7. 로컬 CLI도 계속 사용 가능

```bash
python main.py --input "C:/PDF/잡지.pdf" --no-db
```

DB 저장까지 수행:

```bash
python main.py --input "C:/PDF/잡지.pdf"
```

## 8. 오류 의미

| 코드 | 의미 |
|---|---|
| `FILE_TOO_LARGE` | `.env`의 `MAX_UPLOAD_MB` 초과 |
| `INVALID_PDF` | PDF가 아니거나 암호·손상 문제가 있음 |
| `LOVE_PAGES_NOT_FOUND` | 텍스트 레이어에서 사랑기사 키워드를 찾지 못함 |
| `PDF_PAGE_SCAN_ERROR` | PDF 페이지 검사 중 오류 발생 |
| `UPLOAD_REGISTRATION_ERROR` | PostgreSQL 연결 또는 작업 등록 실패 |
| `DATABASE_ERROR` | 상태·기사 결과 DB 조회 실패 |

이미지로만 스캔된 PDF는 텍스트 키워드를 찾지 못할 수 있습니다. 현재 1차 버전에서는 이 경우 `LOVE_PAGES_NOT_FOUND`를 반환합니다.

## 9. 운영 전 주의

현재 추출 작업은 FastAPI `BackgroundTasks`로 실행됩니다. 개발·기업 시연에는 적합하지만, 서버가 작업 도중 재시작되면 해당 작업이 중단될 수 있습니다. 실제 운영 배포 전에는 `services/extraction_job.py`를 Celery/RQ 같은 별도 worker에서 실행하도록 분리하는 것이 좋습니다.

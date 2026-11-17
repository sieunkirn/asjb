# 사랑기사 분석 · 채점 백엔드 연동 가이드

백엔드 팀이 만든 **SSD_Scoring(FastAPI)** 서버와 프론트를 연결한 내용입니다.
분석·채점 기능은 **"파일 업로드 · 분석" 탭 상단**에 통합되어 있습니다(별도 메뉴 없음, 이전 주소 `#/scoring`은 업로드 탭으로 이동). 기존 데모(Mock) 업로드 기능은 같은 탭 하단에 **접힌 상태**로 남아 있습니다(‘펼치기’ 클릭 시 표시).

## DB 모드 (기본) — 모든 탭이 PostgreSQL을 봅니다

대시보드 · 기사 검수 · 리포트 · 호수 목록이 **Mock 데이터 대신 분석 서버 DB**에서 나옵니다
(`src/app/api/scoringDb.ts` → 백엔드 `api/routes/webapp.py`).

- 업로드→채점한 기사가 그대로 대시보드·검수 큐에 나타나고, **검수 확정(최종 점수)·중복 제외도 DB에 저장**되어 어느 컴퓨터에서든 같은 데이터가 보입니다 (테이블: `article_reviews`, `review_audit_logs`).
- 상태 매핑: 자동 확정(4·5번·제외) → "승인" / 기업 검토 필요·채점 전·채점 오류 → "재확인 필요" / 중복 제외 확정 → "중복 제외"
- 호수는 업로드 파일명(`…909호.pdf`)에서 자동 인식 — 호수 관리 탭의 수동 추가/수정은 DB 모드에서 비활성(안내 메시지 표시)
- **챗봇 · 알림 · 로그인 사용자**는 백엔드 DB에 데이터가 없어 기존(Mock) 동작 유지
- 예전 데모로 되돌리기: 프론트 `.env`에 `VITE_ARTICLES_SOURCE=mock`
- 다른 컴퓨터에서 보기: 그 컴퓨터에서도 백엔드를 켜고 같은 `DATABASE_URL`을 쓰거나, 한 대의 백엔드를 `--host 0.0.0.0`으로 열고 프론트 `VITE_SCORING_API_BASE_URL`로 가리키면 됩니다(백엔드 `ALLOWED_ORIGINS`에 프론트 주소 추가).

## 처리 흐름

```text
프론트: PDF 업로드  ──POST /api/v1/documents──▶  백엔드: 사랑기사 페이지 탐색 → GPT Vision 기사 추출(백그라운드)
프론트: 3초마다 GET /api/v1/documents/{id} · /articles 폴링 → 진행률 · 추출 기사 표시
프론트: [점수화 시작]  ──POST /api/v1/documents/{id}/evaluate──▶  백엔드: 기사별 실천자 점수 산정(백그라운드)
프론트: 3초마다 GET /api/v1/documents/{id}/evaluations 폴링 → 실천자별 점수 · 기업 검토 표시
프론트: [점수 엑셀 다운로드]  ──GET /evaluations.xlsx──▶  로쏘 형식 6컬럼 엑셀
```

점수 기준(백엔드 `scoring_service.py`):

| 유형 | 처리 |
|------|------|
| 4번 유형 | 자동 2점 (사내부부 공동 초대 `T4-3-COUPLE`은 각 1점) |
| 5번 유형 | 자동 1점 |
| 점수제외 | 자동 0점 |
| 1번 · 2번 · 기타내용 유형 | **기업 검토 필요** (자동 확정 안 함, 후보 점수만 표시) |

## 실행 방법

### 1. 백엔드 (SSD_Scoring) 실행

```bash
cd Sungsimdang_LoveArticle_Scoring_개선판/SSD_Scoring
# 최초 1회: setup_windows.bat (또는 python -m venv .venv && pip install -r requirements.txt)
# .env 에 OPENAI_API_KEY, DATABASE_URL 입력
run_api.bat            # Windows
# 또는
python -m uvicorn api.app:app --reload --host 127.0.0.1 --port 8000
```

백엔드 `.env`의 `ALLOWED_ORIGINS`에는 기본으로 `http://localhost:5173`이 들어 있습니다.
(개발 모드에서는 Vite 프록시를 타므로 CORS 설정과 무관하게 동작합니다.)

### 2. 프론트 실행

```bash
npm install
npm run dev     # http://localhost:5173 → 사이드바 "기사 분석 · 채점"
```

추가 설정 없이 `/api/v1/*` 요청이 `http://127.0.0.1:8000`으로 프록시됩니다 (`vite.config.ts`).

### 3. API 키 · DB 주소를 웹에서 입력 (선택)

백엔드 `.env`를 직접 편집하지 않아도, "기사 분석 · 채점" 화면 맨 위의 **"백엔드 설정 — OpenAI API 키 · DB 주소"** 패널에서 입력할 수 있습니다.

- 입력값은 백엔드 서버의 `.env`에 저장되고 **재시작 없이 즉시 적용**됩니다 (`OPENAI_API_KEY`, `DATABASE_URL`).
- 저장된 값은 다시 내려받지 않으며, 화면에는 마스킹된 꼬리(`sk-…abcd`)와 비밀번호를 뺀 DB 라벨만 표시됩니다.
- "연결 확인" 버튼으로 저장 전에 OpenAI 키 인증 · DB 접속(+테이블 생성)을 시험할 수 있습니다.
- 키나 DB가 비어 있으면 `run_api.bat`이 경고만 출력하고 서버를 띄우므로, 서버를 먼저 켠 뒤 웹에서 입력하면 됩니다.

이를 위해 백엔드에 다음이 추가되었습니다 (백엔드 팀 확인 필요):

| 파일 | 변경 |
|------|------|
| `SSD_Scoring/api/routes/settings.py` | **새 파일** — `GET/PUT /api/v1/settings`, `POST /api/v1/settings/test` |
| `SSD_Scoring/api/app.py` | settings 라우터 등록 (import 1개 + include_router 1개) |
| `SSD_Scoring/run_api.bat` | `.env`에 키가 없어도 서버를 시작하도록 변경 (오류 종료 → 경고) |
| `SSD_Scoring/tests/test_api_settings.py` | **새 파일** — 설정 API 단위 테스트 4개 |

> 주의: 이 설정 API는 인증이 없습니다. 백엔드 `ALLOWED_ORIGINS`(CORS)와 `127.0.0.1` 바인딩에 의존하므로, 외부 인터넷에 노출되는 서버에서는 사용하지 마세요(사내/로컬 시연용).

## 환경 변수

| 변수 | 위치 | 설명 |
|------|------|------|
| `VITE_SCORING_API_BASE_URL` | 프론트 `.env` | 백엔드 주소를 직접 지정 (예: `https://scoring.example.com`). 비우면 같은 출처(`/api/v1`)로 호출 → 개발 시 Vite 프록시 사용. **Vercel 등 정적 배포 시 반드시 설정** |
| `SCORING_API_PROXY_TARGET` | 프론트 실행 셸 | 개발 프록시 대상 변경 (기본 `http://127.0.0.1:8000`) |
| `OPENAI_API_KEY`, `DATABASE_URL`, `ALLOWED_ORIGINS` | 백엔드 `.env` | 백엔드 README 참고 |

## 추가 · 수정된 파일

### 새로 만든 파일

| 파일 | 역할 |
|------|------|
| `src/app/api/scoring.ts` | FastAPI `/api/v1/*` 클라이언트 + 응답 타입 (`ScoringDocument`, `ExtractedArticle`, `ArticleEvaluation`, `PractitionerResult` …) + `ScoringApiError` |
| `src/app/lib/scoringLabels.ts` | 상태 · 점수 유형 · 검토 사유 · 경고 코드 → 한글 라벨, 완료 판정, 집계 |
| `src/app/lib/scoringLabels.test.ts` | 위 유틸 단위 테스트 (`npm test`) |
| `src/app/pages/ScoringPage.tsx` | `ScoringSection`(업로드 → 추출 → 점수화 → 결과 표 → 엑셀) — UploadPage에 embedded로 삽입됨 |
| `src/app/components/ScoringSettingsPanel.tsx` | 백엔드 OpenAI API 키 · DATABASE_URL 웹 입력 패널 (저장 · 연결 확인) |
| `docs/scoring-integration.md` | 이 문서 |
| `.env.example` | (기존 파일) `VITE_SCORING_API_BASE_URL` 항목 추가 |

### 최소한으로 수정한 기존 파일

| 파일 | 변경 |
|------|------|
| `src/app/pages/UploadPage.tsx` | 상단에 `<ScoringSection embedded />` 삽입 + 컨테이너 폭 확대(max-w-5xl) + 데모 구분선 |
| `src/app/hooks/useHashRoute.ts` | 이전 주소 `#/scoring` → 업로드 탭으로 리다이렉트 |
| `vite.config.ts` | `/api/v1` 프록시 추가 |
| `src/vite-env.d.ts` | `VITE_SCORING_API_BASE_URL` 타입 추가 |

Mock 스토어(`mockStore.ts`)·챗봇은 동작을 바꾸지 않고 유지됩니다. (예전 모의 업로드 화면과 `PdfAnalyzePanel`은 제거했습니다.)
이 기능은 Mock 모드가 없으며 항상 실제 백엔드를 호출합니다(백엔드 미실행 시 화면 상단에 "분석 서버 연결 안 됨" 표시).

## 사용하는 백엔드 API

| 기능 | Method | 경로 |
|------|--------|------|
| 서버 상태 | GET | `/api/v1/health` |
| PDF 업로드(추출 시작) | POST | `/api/v1/documents` (multipart, 필드 `file`) |
| 최근 업로드 이력 | GET | `/api/v1/documents?limit=50` |
| 추출 진행 상태 | GET | `/api/v1/documents/{id}` |
| 추출 기사 목록 | GET | `/api/v1/documents/{id}/articles[?needs_review=true]` |
| 사랑기사 PDF | GET | `/api/v1/documents/{id}/clipped-pdf` |
| 점수화 시작 / 강제 재평가 | POST | `/api/v1/documents/{id}/evaluate[?force=true]` |
| 점수화 진행률 · 결과 | GET | `/api/v1/documents/{id}/evaluations[?needs_review=true]` |
| 점수 엑셀 | GET | `/api/v1/documents/{id}/evaluations.xlsx` |
| 기사 한 편 재평가 | POST | `/api/v1/articles/{id}/evaluate` |
| 설정 상태(마스킹) | GET | `/api/v1/settings` |
| API 키 · DB 주소 저장 | PUT | `/api/v1/settings` `{ openai_api_key?, database_url? }` |
| 연결 확인 | POST | `/api/v1/settings/test` `{ openai_api_key?, database_url?, targets? }` |

백엔드 오류는 `{ detail: { code, message } }` 형식으로 오며, 프론트는 `code`별로 분기합니다
(`EVALUATION_ALREADY_COMPLETED` → 전체 재평가 확인창, `EVALUATION_ALREADY_RUNNING` → 진행 상황 폴링 재개, `DOCUMENT_NOT_FOUND` → 선택 해제 등).

## 알아두면 좋은 점

- 마지막으로 본 문서 ID는 `localStorage`(`bredred-scoring-last-document-v1`)에 저장되어 새로고침해도 유지됩니다.
- 추출 · 점수화는 백엔드 `BackgroundTasks`로 돌아가므로 백엔드가 재시작되면 진행 중 작업이 끊길 수 있습니다(백엔드 README 9절).
- 대용량 PDF(수백 면)는 추출 30분 · 점수화 60분 정도 걸릴 수 있습니다. 화면을 벗어났다가 돌아와도 같은 문서를 선택하면 이어서 폴링합니다.

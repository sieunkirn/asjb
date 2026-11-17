# 성심당 사랑기사 평가 시스템

원본([BREDRED_test](https://github.com/jungsuryeon/BREDRED_test))을 코드 단순화한 뒤, 실제 백엔드 연동을 고려한 구조로 확장한 버전입니다.

- **단순화**: 미사용 shadcn/ui 컴포넌트 48개 및 Figma 보일러플레이트 제거, 의존성 60여 개 → 4개(react, react-dom, lucide-react, xlsx)로 축소
- **API 레이어 추가**: Mock ↔ 실제 API를 환경변수 하나로 전환할 수 있는 구조 ([sieunkirn](https://github.com/sieunkirn/bredred) 기여분 반영)
- **기능 확장**: 알림, 호수(edition) 별도 관리 페이지(월·주차별 그룹), 중복 기사 나란히 비교, 검수 이력(Audit Timeline), 실천자 점수(누적 점수 집계 · 엑셀 다운로드), PDF → AI 자동 분석(OpenAI 연동), 해시 기반 라우팅 등

## 🚀 로컬 실행 방법 (Quick Start)

```bash
npm install     # 최초 1회
npm run dev     # 프론트만 실행 → http://localhost:5173 접속 (Mock 데이터로 동작)
npm run build   # 배포용 빌드 (dist/ 생성)
```

기본값은 **Mock 데이터로 동작**하므로 별도 설정 없이 `npm run dev`만으로 바로 확인할 수 있습니다.

실제 백엔드(articles/editions 등)에 연결하는 방법은 [백엔드 연동 가이드](#-백엔드-연동-가이드)를 참고하세요.

## 📚 문서

- [Git/GitHub 협업 가이드 바로가기](docs/git-guide.md) — Git이 처음이거나 브랜치·PR·충돌 해결이 헷갈린다면 먼저 읽어보세요.
- [API 스펙](docs/api-spec.md) — 챗봇 도구(tool) 목록 등

## 📁 파일 구조

```
src/
├── main.tsx                       # 진입점
├── vite-env.d.ts                  # Vite 환경변수 타입 (VITE_API_BASE_URL, VITE_USE_MOCK)
├── styles/
│   └── index.css                  # 통합 스타일 — 디자인 토큰(브랜드 색상) + Tailwind 설정
└── app/
    ├── App.tsx                    # 앱 셸 — 라우팅, 초기 데이터 로딩, Context 주입
    ├── types.ts                   # ★ 공용 타입 정의 — 백엔드와 공유할 데이터 계약
    ├── utils.ts                   # 엑셀 내보내기 · 다수결 점수 계산 · 파일 크기 포맷
    ├── context/
    │   └── AppContext.tsx         # 전역 상태(user, editions, articles, notifications) Context
    ├── hooks/
    │   ├── useHashRoute.ts        # 해시 기반 라우팅 (예: #/review/A-2024-004)
    │   └── useScrollToResults.ts  # 검색 시 결과 영역으로 스크롤
    ├── lib/
    │   ├── articleFilters.ts      # 검색·상태·부서 필터링, 중복 기사 탐지, 검수 큐 정렬
    │   ├── reviewContent.ts       # API 응답(ReviewContent)에 UI 아이콘을 붙여 가공
    │   ├── editionUtils.ts        # 호수 월 표기, 선택 호수 보정
    │   ├── editionSync.ts         # 업로드↔기사↔호수 상태 동기화 로직
    │   ├── editionGrouping.ts     # 호수를 발행월 → 주차로 그룹핑 (상단바·호수 관리 공용)
    │   ├── excelExport.ts / excelStyles.ts / dbExcelFormat.ts  # PDF 분석 결과 Excel(DB) 서식
    │   └── chat*.ts, llm*.ts      # 챗봇 엔진·오케스트레이션·권한·LLM 연동 (아래 챗봇 섹션 참고)
    ├── api/                       # ★ Mock ↔ 실제 API 전환 레이어
    │   ├── client.ts              #   fetch 래퍼 + mock/real 스위치 (VITE_API_BASE_URL, VITE_USE_MOCK)
    │   ├── mockStore.ts           #   ★ Mock 데이터 저장소 — 실제 백엔드로 교체할 대상
    │   ├── mockPersistence.ts     #   Mock 상태를 localStorage에 저장/복원
    │   ├── types.ts               #   API 요청/응답 페이로드 타입, ApiError
    │   ├── articles.ts            #   기사 · 호수 · 로그인 사용자 · 알림 API
    │   ├── config.ts              #   분석 서버 주소 (VITE_SCORING_API_BASE_URL)
    │   ├── auth.ts                #   로그인(접속 코드) · 검수자 이름 · 브라우저 저장소
    │   ├── http.ts                #   서버 오류 응답 해석 (두 API 클라이언트가 공유)
    │   ├── scoringDb.ts           #   분석 서버 DB 모드 — 기사 · 호수 · 통계 · 검수
    │   ├── scoring.ts             #   업로드 · 기사 추출 · 점수화 API
    │   ├── chat.ts                #   챗봇 API
    │   └── index.ts               #   위 API들을 한 번에 export
    ├── components/                # 여러 페이지에서 재사용하는 UI
    │   ├── common.tsx             #   StatusTag(상태 태그) · ScoreDots(별점) · ConfirmDialog(확인 창)
    │   ├── Sidebar.tsx            #   좌측 내비게이션 (모바일 대응) · 로그아웃
    │   ├── LoginPage.tsx          #   로그인 화면 (이름 + 접속 코드)
    │   ├── scoring/               #   업로드 · 분석 화면의 표 · 결과 섹션 · 작은 UI
    │   ├── TopBar.tsx             #   상단 바 — 호수 선택(플라이아웃 메뉴) · 검색 · 알림 · 최근 활동
    │   ├── ChatbotWidget.tsx      #   우하단 AI 챗봇 위젯 (chatApi 연동)
    │   ├── AuditTimeline.tsx      #   검수 이력 타임라인 (확정 · 재검수 · 중복제외 · 업로드)
    │   ├── DuplicateComparePanel.tsx  # 중복 의심 기사 나란히 비교 UI
    │   ├── SearchFeedbackBar.tsx  #   전역 검색 결과 요약 바 ("N건 검색됨" 등)
    │   └── ui/                    #   재사용 UI 프리미티브
    │       ├── Button.tsx / buttonStyles.ts
    │       ├── Card.tsx
    │       ├── DataTable.tsx      #     DataTable · Tabs · ProgressBar
    │       ├── DropdownSelect.tsx #     공용 드롭다운 셀렉트
    │       ├── Feedback.tsx       #     EmptyState · LoadingState · ErrorBanner
    │       └── PageHeader.tsx     #     PageHeader · StatCard
    └── pages/                     # 화면 단위 — 사이드바 메뉴와 1:1 대응
        ├── DashboardPage.tsx      #   메인 대시보드 (요약 카드 · 정렬 가능한 기사 테이블 · 엑셀 다운로드)
        ├── UploadPage.tsx         #   파일 업로드 · 분석 · 채점 (ScoringPage.tsx 의 ScoringSection)
        ├── ReviewPage.tsx         #   기사 검수 — review/ReviewList · ReviewDetail (투표 · 중복 비교 · 검수 이력)
        ├── EditionPage.tsx        #   호수 관리 (월·주차별 그룹, 원본 파일 표시, 생성·수정·삭제)
        └── PractitionerScorePage.tsx  #  실천자 점수 (실천자별 누적 점수 · 엑셀 다운로드)
```

★ 표시 = 백엔드 연동 시 반드시 살펴봐야 할 파일. 나머지는 이미 API 레이어를 통해 동작하므로 그대로 두면 됩니다.

## 💬 챗봇 개발용 서버 코드 (`server/`)

`server/chatLlm.ts` 는 챗봇의 LLM 호출(OpenAI 호환)을, `server/viteChatPlugin.ts` 는 개발 중 Vite 개발 서버에 `/api/chat/completions` 를 붙이는 플러그인을 담고 있습니다. 같은 출처 요청과 JSON 본문 64KB 이하만 받도록 막혀 있습니다.
(예전의 Express PDF 분석 서버는 분석 서버(FastAPI)로 완전히 대체되어 제거했습니다.)

## 🔌 백엔드 연동 가이드

이 프로젝트는 이미 **Mock ↔ 실제 API를 스위치 하나로 전환할 수 있는 구조**로 되어 있습니다. 백엔드 서버가 준비되면 아래 절차만 따르면 됩니다.

### 1. 환경변수로 전환 — `.env`

```bash
VITE_API_BASE_URL=https://api.example.com   # 이 값이 설정되면 자동으로 실제 API를 사용
VITE_USE_MOCK=false                          # (선택) mock을 명시적으로 끄고 싶을 때
```

`VITE_API_BASE_URL`이 비어 있으면 자동으로 Mock으로 동작합니다(`src/app/api/client.ts`의 `USE_MOCK` 판별 로직). 즉 로컬 개발 중에는 아무 설정 없이 그대로 실행하면 되고, 배포 환경에서만 이 값을 채우면 됩니다.

### 2. 데이터 계약 — `src/app/types.ts`

프론트가 기대하는 응답 구조가 전부 여기 정의되어 있습니다. API 응답 스키마를 이 타입(`Article`, `Edition`, `User`, `Notification`, `AuditLogEntry`, `UploadedFile`, `ChatMessage`, `ReviewContent`)에 맞추면 됩니다.

### 3. API 엔드포인트 구현 — `src/app/api/*.ts`

각 API 모듈은 `apiCall(mockFn, realFn)` 형태로 mock 구현과 실제 호출을 나란히 정의해 둡니다. `realFn`이 호출하는 아래 REST 엔드포인트를 백엔드에서 구현하면 프론트 코드는 수정할 필요가 없습니다.

| 모듈 | 엔드포인트 | 설명 |
|---|---|---|
| `articlesApi` | `GET /api/articles`<br>`GET /api/articles/:id`<br>`GET /api/articles/:id/review`<br>`PATCH /api/articles/:id`<br>`POST /api/articles/exclude-duplicate`<br>`GET /api/audit` | 기사 목록/상세/리뷰 콘텐츠 조회, 점수 확정, 중복 제외, 감사 로그 |
| `editionsApi` | `GET /api/editions`<br>`POST /api/editions`<br>`PATCH /api/editions/:id`<br>`DELETE /api/editions/:id`<br>`POST /api/editions/reset-mock` | 호수 목록 조회 · 생성 · 수정(라벨/발행월/주차) · 삭제 |
| `authApi` | `GET /api/auth/me` | 현재 로그인 사용자 |
| `notificationsApi` | `GET /api/notifications`<br>`PATCH /api/notifications/:id/read`<br>`PATCH /api/notifications/read-all` | 알림 |
| `chatApi` | `GET /api/chat/preset`<br>`GET /api/chat/briefing`<br>`POST /api/chat`<br>`POST /api/chat/actions` | 챗봇 대화, 선제 브리핑, 액션 로깅 |

요청 페이로드 타입은 `src/app/api/types.ts` 참고. (PDF AI 분석은 이 전환 레이어를 쓰지 않으므로 위 표에 없습니다 — 위 [PDF AI 분석 백엔드](#️-pdf-ai-분석-백엔드-server) 섹션 참고.)

### 4. Mock 동작이 기대 명세서 — `src/app/api/mockStore.ts`

각 엔드포인트가 실제로 어떤 데이터·로직으로 동작해야 하는지 궁금하다면, 이 파일의 Mock 구현이 곧 명세입니다. (예: `confirmArticle`은 다수결 점수로 상태를 "승인"으로 바꾸고 감사 로그를 남기는 방식으로 동작)

### 5. 엑셀 다운로드는 백엔드가 필요 없음

`utils.ts`의 `exportArticlesToExcel(articles, scope, editionLabel)`은 브라우저에서 바로 엑셀 파일을 생성하므로 서버 연동이 필요 없습니다. 서버 생성 방식으로 바꾸고 싶다면 `DashboardPage.tsx`의 "엑셀 다운로드" 버튼 핸들러만 교체하면 됩니다.

### 6. 전역 상태 흐름

`App.tsx`가 초기 진입 시 여러 API를 병렬로 호출해 `AppContext`(`src/app/context/AppContext.tsx`)에 채워 넣고, 각 페이지는 `useApp()` 훅으로 필요한 값을 꺼내 씁니다.

```
App.tsx → loadCoreData()
   ├─ articlesApi.list() / editionsApi.list()
   ├─ authApi.me() / notificationsApi.list()
   └─ AppContext.Provider로 주입
          │
          ├─ useApp() ──▶ ReviewPage, TopBar, EditionPage, ChatbotWidget 등에서 구독
          └─ useHashRoute() ──▶ URL 해시(#/review/:id)로 현재 페이지·선택된 기사 관리
```

API 연동 시에는 `apiCall`의 `realFn` 쪽 엔드포인트만 백엔드에서 구현하면 되고, `App.tsx`나 페이지 컴포넌트는 수정할 필요가 없습니다.

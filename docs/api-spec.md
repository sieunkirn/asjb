# API 스펙 (호수 · 업로드)

Mock API와 실 백엔드가 공유할 데이터 계약 요약입니다. 상세 타입은 `src/app/types.ts`를 기준으로 합니다.

## 호수 (Edition)

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/api/editions` | 호수 목록 (기사 수·상태 포함) |
| POST | `/api/editions` | 호수 수동 생성 `{ id, label?, month? }` |
| PATCH | `/api/editions/:id` | 라벨·발행월 수정 `{ label?, month? }` |

### Edition 객체

```typescript
{
  id: number;
  label: string;
  month: string;
  status: "업로드 대기" | "검수 중" | "완료";
  articleCount: number;
}
```

## 업로드 (Upload)

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/api/uploads` | 처리 현황 목록 |
| POST | `/api/uploads` | 업로드 시작 `{ name, size, edition? }` |
| DELETE | `/api/uploads/:id` | 업로드 삭제 + 연관 기사 롤백 |

### DELETE 응답

```typescript
{ removedArticles: number; editionId?: number; }
```

## 연동 필드

- `Article.sourceUploadId` — 생성 업로드 ID
- `UploadedFile.articleIds` — 생성된 기사 ID 목록
- `Notification.sourceUploadId` — 업로드 완료 알림 추적

## Mock 전용

- `POST /api/editions/reset-mock` — 초기 데이터 복원
- `localStorage` 키 `bredred-mock-store-v1`에 상태 자동 저장

## 챗봇 (Chat)

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/api/chat/preset?edition={id}` | 호수별 환영 대화 (실시간 미처리 목록) |
| GET | `/api/chat/briefing?edition={id}` | 프로액티브 브리핑 (미처리·중복 요약) |
| POST | `/api/chat` | 질의 응답 |
| POST | `/api/chat/actions` | 챗봇 액션 감사 로그 기록 |
| POST | `/api/chat/completions` | LLM 백엔드 (선택, `VITE_CHAT_PROVIDER=llm`) |

### SendChatPayload

```typescript
{
  message: string;
  editionId?: number;   // TopBar 선택 호수
  page?: Page;          // dashboard | upload | review | …
  articleId?: string;   // 검수 화면에서 열린 기사
  history?: ChatHistoryTurn[];  // 최근 8턴 맥락
  userRole?: UserRole;  // viewer/reviewer/admin — 액션 권한 필터
  llmContext?: {        // LLM 모드: 클라이언트 Tool 실행 결과
    toolsUsed?: string[];
    toolResults?: Record<string, unknown>;
  };
}
```

응답은 `ChatMessage` (`text`, `table`, `links`, `actions`, `meta`)이며 Mock은 `articles`/`editions`를 실시간 조회합니다.

### LLM 연동

1. `.env.example` → `.env` 복사
2. `VITE_CHAT_PROVIDER=llm` 설정
3. `OPENAI_API_KEY=sk-...` 입력 (서버 전용, 클라이언트에 노출되지 않음)
4. `npm run dev` — Vite dev 서버가 `POST /api/chat/completions` 처리

흐름: 클라이언트 Tool 실행 → `llmContext.toolResults` 전달 → LLM 자연어 응답 + 규칙 기반 `actions` 병합.  
LLM 실패·키 미설정 시 **규칙 기반으로 자동 폴백**.

| 환경 변수 | 설명 |
|-----------|------|
| `VITE_CHAT_PROVIDER` | `rule` \| `llm` |
| `OPENAI_API_KEY` | OpenAI API 키 (필수, llm 모드) |
| `OPENAI_BASE_URL` | 기본 `https://api.openai.com/v1` (Azure·Groq 등 호환 API 가능) |
| `OPENAI_MODEL` | 기본 `gpt-4o-mini` |

`meta` 필드 (Phase 3):

```typescript
interface ChatMessageMeta {
  toolsUsed?: string[];       // 호출된 Tool 이름
  provider?: "rule" | "llm";  // 응답 생성 방식
  proactive?: boolean;        // 프로액티브 브리핑 여부
}
```

### Tool 레이어 (Phase 3)

규칙 기반 orchestrator가 메시지에서 Tool을 추론해 실행합니다 (`src/app/lib/chatTools.ts`).

| Tool | 설명 |
|------|------|
| `get_edition_stats` | 승인률·기사 수·평균 점수 |
| `get_pending_articles` | 재확인 필요 목록 |
| `get_duplicate_pairs` | 중복 의심 쌍 |
| `get_article` | 기사 ID 상세 |
| `get_person_articles` | 실천자·작성자 이름 관련 기사 |
| `get_edition_status` | 호수 메타 |

LLM 연동 시 서버에서 동일 Tool 스키마(`CHAT_TOOL_DEFINITIONS`)를 function calling에 사용합니다.

### 환경 변수

| 변수 | 값 | 설명 |
|------|-----|------|
| `VITE_CHAT_PROVIDER` | `rule` (기본) / `llm` | LLM 사용 시 `POST /api/chat/completions` 호출, 실패 시 rule 폴백 |
| `VITE_API_BASE_URL` | URL | API 서버 (미설정 시 Mock) |

### ChatAction (Phase 2)

```typescript
type ChatActionType =
  | "open_review"           // 검수 화면 열기
  | "open_duplicate_compare" // 중복 비교 패널 (검수 화면)
  | "filter_dashboard"      // 대시보드 상태 필터 적용
  | "navigate_review_list"  // 검수 목록(재확인 필요 탭)
  | "confirm_score";        // AI 제안 점수 승인 (확인 다이얼로그)
```

`history` 필드로 최근 8턴 맥락 전달 — "그 기사 승인해" 등 후속 질문 지원.

### 권한 (Phase 3)

| 역할 | 허용 액션 |
|------|-----------|
| viewer | open_review, open_duplicate_compare, filter_dashboard, navigate_review_list |
| reviewer / admin | 위 + confirm_score |

챗봇 액션 실행 시 `auditLogs`에 `chat_action` 항목이 기록됩니다.

대화 기록은 `localStorage` 키 `bredred-chat-history-v1`에 호수별 저장.

// ─── 공용 타입 정의 ───────────────────────────────────────────────────────────

export type Status = "승인" | "재확인 필요" | "중복 제외";
export type Page = "dashboard" | "upload" | "review" | "scores" | "editions";
export type UserRole = "admin" | "reviewer" | "viewer";

export interface User {
  id: string;
  name: string;
  role: UserRole;
  department: string;
}

export interface Edition {
  id: number;
  label: string;
  month: string;
  week?: number;
  status: "검수 중" | "완료" | "업로드 대기";
  articleCount: number;
  /** ── DB 모드 진행 현황 (호수 관리 탭) ── */
  pending?: number;
  confirmed?: number;
  excluded?: number;
  errors?: number;
  unscored?: number;
  /** 검수 진행률 = (확정 + 중복 제외) / 전체 × 100 */
  progressPercent?: number;
  /** 발행월 출처 — manual: 직접 지정, upload_date: 업로드일로 추측 */
  monthSource?: "manual" | "upload_date";
  /** 이 호수를 만든 원본 업로드 파일명 (팀 '원본 파일 표시' 기능의 DB 버전) */
  sourceFile?: string;
}

export interface Article {
  id: string;
  edition: number;
  author: string;
  subject: string;
  department: string;
  aiScore: number;
  finalScore?: number;
  status: Status;
  date: string;
  flagReason?: string;
  basis?: string;
  relatedArticleIds?: string[];
  assignee?: string;
  sourceUploadId?: string;
}

export interface UploadedFile {
  id: string;
  name: string;
  size: number;
  progress: number;
  stage: "uploading" | "extracting" | "analyzing" | "done";
  edition?: number;
  pages?: number;
  found?: number;
  articleIds?: string[];
}

export interface ChatMessage {
  role: "user" | "ai";
  text: string;
  table?: { headers: string[]; rows: string[][] };
  links?: { label: string; id: string }[];
  actions?: ChatAction[];
  timestamp: Date;
  meta?: ChatMessageMeta;
}

export interface ChatMessageMeta {
  toolsUsed?: string[];
  provider?: "rule" | "llm";
  proactive?: boolean;
  demo?: boolean;
}

export type ChatActionType =
  | "open_review"
  | "open_duplicate_compare"
  | "filter_dashboard"
  | "navigate_review_list"
  | "confirm_score";

export interface ChatAction {
  id: string;
  type: ChatActionType;
  label: string;
  articleId?: string;
  compareWithId?: string;
  filterStatus?: Status | "전체";
  page?: Page;
  suggestedScore?: number;
}

export interface ChatHistoryTurn {
  role: "user" | "ai";
  text: string;
  articleId?: string;
}

export interface ReviewContent {
  title: string;
  body: string;
  ocr: string;
  recognized: { label: string; value: string }[];
  confidence: number;
  flags: string[];
}

export interface AuditLogEntry {
  id: string;
  articleId: string;
  action: "confirm" | "re-review" | "exclude_duplicate" | "upload" | "relation_update" | "chat_action";
  detail: string;
  userName: string;
  timestamp: string;
}

export interface Notification {
  id: string;
  title: string;
  message: string;
  type: "info" | "warning" | "success";
  read: boolean;
  timestamp: string;
  articleId?: string;
  sourceUploadId?: string;
}

export interface UpdateEditionPayload {
  label?: string;
  month?: string;
  week?: number;
}

export interface ArticleFilters {
  edition?: number;
  status?: Status | "전체";
  department?: string;
  search?: string;
}

/** 호수별 통계 (분석 서버 /api/stats 응답) */
export interface DashboardStats {
  total: number;
  approved: number;
  pending: number;
  excluded: number;
  avgAiScore: number;
  avgFinalScore: number;
  byDepartment: { department: string; count: number; avgScore: number }[];
  duplicatePairs: { ids: [string, string]; subject: string }[];
}

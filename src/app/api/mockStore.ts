import type {
  Article, AuditLogEntry, ChatMessage, Edition,
  Notification, UploadedFile, User, ReviewContent,
} from "../types";
import { formatEditionMonth } from "../lib/editionUtils";
import { computeEditionSync } from "../lib/editionSync";
import { loadPersistedState, savePersistedState, clearPersistedState } from "./mockPersistence";
import { buildWelcomePreset } from "../lib/chatEngine";
import { orchestrateChat } from "../lib/chatOrchestrator";
import { buildProactiveBriefing } from "../lib/chatProactive";
import { filterActionsByRole } from "../lib/chatPermissions";
import { tryLlmChat, isLlmProviderEnabled } from "../lib/llmChatProvider";
import type { SendChatPayload } from "./types";
import type { ChatAction } from "../types";

const MOCK_USER: User = {
  id: "USR-001",
  name: "김검수",
  role: "reviewer",
  department: "인사팀",
};

const INITIAL_EDITION_IDS = new Set([908, 907, 906]);

const INITIAL_906_ARTICLE_IDS = [
  "A-2023-001", "A-2023-002", "A-2023-003", "A-2023-004", "A-2023-005",
  "A-2023-006", "A-2023-007", "A-2023-008", "A-2023-009", "A-2023-010",
];

const INITIAL_906_ARTICLES: Article[] = INITIAL_906_ARTICLE_IDS.map((id, i) => ({
  id,
  edition: 906,
  author: ["한지우", "서민재", "윤서준", "강하늘", "오민서", "배준혁", "노수빈", "임도윤", "신유진", "황태민"][i],
  subject: ["김도현", "이채원", "박시우", "정하은", "최민준", "장서연", "윤지호", "한소율", "조민재", "류하린"][i],
  department: ["생산팀", "영업팀", "기획팀", "품질팀", "물류팀"][i % 5],
  aiScore: +(3.8 + (i % 3) * 0.3).toFixed(1),
  finalScore: 4,
  status: "승인" as const,
  date: "2023-12-15",
  basis: "906호 AI 자동 추출 기사 — 업로드 파이프라인에서 생성됨",
  sourceUploadId: "u-2",
}));

const DEFAULT_EDITIONS: Edition[] = [
  { id: 908, label: "908호", month: "2024년 2월", week: 1, status: "업로드 대기", articleCount: 0 },
  { id: 907, label: "907호", month: "2024년 1월", week: 4, status: "검수 중", articleCount: 10 },
  { id: 906, label: "906호", month: "2023년 12월", week: 4, status: "완료", articleCount: 10 },
];

const DEFAULT_ARTICLES: Article[] = [
  { id: "A-2024-001", edition: 907, author: "김민지", subject: "박준호", department: "생산팀", aiScore: 4.2, finalScore: 4, status: "승인", date: "2024-01-15", basis: "야간 근무 중 몸이 안 좋아진 동료를 병원까지 동행하고 남은 업무를 대신 마무리함", assignee: "김검수" },
  { id: "A-2024-002", edition: 907, author: "이서연", subject: "최동욱", department: "영업팀", aiScore: 3.1, status: "재확인 필요", date: "2024-01-15", flagReason: "회사 지원 물품(핫팩) 관련 내용 포함", basis: "극심한 한파에 현장 배달을 나선 동료들을 위해 사비로 핫팩 30개를 구입해 나눠줌", relatedArticleIds: ["A-2024-005"] },
  { id: "A-2024-003", edition: 907, author: "박현우", subject: "정수아", department: "기획팀", aiScore: 4.8, finalScore: 5, status: "승인", date: "2024-01-16", basis: "신입사원 적응을 위해 3주간 매일 30분씩 자발적으로 업무 멘토링을 진행함", assignee: "김검수" },
  { id: "A-2024-004", edition: 907, author: "김태영", subject: "이민호", department: "생산팀", aiScore: 2.5, status: "재확인 필요", date: "2024-01-16", flagReason: "중복 의심 건 — 유사 내용 A-2024-007과 비교 필요", basis: "설비 고장으로 지연된 라인 복구를 돕기 위해 퇴근 후 남아 함께 정비함", relatedArticleIds: ["A-2024-007"] },
  { id: "A-2024-005", edition: 907, author: "오지수", subject: "한예슬", department: "인사팀", aiScore: 1.0, status: "중복 제외", date: "2024-01-17", flagReason: "A-2024-002 중복", basis: "부서 행사 준비를 도움 (A-2024-002와 내용 중복으로 감지됨)", relatedArticleIds: ["A-2024-002"] },
  { id: "A-2024-006", edition: 907, author: "정다은", subject: "류승범", department: "품질팀", aiScore: 4.5, finalScore: 5, status: "승인", date: "2024-01-17", basis: "출장 중 사고를 당한 협력사 직원을 응급실까지 이송하고 보호자 도착까지 함께 있어줌", assignee: "김검수" },
  { id: "A-2024-007", edition: 907, author: "신재원", subject: "이민호", department: "생산팀", aiScore: 2.6, status: "재확인 필요", date: "2024-01-18", flagReason: "중복 의심 건 — A-2024-004와 동일 인물", basis: "설비 정비 지원 (A-2024-004와 동일 실천자·유사 내용)", relatedArticleIds: ["A-2024-004"] },
  { id: "A-2024-008", edition: 907, author: "장혜린", subject: "문성준", department: "영업팀", aiScore: 3.8, finalScore: 4, status: "승인", date: "2024-01-18", basis: "고객 불만 응대로 지친 신입 팀원을 격려하고 응대 노하우를 공유함" },
  { id: "A-2024-009", edition: 907, author: "최준서", subject: "박민경", department: "물류팀", aiScore: 4.1, finalScore: 4, status: "승인", date: "2024-01-19", basis: "폭우로 침수된 창고 물품을 동료들과 밤새 함께 옮겨 손실을 최소화함" },
  { id: "A-2024-010", edition: 907, author: "임소영", subject: "강동원", department: "기획팀", aiScore: 2.9, status: "재확인 필요", date: "2024-01-19", flagReason: "작성자-실천자 사내 커플 관계 등록됨 — 친분 제외 대상 검토 필요", basis: "야근하는 동료에게 저녁을 챙겨주고 업무를 나눠 도움" },
  ...INITIAL_906_ARTICLES,
];

const DEFAULT_AUDIT_LOGS: AuditLogEntry[] = [
  { id: "log-1", articleId: "A-2024-001", action: "confirm", detail: "최종 점수 4.0점 확정", userName: "김검수", timestamp: "2024-01-20T10:30:00" },
  { id: "log-2", articleId: "A-2024-005", action: "exclude_duplicate", detail: "A-2024-002와 중복으로 제외 처리", userName: "김검수", timestamp: "2024-01-20T11:15:00" },
];

const DEFAULT_NOTIFICATIONS: Notification[] = [
  { id: "n-1", title: "검수 대기", message: "907호 재확인 필요 기사 4건이 있습니다.", type: "warning", read: false, timestamp: new Date().toISOString(), articleId: "A-2024-002" },
  { id: "n-2", title: "중복 감지", message: "이민호 사원 관련 중복 의심 2건 — 비교 검수 필요", type: "warning", read: false, timestamp: new Date().toISOString(), articleId: "A-2024-004" },
  { id: "n-3", title: "908호 업로드 대기", message: "새 호수 PDF 업로드를 진행해 주세요.", type: "info", read: true, timestamp: new Date().toISOString() },
];

const DEFAULT_UPLOADS: UploadedFile[] = [
  { id: "u-1", name: "한가족신문_908호.pdf", size: 4312000, progress: 75, stage: "analyzing", edition: 908, pages: 8, found: 6 },
  {
    id: "u-2",
    name: "한가족신문_906호.pdf",
    size: 3890000,
    progress: 100,
    stage: "done",
    edition: 906,
    pages: 8,
    found: 10,
    articleIds: [...INITIAL_906_ARTICLE_IDS],
  },
];

function cloneDefaults() {
  return {
    editions: DEFAULT_EDITIONS.map(e => ({ ...e })),
    articles: DEFAULT_ARTICLES.map(a => ({ ...a })),
    auditLogs: DEFAULT_AUDIT_LOGS.map(l => ({ ...l })),
    notifications: DEFAULT_NOTIFICATIONS.map(n => ({ ...n })),
    uploads: DEFAULT_UPLOADS.map(u => ({ ...u, articleIds: u.articleIds ? [...u.articleIds] : undefined })),
  };
}

const persisted = loadPersistedState();
const initial = persisted
  ? {
      editions: persisted.editions as Edition[],
      articles: persisted.articles as Article[],
      auditLogs: persisted.auditLogs as AuditLogEntry[],
      notifications: persisted.notifications as Notification[],
      uploads: persisted.uploads as UploadedFile[],
    }
  : cloneDefaults();

let editions = initial.editions;
let articles = initial.articles;
let auditLogs = initial.auditLogs;
let notifications = initial.notifications;
let uploads = initial.uploads;

const delay = (ms = 400) => new Promise<void>(r => setTimeout(r, ms));

function persistMockState(): void {
  savePersistedState({ editions, articles, uploads, auditLogs, notifications });
}

function syncEdition(editionId: number): void {
  const idx = editions.findIndex(e => e.id === editionId);
  if (idx === -1) return;

  const result = computeEditionSync({
    editionId,
    articles,
    uploads,
    isProtectedEdition: INITIAL_EDITION_IDS.has(editionId),
  });

  editions[idx] = { ...editions[idx], articleCount: result.articleCount, status: result.status };

  if (result.removeFromList) {
    editions = editions.filter(e => e.id !== editionId);
  }
  persistMockState();
}

function syncAllEditions(): void {
  [...editions].forEach(e => syncEdition(e.id));
}

if (!persisted) syncAllEditions();
else {
  syncAllEditions();
  persistMockState();
}

function addAudit(entry: Omit<AuditLogEntry, "id">) {
  auditLogs = [{ ...entry, id: `log-${Date.now()}` }, ...auditLogs].slice(0, 100);
  persistMockState();
}

function buildReviewContent(article: Article): ReviewContent {
  const recognized = [
    { label: "작성자", value: article.author },
    { label: "실천자", value: article.subject },
    { label: "부서", value: article.department },
  ];

  if (article.id === "A-2024-002") {
    const body =
      "지난 한 주 극심한 한파가 몰아쳤던 날, 영업팀 최동욱 대리님께서는 현장 배달을 나선 동료들을 위해 사비로 핫팩 30개를 구입해 나눠주셨습니다.";
    return {
      title: "따뜻한 마음이 빛난 순간",
      body,
      ocr: body,
      recognized,
      confidence: 62,
      flags: [
        "회사 지원 물품(핫팩) 관련 행동이 언급됨 — 개인 사비 여부 불분명",
        "실천 내용이 업무 범주에 해당할 가능성 있음",
      ],
    };
  }

  const basisText = article.basis ? `${article.basis} ` : "";
  const body = `${article.department} ${article.subject}님과 관련된 사랑기사입니다. ${basisText}${article.author}님이 작성하였으며, AI가 ${article.aiScore.toFixed(1)}점을 제안하였습니다.`;
  return {
    title: "나의 정말 소중한 사람들",
    body,
    ocr: `${body}\n\n작성자: ${article.author} / 실천자: ${article.subject}`,
    recognized,
    confidence: Math.min(95, Math.round(article.aiScore * 20)),
    flags: article.flagReason ? [article.flagReason] : ["특이사항 없음 — 평가단 최종 확인용"],
  };
}

function getEditionSnapshots(): Edition[] {
  return editions.map(e => ({
    ...e,
    articleCount: articles.filter(a => a.edition === e.id).length,
  }));
}

// ─── 챗봇 데이터 소스 주입 ────────────────────────────────────────────────────
// DB 모드에서는 화면과 챗봇이 같은 데이터를 봐야 하므로, ChatbotWidget이
// 현재(실제 DB) 기사·호수를 여기로 주입한다. 주입이 없으면 Mock 데이터 사용.
let chatArticlesOverride: Article[] | null = null;
let chatEditionsOverride: Edition[] | null = null;

export function setChatDataSource(a: Article[] | null, e: Edition[] | null): void {
  chatArticlesOverride = a;
  chatEditionsOverride = e;
}

const chatArticles = (): Article[] => chatArticlesOverride ?? articles;

export const mockStore = {
  async getCurrentUser(): Promise<User> {
    await delay(100);
    return { ...MOCK_USER };
  },

  async getEditions(): Promise<Edition[]> {
    await delay(200);
    return editions.map(e => ({
      ...e,
      articleCount: articles.filter(a => a.edition === e.id).length,
    }));
  },

  async getArticles(edition?: number): Promise<Article[]> {
    await delay(350);
    const list = edition != null ? articles.filter(a => a.edition === edition) : [...articles];
    return list;
  },

  async getArticle(id: string): Promise<Article> {
    await delay(200);
    const article = articles.find(a => a.id === id);
    if (!article) throw new Error("기사를 찾을 수 없습니다.");
    return { ...article };
  },

  async getReviewContent(id: string): Promise<ReviewContent> {
    await delay(300);
    const article = articles.find(a => a.id === id);
    if (!article) throw new Error("기사를 찾을 수 없습니다.");
    return buildReviewContent(article);
  },

  async confirmArticle(id: string, finalScore: number, isRereview = false): Promise<Article> {
    await delay(500);
    const idx = articles.findIndex(a => a.id === id);
    if (idx === -1) throw new Error("기사를 찾을 수 없습니다.");
    articles[idx] = { ...articles[idx], status: "승인", finalScore, assignee: MOCK_USER.name };
    addAudit({
      articleId: id,
      action: isRereview ? "re-review" : "confirm",
      detail: `최종 점수 ${finalScore.toFixed(1)}점 ${isRereview ? "수정" : "확정"}`,
      userName: MOCK_USER.name,
      timestamp: new Date().toISOString(),
    });
    return { ...articles[idx] };
  },

  async excludeDuplicate(keepId: string, excludeId: string): Promise<Article[]> {
    await delay(500);
    const keepIdx = articles.findIndex(a => a.id === keepId);
    const exIdx = articles.findIndex(a => a.id === excludeId);
    if (keepIdx === -1 || exIdx === -1) throw new Error("기사를 찾을 수 없습니다.");
    articles[exIdx] = { ...articles[exIdx], status: "중복 제외", flagReason: `${keepId} 중복 제외` };
    addAudit({ articleId: excludeId, action: "exclude_duplicate", detail: `${keepId} 유지, ${excludeId} 중복 제외`, userName: MOCK_USER.name, timestamp: new Date().toISOString() });
    return [articles[keepIdx], articles[exIdx]].map(a => ({ ...a }));
  },

  async getAuditLogs(articleId?: string): Promise<AuditLogEntry[]> {
    await delay(200);
    return articleId ? auditLogs.filter(l => l.articleId === articleId) : [...auditLogs];
  },

  async getNotifications(): Promise<Notification[]> {
    await delay(150);
    return [...notifications];
  },

  async markNotificationRead(id: string): Promise<void> {
    await delay(100);
    notifications = notifications.map(n => n.id === id ? { ...n, read: true } : n);
    persistMockState();
  },

  async markAllNotificationsRead(): Promise<void> {
    await delay(100);
    notifications = notifications.map(n => ({ ...n, read: true }));
    persistMockState();
  },

  async createEdition(id: number, label?: string, month?: string, week?: number): Promise<Edition> {
    await delay(200);
    if (editions.some(e => e.id === id)) throw new Error(`${id}호는 이미 존재합니다.`);
    if (id < 100 || id > 9999) throw new Error("호수 번호는 100~9999 사이여야 합니다.");
    const edition: Edition = {
      id,
      label: label ?? `${id}호`,
      month: month ?? formatEditionMonth(),
      week: week ?? 1,
      status: "업로드 대기",
      articleCount: 0,
    };
    editions = [edition, ...editions].sort((a, b) => b.id - a.id);
    persistMockState();
    addAudit({
      articleId: "—",
      action: "upload",
      detail: `${edition.label} 호수 수동 생성`,
      userName: MOCK_USER.name,
      timestamp: new Date().toISOString(),
    });
    return { ...edition };
  },

  async updateEdition(id: number, patch: { label?: string; month?: string; week?: number }): Promise<Edition> {
    await delay(200);
    const idx = editions.findIndex(e => e.id === id);
    if (idx === -1) throw new Error("호수를 찾을 수 없습니다.");
    editions[idx] = {
      ...editions[idx],
      ...(patch.label != null ? { label: patch.label } : {}),
      ...(patch.month != null ? { month: patch.month } : {}),
      ...(patch.week != null ? { week: patch.week } : {}),
    };
    persistMockState();
    return { ...editions[idx], articleCount: articles.filter(a => a.edition === id).length };
  },

  async deleteEdition(id: number): Promise<void> {
    await delay(200);
    const idx = editions.findIndex(e => e.id === id);
    if (idx === -1) throw new Error("호수를 찾을 수 없습니다.");
    const removedArticleIds = new Set(articles.filter(a => a.edition === id).map(a => a.id));
    articles = articles.filter(a => a.edition !== id);
    uploads = uploads.filter(u => u.edition !== id);
    notifications = notifications.filter(n => {
      if (n.articleId && removedArticleIds.has(n.articleId)) return false;
      return !n.message.includes(`${id}호`);
    });
    auditLogs = auditLogs.filter(l => !removedArticleIds.has(l.articleId));
    editions = editions.filter(e => e.id !== id);
    persistMockState();
  },

  async resetMockData(): Promise<void> {
    await delay(100);
    const defaults = cloneDefaults();
    editions = defaults.editions;
    articles = defaults.articles;
    auditLogs = defaults.auditLogs;
    notifications = defaults.notifications;
    uploads = defaults.uploads;
    syncAllEditions();
    clearPersistedState();
    persistMockState();
  },

  async getProactiveBriefing(editionId = 907): Promise<import("../types").ChatMessage | null> {
    await delay(150);
    const body = buildProactiveBriefing(editionId, chatArticles());
    if (!body) return null;
    const role = MOCK_USER.role;
    const actions = filterActionsByRole(body.actions, role);
    return {
      role: "ai",
      ...body,
      actions: actions.length ? actions : undefined,
      timestamp: new Date(),
    };
  },

  async recordChatAction(action: ChatAction): Promise<void> {
    await delay(100);
    addAudit({
      articleId: action.articleId ?? "—",
      action: "chat_action",
      detail: `챗봇: ${action.label}`,
      userName: MOCK_USER.name,
      timestamp: new Date().toISOString(),
    });
  },

  async getPresetChat(editionId = 907): Promise<ChatMessage[]> {
    await delay(200);
    const now = Date.now();
    return buildWelcomePreset(editionId, chatArticles()).map((m, i) => ({
      ...m,
      timestamp: new Date(now - (120000 - i * 5000)),
    }));
  },

  async sendChat(payload: SendChatPayload): Promise<ChatMessage> {
    // editionId는 위젯이 항상 넘기지만, 없을 땐 특정 호수(907) 대신 존재하는 첫 호수로 폴백
    const editionId = payload.editionId ?? editions[0]?.id ?? 0;
    const ctx = {
      message: payload.message,
      editionId,
      page: payload.page,
      articleId: payload.articleId,
      history: payload.history,
      articles: chatArticles(),
      editions: chatEditionsOverride ?? getEditionSnapshots(),
      userRole: payload.userRole ?? MOCK_USER.role,
    };

    const orchestrated = orchestrateChat(ctx, isLlmProviderEnabled() ? "llm" : "rule");
    const llmPayload: SendChatPayload = {
      ...payload,
      llmContext: {
        toolsUsed: orchestrated.toolsUsed,
        toolResults: orchestrated.toolResults,
      },
    };

    const llmBody = isLlmProviderEnabled()
      ? await tryLlmChat(llmPayload, orchestrated)
      : null;

    if (!llmBody) {
      await delay(900 + Math.random() * 600);
    } else {
      await delay(200 + Math.random() * 300);
    }

    const body = llmBody ?? orchestrated.body;
    return { role: "ai", ...body, timestamp: new Date() };
  },
};

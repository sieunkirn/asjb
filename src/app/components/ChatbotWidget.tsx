import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, Copy, Maximize2, Minimize2, RotateCcw, Send, Sparkles, X } from "lucide-react";
import type { ChatAction, ChatHistoryTurn, ChatMessage, Page } from "../types";
import { articlesApi, chatApi } from "../api";
import { setChatDataSource } from "../api/mockStore";
import { reviewerName } from "../api/auth";
import { ARTICLES_FROM_DB } from "../api/scoringDb";
import { useApp } from "../context/AppContext";
import { buildSuggestedPrompts, parseArticleId } from "../lib/chatEngine";
import { ConfirmDialog } from "../components/common";
import { DARK_ICON_BTN_CLS } from "./ui/buttonStyles";

const INPUT_MAX_HEIGHT = 96;

function formatTime(d: Date) {
  return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

function resizeTextarea(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "auto";
  const next = Math.max(20, Math.min(el.scrollHeight, INPUT_MAX_HEIGHT));
  el.style.height = `${next}px`;
}

function actionTone(type: ChatAction["type"]): string {
  switch (type) {
    case "confirm_score":
      return "bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-600 hover:text-white";
    case "filter_dashboard":
    case "navigate_review_list":
      return "bg-violet-50 border-violet-200 text-violet-700 hover:bg-violet-600 hover:text-white";
    case "open_duplicate_compare":
      return "bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-600 hover:text-white";
    default:
      return "bg-accent border-brand/20 text-brand hover:bg-brand hover:text-white";
  }
}

function toHistoryTurns(messages: ChatMessage[]): ChatHistoryTurn[] {
  return messages.slice(-8).map(m => ({
    role: m.role,
    text: m.text,
    articleId: m.actions?.[0]?.articleId ?? parseArticleId(m.text) ?? undefined,
  }));
}

export function ChatbotWidget({
  onOpenReview,
  page,
  articleId,
}: {
  onOpenReview?: (id: string) => void;
  page: Page;
  articleId?: string | null;
}) {
  const {
    selectedEdition, articles, editions, navigate, user,
    setDashboardFilter, setReviewTab, refreshArticles,
  } = useApp();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [presetEdition, setPresetEdition] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<ChatAction | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const suggested = useMemo(
    () => buildSuggestedPrompts({
      editionId: selectedEdition,
      articleId: articleId ?? undefined,
      page,
      articles,
      editions,
    }),
    [selectedEdition, articleId, page, articles, editions],
  );

  // DB 모드: 챗봇 규칙 엔진이 화면과 같은 실제(DB) 기사·호수를 보도록 주입
  useEffect(() => {
    if (ARTICLES_FROM_DB) setChatDataSource(articles, editions);
  }, [articles, editions]);

  const buildOpening = useCallback((): ChatMessage[] => {
    return [{
      role: "ai",
      text: "안녕하세요, 사랑 AI 비서입니다! 😊",
      timestamp: new Date(),
    }];
  }, []);

  // 이전 대화는 저장하지 않는다. 페이지에 새로 들어오면 항상 인사말로 시작.
  // (세션 내 닫기→열기는 messages 상태가 유지되므로 대화가 이어짐)
  useEffect(() => {
    if (!open) return;
    if (presetEdition !== selectedEdition || !initialized) {
      setMessages(buildOpening());
      setInitialized(true);
      setPresetEdition(selectedEdition);
    }
  }, [open, initialized, selectedEdition, presetEdition, buildOpening]);

  useEffect(() => {
    resizeTextarea(inputRef.current);
  }, [input, open]);

  useEffect(() => {
    if (open) {
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
      inputRef.current?.focus();
    }
  }, [open, messages, expanded]);

  const handleInputChange = (value: string) => {
    setInput(value);
    requestAnimationFrame(() => resizeTextarea(inputRef.current));
  };

  const handleAction = useCallback((action: ChatAction) => {
    chatApi.logAction(action).catch(() => {});
    switch (action.type) {
      case "open_review":
      case "open_duplicate_compare":
        if (action.articleId) onOpenReview?.(action.articleId);
        break;
      case "filter_dashboard":
        setDashboardFilter(action.filterStatus ?? "재확인 필요");
        navigate("dashboard");
        break;
      case "navigate_review_list":
        setReviewTab("재확인 필요");
        navigate("review", null);
        break;
      case "confirm_score":
        setConfirmAction(action);
        break;
    }
  }, [navigate, onOpenReview, setDashboardFilter, setReviewTab]);

  const handleConfirmScore = async () => {
    if (!confirmAction?.articleId || confirmAction.suggestedScore == null) return;
    setConfirming(true);
    try {
      await articlesApi.confirm(confirmAction.articleId, {
        finalScore: confirmAction.suggestedScore,
        votes: [confirmAction.suggestedScore],
        reviewer: reviewerName(),
      });
      await refreshArticles();
      setMessages(m => [...m, {
        role: "ai",
        text: `**${confirmAction.articleId}** ${confirmAction.suggestedScore}점 승인이 완료되었습니다.`,
        timestamp: new Date(),
      }]);
      setConfirmAction(null);
    } catch {
      setError("승인 처리에 실패했습니다.");
    } finally {
      setConfirming(false);
    }
  };

  const send = useCallback(async (textOverride?: string) => {
    const text = (textOverride ?? input).trim();
    if (!text || typing) return;
    setInput("");
    requestAnimationFrame(() => resizeTextarea(inputRef.current));
    setError(null);
    const nextMessages: ChatMessage[] = [...messages, { role: "user", text, timestamp: new Date() }];
    setMessages(nextMessages);
    setTyping(true);
    try {
      const response = await chatApi.send({
        message: text,
        editionId: selectedEdition,
        page,
        articleId: articleId ?? undefined,
        // 현재 메시지는 message로 이미 보내므로 이력에선 제외 (이전 맥락만 전달)
        history: toHistoryTurns(messages),
        userRole: user?.role,
      });
      setMessages(m => [...m, response]);
    } catch {
      setError("응답을 받지 못했습니다. 다시 시도해 주세요.");
    } finally {
      setTyping(false);
    }
  }, [input, typing, messages, selectedEdition, page, articleId, user?.role]);

  const handleClear = () => {
    setError(null);
    setMessages(open ? buildOpening() : []);
    setInitialized(open);
    setPresetEdition(open ? selectedEdition : null);
  };

  const handleCopy = async (text: string, idx: number) => {
    try {
      await navigator.clipboard.writeText(text.replace(/\*\*/g, ""));
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 1500);
    } catch {
      // ignore
    }
  };

  const contextHint = useMemo(() => {
    const ed = editions.find(e => e.id === selectedEdition);
    const parts = [ed?.label ?? `${selectedEdition}호`];
    if (page === "review" && articleId) parts.push(articleId);
    return parts.join(" · ");
  }, [editions, selectedEdition, page, articleId]);

  const closeChat = () => {
    setOpen(false);
    setExpanded(false);
  };

  const panelClass = expanded
    ? "fixed bottom-20 sm:bottom-24 right-4 left-4 sm:left-auto sm:w-[440px] z-[60]"
    : "fixed bottom-[4.5rem] sm:bottom-24 right-4 sm:right-6 z-[60] w-[calc(100vw-2rem)] sm:w-[380px]";

  const panelMaxHeight = expanded
    ? "min(68vh, 600px)"
    : "min(520px, calc(100vh - 7rem))";

  return (
    <>
      {/* 확대 시 배경 터치 → 축소 */}
      {open && expanded && (
        <div
          className="fixed inset-0 z-[55] bg-black/20 touch-manipulation"
          aria-hidden
          onPointerDown={() => setExpanded(false)}
        />
      )}

      <button
        type="button"
        onClick={() => (open ? closeChat() : setOpen(true))}
        className="fixed bottom-5 sm:bottom-6 right-4 sm:right-6 z-[60] w-13 h-13 sm:w-14 sm:h-14 rounded-2xl bg-brand text-white shadow-xl shadow-brand/20 flex items-center justify-center hover:bg-brand-hover transition-all duration-150 hover:scale-105 hover:shadow-2xl active:scale-95 cursor-pointer"
        aria-label="AI 챗봇 열기"
      >
        {open ? (
          <X size={22} />
        ) : (
          <>
            {/* public/mascot.png 가 있으면 마스코트, 없으면 Bot 폴백 */}
            <Bot size={22} className="absolute" />
            <img
              src="/mascot.png"
              alt=""
              className="absolute inset-0 w-full h-full object-cover rounded-2xl"
              onError={e => { e.currentTarget.style.display = "none"; }}
            />
          </>
        )}
        {!open && (
          <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-emerald-500 rounded-full border-2 border-white z-10" />
        )}
      </button>

      {open && (
        <div
          className={`${panelClass} flex flex-col bg-card border border-border rounded-2xl shadow-2xl overflow-hidden transition-all duration-200`}
          style={{ maxHeight: panelMaxHeight, height: panelMaxHeight }}
          onPointerDown={e => e.stopPropagation()}
        >
          <div className="flex items-center gap-2 px-4 py-3.5 border-b border-border bg-[#2C1A0E]">
            <div className="w-9 h-9 rounded-xl bg-brand overflow-hidden flex items-center justify-center flex-shrink-0 relative">
              {/* public/mascot.png 가 있으면 마스코트, 없으면 Sparkles 폴백 */}
              <Sparkles size={15} className="text-white absolute" />
              <img
                src="/mascot.png"
                alt="사랑 AI 비서"
                className="w-full h-full object-cover relative"
                onError={e => { e.currentTarget.style.display = "none"; }}
              />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-[#F7EEE8]">사랑 AI 비서</div>
              <div className="text-[10px] text-[#F7EEE8]/50 truncate">
                {contextHint}
              </div>
            </div>
            <button type="button" onClick={handleClear} className={DARK_ICON_BTN_CLS} aria-label="대화 초기화">
              <RotateCcw size={14} />
            </button>
            <button
              type="button"
              onClick={() => setExpanded(e => !e)}
              className={`${DARK_ICON_BTN_CLS} ${expanded ? "bg-white/15 text-[#F7EEE8]" : ""}`}
              aria-label={expanded ? "축소" : "확대"}
              title={expanded ? "축소" : "확대"}
            >
              {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
            <button type="button" onClick={closeChat} className={DARK_ICON_BTN_CLS} aria-label="닫기">
              <X size={16} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4" style={{ minHeight: 0 }}>
            {!initialized && messages.length === 0 && (
              <div className="flex justify-center py-8">
                <div className="w-6 h-6 rounded-full border-2 border-brand/20 border-t-brand animate-spin" />
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"} gap-2`}>
                {msg.role === "ai" && (
                  <div className="w-7 h-7 rounded-xl bg-brand-light overflow-hidden flex items-center justify-center flex-shrink-0 mt-0.5 relative">
                    <Sparkles size={12} className="text-brand absolute" />
                    <img src="/mascot.png" alt="" className="absolute inset-0 w-full h-full object-cover" onError={e => { e.currentTarget.style.display = "none"; }} />
                  </div>
                )}
                <div className="max-w-[85%] space-y-2">
                  <div className={`rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed whitespace-pre-wrap break-words ${
                    msg.role === "user" ? "bg-brand text-white rounded-tr-md" : "bg-muted text-foreground rounded-tl-md"
                  }`}>
                    {msg.meta?.proactive && (
                      <span className="inline-block text-[9px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 mb-1">브리핑</span>
                    )}
                    {msg.text.split("**").map((part, pi) =>
                      pi % 2 === 1 ? <strong key={pi}>{part}</strong> : <span key={pi}>{part}</span>
                    )}
                  </div>
                  {msg.table && (
                    <div className="rounded-xl border border-border overflow-x-auto text-xs shadow-sm">
                      <table className="min-w-full border-collapse bg-muted/40">
                        <thead>
                          <tr className="border-b border-border">
                            {msg.table.headers.map(h => (
                              <th key={h} className="px-2.5 py-1.5 text-left font-semibold text-muted-foreground text-[10px] uppercase tracking-wide whitespace-nowrap">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {msg.table.rows.map((row, ri) => (
                            <tr key={ri} className={ri % 2 ? "bg-white" : ""}>
                              {row.map((cell, ci) => (
                                <td key={ci} className="px-2.5 py-1.5 text-[10px] text-foreground font-mono whitespace-nowrap">{cell}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {(msg.actions?.length || msg.links?.length) ? (
                    <div className="flex flex-wrap gap-1.5">
                      {msg.actions?.map(action => (
                        <button
                          key={action.id}
                          onClick={() => handleAction(action)}
                          className={`text-[10px] px-2.5 py-1 rounded-full border font-medium transition-colors ${actionTone(action.type)}`}
                        >
                          {action.label} →
                        </button>
                      ))}
                      {!msg.actions?.length && msg.links?.map(link => (
                        <button
                          key={link.id}
                          onClick={() => onOpenReview?.(link.id)}
                          className="text-[10px] px-2.5 py-1 rounded-full bg-accent border border-brand/20 text-brand font-medium hover:bg-brand hover:text-white transition-colors"
                        >
                          {link.label} →
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <div className={`flex items-center gap-2 ${msg.role === "user" ? "justify-end" : ""}`}>
                    {msg.role === "ai" && (
                      <button
                        type="button"
                        onClick={() => handleCopy(msg.text, i)}
                        className="text-[9px] text-muted-foreground/60 hover:text-muted-foreground flex items-center gap-0.5"
                      >
                        <Copy size={10} />
                        {copiedIdx === i ? "복사됨" : "복사"}
                      </button>
                    )}
                    <span className="text-[9px] text-muted-foreground/60">{formatTime(msg.timestamp)}</span>
                  </div>
                </div>
              </div>
            ))}
            {typing && (
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-xl bg-brand-light overflow-hidden flex items-center justify-center flex-shrink-0 relative">
                  <Sparkles size={12} className="text-brand absolute" />
                  <img src="/mascot.png" alt="" className="absolute inset-0 w-full h-full object-cover" onError={e => { e.currentTarget.style.display = "none"; }} />
                </div>
                <div className="bg-muted rounded-2xl rounded-tl-md px-3.5 py-2.5 flex items-center gap-1">
                  {[0, 1, 2].map(j => (
                    <span key={j} className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: `${j * 150}ms` }} />
                  ))}
                </div>
              </div>
            )}
            {error && <p className="text-xs text-red-600 text-center">{error}</p>}
            <div ref={bottomRef} />
          </div>

          <div className="flex-shrink-0 border-t border-border bg-card">
            {!typing && suggested.length > 0 && (
              <div className="px-3 pt-2 pb-1 flex items-center gap-1.5 overflow-x-auto scrollbar-none">
                {suggested.map(q => (
                  <button key={q} type="button" onClick={() => send(q)} className="flex-shrink-0 text-[10px] px-2.5 py-1 rounded-full border border-border text-muted-foreground hover:border-brand hover:text-brand hover:bg-accent/50 hover:scale-105 active:scale-95 transition-all duration-150 bg-background whitespace-nowrap cursor-pointer">
                    {q}
                  </button>
                ))}
              </div>
            )}

            <div className="p-3 pt-2">
              <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 min-h-[44px] py-2 shadow-sm focus-within:border-brand/40 focus-within:ring-2 focus-within:ring-brand/15 transition-shadow">
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => handleInputChange(e.target.value)}
                onKeyDown={e => {
                  // 한글 등 조합(IME) 입력 중의 Enter는 글자 확정용이므로 전송하지 않는다
                  if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                rows={1}
                placeholder="질문을 입력하세요."
                className="flex-1 bg-transparent text-sm leading-5 text-foreground placeholder:text-muted-foreground focus:outline-none min-w-0 resize-none overflow-y-auto py-0 px-0 border-0 align-middle"
                style={{ minHeight: "1.25rem", maxHeight: INPUT_MAX_HEIGHT }}
              />
              <button
                type="button"
                onClick={() => send()}
                disabled={!input.trim() || typing}
                aria-label="메시지 전송"
                className="w-8 h-8 rounded-lg bg-brand flex items-center justify-center disabled:opacity-40 hover:bg-brand-hover hover:scale-105 active:scale-95 transition-all duration-150 flex-shrink-0 cursor-pointer disabled:pointer-events-none"
              >
                <Send size={14} className="text-white" />
              </button>
            </div>
              <p className="mt-1.5 text-[10px] text-center text-muted-foreground/60">
                Enter 전송 · Shift+Enter 줄바꿈
              </p>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmAction !== null}
        title="AI 제안 점수로 승인할까요?"
        message={
          confirmAction && (
            <>
              <span className="font-medium">{confirmAction.articleId}</span> 기사를{" "}
              <span className="font-medium">{confirmAction.suggestedScore}점</span>으로 승인합니다.
            </>
          )
        }
        confirmLabel="승인"
        tone="primary"
        loading={confirming}
        onCancel={() => setConfirmAction(null)}
        onConfirm={handleConfirmScore}
      />
    </>
  );
}

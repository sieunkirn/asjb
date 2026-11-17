import { Activity, Bell, ChevronDown, ChevronRight, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AuditLogEntry, Edition } from "../types";
import { articlesApi, notificationsApi } from "../api";
import { useApp } from "../context/AppContext";
import { groupEditionsByMonthWeek } from "../lib/editionGrouping";
import { ICON_BTN_CLS, TOOLBAR_BTN_CLS } from "./ui/buttonStyles";

const ACTION_LABEL: Record<AuditLogEntry["action"], string> = {
  confirm: "점수 확정",
  "re-review": "재검수",
  exclude_duplicate: "중복 제외",
  upload: "업로드",
  relation_update: "관계 변경",
  chat_action: "챗봇",
};

export function TopBar({
  search,
  onSearchChange,
  showSearch = true,
  showEdition = true,
}: {
  search?: string;
  onSearchChange?: (v: string) => void;
  showSearch?: boolean;
  showEdition?: boolean;
}) {
  const { articles, editions, selectedEdition, setSelectedEdition, notifications, refreshNotifications, navigate, unreadCount } = useApp();
  const [editionOpen, setEditionOpen] = useState(false);
  // 플라이아웃(Cascading) 메뉴: 아코디언처럼 여러 항목이 동시에 펼쳐지는 게 아니라
  // 현재 hover/선택된 월 · 주차 딱 1개씩만 기억해서 그 옆(right)에 서브메뉴를 띄운다
  const [activeMonth, setActiveMonth] = useState<string | null>(null);
  const [notifOpen, setNotifOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [activityLogs, setActivityLogs] = useState<AuditLogEntry[]>([]);

  const currentEdition = editions.find(e => e.id === selectedEdition);
  const groups = useMemo(() => groupEditionsByMonthWeek(editions), [editions]);
  const anyPopupOpen = editionOpen || activityOpen || notifOpen;

  const closeAllPopups = useCallback(() => {
    setEditionOpen(false);
    setActivityOpen(false);
    setNotifOpen(false);
  }, []);

  // 마우스 오버 시 자동 열림 — 벗어나면 250ms 뒤 닫아 팝업으로 이동하는 중에 끊기지 않게 함.
  // 터치 기기는 pointerType 체크로 제외해 기존 탭(클릭) 동작과 충돌하지 않음.
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelScheduledClose = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const hoverOpen = useCallback((which: "edition" | "activity" | "notif") => (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    cancelScheduledClose();
    setEditionOpen(which === "edition");
    setActivityOpen(which === "activity");
    setNotifOpen(which === "notif");
  }, [cancelScheduledClose]);

  const scheduleClose = useCallback((e: React.PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    cancelScheduledClose();
    closeTimerRef.current = setTimeout(closeAllPopups, 250);
  }, [cancelScheduledClose, closeAllPopups]);

  useEffect(() => cancelScheduledClose, [cancelScheduledClose]);

  useEffect(() => {
    if (!activityOpen) return;
    articlesApi.getAuditLogs().then(all =>
      setActivityLogs(all.filter(l => l.action !== "chat_action").slice(0, 12)),
    );
  }, [activityOpen, articles]);

  // 메뉴를 열 때마다 현재 선택된 호수가 속한 월·주차를 미리 펼쳐서 보여준다.
  // (닫힐 때는 그대로 두었다가 다음에 열릴 때 다시 계산 — groups/selectedEdition을 의존성에 넣으면
  //  메뉴가 열려 있는 도중 배경 폴링으로 값이 바뀔 때마다 사용자가 보고 있던 서브메뉴가 리셋되므로 제외)
  useEffect(() => {
    if (!editionOpen) return;
    const group = groups.find(g => g.weeks.some(w => w.editions.some(e => e.id === selectedEdition))) ?? groups[0];
    setActiveMonth(group?.month ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editionOpen]);

  const selectEdition = (ed: Edition) => {
    setSelectedEdition(ed.id);
    setEditionOpen(false);
  };

  const handleNotifClick = async (id: string, articleId?: string) => {
    await notificationsApi.markRead(id);
    await refreshNotifications();
    setNotifOpen(false);
    if (articleId) navigate("review", articleId);
  };

  return (
    <header className="sticky top-0 z-20 flex-shrink-0 border-b border-border bg-card/95 backdrop-blur-md px-4 sm:px-6 py-3 relative">
      {/* 화면 아무 곳이나 터치/클릭 시 팝업 닫기 */}
      {anyPopupOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/5 touch-manipulation"
          aria-hidden
          onPointerDown={closeAllPopups}
        />
      )}

      <div className="flex items-center justify-between gap-4 w-full min-h-[40px]">
        <div className="flex items-center flex-shrink-0 relative z-50">
          {showEdition ? (
            <div className="relative" onPointerEnter={hoverOpen("edition")} onPointerLeave={scheduleClose}>
              <button
                type="button"
                onPointerDown={e => e.stopPropagation()}
                onClick={() => setEditionOpen(o => !o)}
                className={TOOLBAR_BTN_CLS}
              >
                <span className="text-brand font-semibold">{currentEdition?.label ?? `${selectedEdition}호`}</span>
                <span className="text-xs text-muted-foreground hidden sm:inline">
                  {currentEdition ? `${currentEdition.articleCount}건 · ${currentEdition.month}` : ""}
                </span>
                <ChevronDown size={14} className={`text-muted-foreground transition-transform ${editionOpen ? "rotate-180" : ""}`} />
              </button>
              {editionOpen && (
                // 1단계(월) 패널 — 세로로 안 늘어나게 스크롤/최대높이 없이, 대신 서브메뉴는 오른쪽으로 펼침
                <div
                  className="absolute left-0 mt-1.5 w-48 bg-card rounded-xl border border-border shadow-xl z-50 py-1"
                  onPointerDown={e => e.stopPropagation()}
                >
                  {groups.map(group => {
                    const monthActive = activeMonth === group.month;
                    return (
                      <div key={group.month} className="relative">
                        <button
                          type="button"
                          onPointerEnter={() => setActiveMonth(group.month)}
                          onClick={() => setActiveMonth(group.month)}
                          className={`w-full flex items-center justify-between gap-1.5 px-3 py-2 text-xs font-semibold text-left transition-colors ${monthActive ? "bg-accent text-brand" : "hover:bg-muted/60"}`}
                        >
                          {group.month}
                          <ChevronRight size={13} className={monthActive ? "text-brand" : "text-muted-foreground"} />
                        </button>

                        {/* 2단계(호수) 서브메뉴 — 주차 계층 없이 바로 호수 목록 (플라이아웃 유지) */}
                        {monthActive && (
                          <div className="absolute left-full -ml-px top-0 w-52 max-h-72 overflow-y-auto bg-card rounded-xl border border-border shadow-xl z-50 py-1">
                            {group.weeks.flatMap(w => w.editions).map(ed => (
                              <button
                                key={ed.id}
                                type="button"
                                onClick={() => selectEdition(ed)}
                                className={`w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors flex items-center justify-between ${selectedEdition === ed.id ? "bg-accent text-brand font-medium" : ""}`}
                              >
                                <span>{ed.label}</span>
                                <span className="text-[10px] text-muted-foreground">{ed.articleCount}건</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <div className="w-0" aria-hidden />
          )}
        </div>

        <div className="flex items-center gap-2 sm:gap-2.5 flex-shrink-0 relative z-50">
          <div className="relative" onPointerEnter={hoverOpen("activity")} onPointerLeave={scheduleClose}>
            <button
              type="button"
              onPointerDown={e => e.stopPropagation()}
              onClick={() => {
                setActivityOpen(o => !o);
                setNotifOpen(false);
              }}
              className={`${ICON_BTN_CLS} ${activityOpen ? "border-brand/40 bg-accent text-brand" : ""}`}
              aria-label="최근 활동"
            >
              <Activity size={18} />
            </button>
            {activityOpen && (
              <div
                className="absolute right-0 mt-1.5 w-80 max-w-[calc(100vw-2rem)] bg-card rounded-xl border border-border shadow-xl z-50 overflow-hidden"
                onPointerDown={e => e.stopPropagation()}
              >
                <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                  <span className="text-sm font-semibold">최근 활동</span>
                  <button
                    type="button"
                    onClick={closeAllPopups}
                    className="text-xs text-muted-foreground hover:text-brand transition-colors px-2 py-1 rounded-lg hover:bg-muted"
                  >
                    닫기
                  </button>
                </div>
                <div className="max-h-72 overflow-y-auto">
                  {activityLogs.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-8">활동 내역이 없습니다</p>
                  ) : activityLogs.map(log => {
                    const time = new Date(log.timestamp).toLocaleString("ko-KR", {
                      month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
                    });
                    const detail = log.detail.replace(/^챗봇 액션:\s*\w+\s*—\s*/, "챗봇: ");
                    return (
                      <div
                        key={log.id}
                        className="px-4 py-3 border-b border-border/50 hover:bg-muted/40 transition-colors"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-foreground">{ACTION_LABEL[log.action]}</span>
                          <span className="text-[10px] text-muted-foreground shrink-0">{time}</span>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{detail}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="relative" onPointerEnter={hoverOpen("notif")} onPointerLeave={scheduleClose}>
            <button
              type="button"
              onPointerDown={e => e.stopPropagation()}
              onClick={() => {
                setNotifOpen(o => !o);
                setActivityOpen(false);
              }}
              className={`${ICON_BTN_CLS} ${notifOpen ? "border-brand/40 bg-accent text-brand" : ""}`}
              aria-label="알림"
            >
              <Bell size={18} />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-brand text-white text-[10px] font-bold flex items-center justify-center">
                  {unreadCount}
                </span>
              )}
            </button>
            {notifOpen && (
              <div
                className="absolute right-0 mt-1.5 w-80 max-w-[calc(100vw-2rem)] bg-card rounded-xl border border-border shadow-xl z-50 overflow-hidden"
                onPointerDown={e => e.stopPropagation()}
              >
                <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                  <span className="text-sm font-semibold">알림</span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="text-xs text-brand hover:underline transition-colors"
                      onClick={async () => {
                        await notificationsApi.markAllRead();
                        await refreshNotifications();
                      }}
                    >
                      모두 읽음
                    </button>
                    <button
                      type="button"
                      onClick={closeAllPopups}
                      className="text-xs text-muted-foreground hover:text-brand transition-colors px-2 py-1 rounded-lg hover:bg-muted"
                    >
                      닫기
                    </button>
                  </div>
                </div>
                <div className="max-h-72 overflow-y-auto">
                  {notifications.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-8">알림이 없습니다</p>
                  ) : notifications.map(n => (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => handleNotifClick(n.id, n.articleId)}
                      className={`w-full text-left px-4 py-3 border-b border-border/50 hover:bg-muted/50 transition-colors ${!n.read ? "bg-accent/30" : ""}`}
                    >
                      <div className="flex items-center gap-2">
                        {!n.read && <span className="w-1.5 h-1.5 rounded-full bg-brand flex-shrink-0" />}
                        <span className="text-xs font-semibold text-foreground">{n.title}</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{n.message}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {showSearch && onSearchChange && (
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-2xl px-6 sm:px-10 lg:px-16 pointer-events-none hidden sm:block">
          <div className="relative pointer-events-auto">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input
              value={search ?? ""}
              onChange={e => onSearchChange(e.target.value)}
              placeholder="기사 ID, 작성자, 실천자 검색..."
              className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-border bg-background text-sm shadow-sm focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
            />
          </div>
        </div>
      )}

      {showSearch && onSearchChange && (
        <div className="sm:hidden mt-3 relative z-10">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            value={search ?? ""}
            onChange={e => onSearchChange(e.target.value)}
            placeholder="검색..."
            className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
          />
        </div>
      )}
    </header>
  );
}

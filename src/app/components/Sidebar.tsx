import { BookOpen, CloudUpload, FileSearch, Heart, LayoutDashboard, Users, X } from "lucide-react";
import type { Page } from "../types";
import { getAccessToken, logout, reviewerName } from "../api/auth";

const NAV: { id: Page; label: string; icon: React.ReactNode; badge?: string }[] = [
  { id: "dashboard", label: "메인 대시보드", icon: <LayoutDashboard size={17} /> },
  { id: "upload", label: "파일 업로드 · 분석", icon: <CloudUpload size={17} /> },
  { id: "review", label: "기사 검수", icon: <FileSearch size={17} /> },
  { id: "editions", label: "호수 관리", icon: <BookOpen size={17} /> },
  { id: "scores", label: "실천자 점수", icon: <Users size={17} /> },
];

export function Sidebar({
  page, setPage, open, onClose, pendingCount = 0,
}: {
  page: Page;
  setPage: (p: Page) => void;
  open: boolean;
  onClose: () => void;
  pendingCount?: number;
}) {
  return (
    <aside
      className={`fixed lg:static inset-y-0 left-0 z-40 w-60 flex-shrink-0 flex flex-col h-full transform transition-transform duration-200 ease-out ${open ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}
      style={{ background: "var(--sidebar)", color: "var(--sidebar-foreground)" }}
    >
      <div className="px-5 py-6 border-b flex items-center justify-between" style={{ borderColor: "var(--sidebar-border)" }}>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="flex items-center gap-2.5 text-left hover:opacity-90 hover:scale-[1.02] active:scale-[0.98] transition-all duration-150 cursor-pointer"
          title="새로고침"
        >
          <div className="w-8 h-8 rounded-lg bg-brand flex items-center justify-center shadow-sm">
            <Heart size={15} className="text-white fill-white" />
          </div>
          <div>
            <div className="text-sm font-semibold leading-tight">성심당</div>
            <div className="text-[10px] opacity-50 leading-tight tracking-wide">사랑기사 평가 시스템</div>
          </div>
        </button>
        <button onClick={onClose} className="lg:hidden p-1.5 rounded-md opacity-60 hover:opacity-100 hover:bg-white/10"><X size={18} /></button>
      </div>

      <nav className="flex-1 py-4 px-3 space-y-1">
        {NAV.map(item => {
          const active = page === item.id;
          const showBadge = item.id === "review" && pendingCount > 0;
          return (
            <button
              key={item.id}
              onClick={() => setPage(item.id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm transition-all duration-150 cursor-pointer hover:scale-[1.01] active:scale-[0.99] ${active ? "bg-brand text-white font-medium shadow-sm hover:shadow-md" : "opacity-65 hover:opacity-100 hover:bg-white/10"}`}
            >
              {item.icon}
              <span className="flex-1 text-left">{item.label}</span>
              {showBadge && (
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[20px] ${active ? "bg-white/25 text-white" : "bg-brand text-white"}`}>
                  {pendingCount}
                </span>
              )}
              {item.badge && !showBadge && (
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-brand/30 text-[#F7A07A] font-semibold">{item.badge}</span>
              )}
            </button>
          );
        })}
      </nav>

      {getAccessToken() && (
        <div className="px-5 py-3 border-t text-xs flex items-center justify-between gap-2" style={{ borderColor: "var(--sidebar-border)" }}>
          <span className="truncate opacity-70" title="로그인한 검수자">{reviewerName()}</span>
          <button type="button" onClick={logout} className="opacity-60 hover:opacity-100 underline underline-offset-2 flex-shrink-0">
            로그아웃
          </button>
        </div>
      )}

      <div className="px-5 py-4 border-t text-[11px] opacity-35" style={{ borderColor: "var(--sidebar-border)" }}>
        v1.2.0 · 2024 성심당
      </div>
    </aside>
  );
}

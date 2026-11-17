import { createContext, useContext } from "react";
import type { AuthStatus } from "../api/auth";
import type { Article, Edition, Notification, Page, Status, User } from "../types";

export interface AppContextValue {
  user: User | null;
  /** 로그인 상태 — 접속 코드가 필요한 서버에서 로그인 전이면 valid=false (데이터를 볼 수 없음) */
  auth: AuthStatus;
  /** 로그인 화면 열기 */
  openLogin: () => void;
  editions: Edition[];
  selectedEdition: number;
  setSelectedEdition: (id: number) => void;
  articles: Article[];
  setArticles: React.Dispatch<React.SetStateAction<Article[]>>;
  notifications: Notification[];
  refreshArticles: () => Promise<void>;
  refreshNotifications: () => Promise<void>;
  navigate: (page: Page, articleId?: string | null) => void;
  openReview: (id: string) => void;
  unreadCount: number;
  globalSearch: string;
  setGlobalSearch: (v: string) => void;
  dashboardFilter: Status | "전체";
  setDashboardFilter: (v: Status | "전체") => void;
  reviewTab: Status | "전체";
  setReviewTab: (v: Status | "전체") => void;
}

export const AppContext = createContext<AppContextValue | null>(null);

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}

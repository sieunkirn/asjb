import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Article, Notification, Page, User, Edition, Status } from "./types";
import {
  articlesApi, authApi, editionsApi, notificationsApi,
} from "./api";
import { AppContext } from "./context/AppContext";
import { useHashRoute } from "./hooks/useHashRoute";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { ChatbotWidget } from "./components/ChatbotWidget";
import { DashboardPage } from "./pages/DashboardPage";
import { UploadPage } from "./pages/UploadPage";
import { ReviewPage } from "./pages/ReviewPage";
import { PractitionerScorePage } from "./pages/PractitionerScorePage";
import { EditionPage } from "./pages/EditionPage";
import { reconcileSelectedEdition } from "./lib/editionUtils";
import { filterArticles } from "./lib/articleFilters";
import { SearchFeedbackBar, type SearchFeedback } from "./components/SearchFeedbackBar";
import { LoadingState } from "./components/ui/Feedback";
import { LoginPage } from "./components/LoginPage";
import { AUTH_REQUIRED_EVENT, getAuthStatus, type AuthStatus } from "./api/auth";

export default function App() {
  const { route, navigate } = useHashRoute();
  const [articles, setArticles] = useState<Article[]>([]);
  const [editions, setEditions] = useState<Edition[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [selectedEdition, setSelectedEdition] = useState(907);
  const [selectedId, setSelectedId] = useState<string | null>(route.articleId);
  const [initialLoading, setInitialLoading] = useState(true);
  // 로그인 상태. 접속 코드가 필요한 서버에서 로그인 전이면 홈 화면은 열되 데이터는 비어 있고,
  // 사이드바의 [로그인] 버튼으로 로그인 화면(loginOpen)에 들어간다.
  const [auth, setAuth] = useState<AuthStatus>({ required: false, valid: true });
  const [loginOpen, setLoginOpen] = useState(false);
  const authRef = useRef(auth);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [globalSearch, setGlobalSearch] = useState("");
  const [dashboardFilter, setDashboardFilter] = useState<Status | "전체">("전체");
  const [reviewTab, setReviewTab] = useState<Status | "전체">("재확인 필요");
  const selectedEditionRef = useRef(selectedEdition);
  const articlesInitializedRef = useRef(false);

  const page = route.page;

  useEffect(() => {
    setSelectedId(route.articleId);
  }, [route.articleId]);

  const loadCoreData = useCallback(async () => {
    setLoadError(null);
    try {
      const [editionList, userData, notifList] = await Promise.all([
        editionsApi.list(),
        authApi.me(),
        notificationsApi.list(),
      ]);
      // 전체 기사 대신 "선택된 호수"의 기사만 불러온다 — 데이터가 쌓여도 첫 로딩이 느려지지 않게
      const edition = reconcileSelectedEdition(editionList, selectedEditionRef.current);
      const articleList = await articlesApi.list(edition);
      setArticles(articleList);
      setEditions(editionList);
      setSelectedEdition(edition);
      setUser(userData);
      setNotifications(notifList);
      articlesInitializedRef.current = true;
    } catch {
      setLoadError("초기 데이터를 불러오지 못했습니다.");
    } finally {
      setInitialLoading(false);
    }
  }, []);

  // 로그인 전(접속 코드 필요): 서버 데이터는 건너뛰고 빈 홈 화면을 연다
  const loadGuestData = useCallback(async () => {
    try {
      const [userData, notifList] = await Promise.all([authApi.me(), notificationsApi.list()]);
      setUser(userData);
      setNotifications(notifList);
    } catch {
      /* 화면은 그대로 연다 */
    }
    setArticles([]);
    setEditions([]);
    articlesInitializedRef.current = false;
    setLoadError(null);
    setInitialLoading(false);
  }, []);

  useEffect(() => {
    authRef.current = auth;
  }, [auth]);

  useEffect(() => {
    let cancelled = false;
    getAuthStatus().then(status => {
      if (cancelled) return;
      setAuth(status);
      void (status.valid ? loadCoreData() : loadGuestData());
    });
    return () => { cancelled = true; };
  }, [loadCoreData, loadGuestData]);

  // 로그아웃하거나 접속 코드가 바뀌어(401) 로그인 상태가 달라지면 다시 확인한다
  useEffect(() => {
    const onAuthChanged = () => {
      if (authRef.current.required && !authRef.current.valid) return; // 이미 로그인 전 상태
      void getAuthStatus().then(status => {
        setAuth(status);
        if (!status.valid) void loadGuestData();
      });
    };
    window.addEventListener(AUTH_REQUIRED_EVENT, onAuthChanged);
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, onAuthChanged);
  }, [loadGuestData]);

  // 호수를 바꾸면 해당 호수의 기사를 다시 불러온다
  useEffect(() => {
    selectedEditionRef.current = selectedEdition;
    if (!articlesInitializedRef.current) return;
    let cancelled = false;
    articlesApi.list(selectedEdition)
      .then(list => { if (!cancelled) setArticles(list); })
      .catch(() => { /* 연결 오류는 대시보드 배너가 안내 */ });
    return () => { cancelled = true; };
  }, [selectedEdition]);

  const refreshSeq = useRef(0);

  const refreshArticles = useCallback(async () => {
    const seq = ++refreshSeq.current;
    const requestedEdition = selectedEditionRef.current;
    const [list, edList, notifs] = await Promise.all([
      articlesApi.list(requestedEdition),
      editionsApi.list(),
      notificationsApi.list(),
    ]);
    // 응답을 기다리는 동안 호수를 바꾸었거나 더 새로운 새로고침이 시작됐다면 이 응답은 버린다
    if (seq !== refreshSeq.current || requestedEdition !== selectedEditionRef.current) return;
    setArticles(list);
    setEditions(edList);
    setSelectedEdition(prev => reconcileSelectedEdition(edList, prev));
    setNotifications(notifs);
  }, []);

  // 다른 호수의 기사로 바로 가는 링크(#/review/1810-1, "회차 간 이력")는
  // 선택된 호수의 목록에 없으므로, 그 기사가 속한 호수로 전환해 준다
  useEffect(() => {
    if (!selectedId || !articlesInitializedRef.current) return;
    if (articles.some(a => a.id === selectedId)) return;
    let cancelled = false;
    articlesApi.get(selectedId)
      .then(found => {
        if (!cancelled && found && found.edition !== selectedEditionRef.current) {
          setSelectedEdition(found.edition);
        }
      })
      .catch(() => { /* 없는 기사면 목록에 그대로 둔다 */ });
    return () => { cancelled = true; };
  }, [selectedId, articles]);

  const refreshNotifications = useCallback(async () => {
    setNotifications(await notificationsApi.list());
  }, []);

  const goPage = useCallback((p: Page) => {
    navigate(p, p === "review" ? selectedId : null);
    setSidebarOpen(false);
  }, [navigate, selectedId]);

  const openReview = useCallback((id: string) => {
    setSelectedId(id);
    navigate("review", id);
    setSidebarOpen(false);
  }, [navigate]);

  const unreadCount = useMemo(() => notifications.filter(n => !n.read).length, [notifications]);
  const pendingCount = useMemo(
    () => articles.filter(a => a.edition === selectedEdition && a.status === "재확인 필요").length,
    [articles, selectedEdition],
  );

  const openLogin = useCallback(() => setLoginOpen(true), []);

  const contextValue = useMemo(() => ({
    user, auth, openLogin, editions, selectedEdition, setSelectedEdition,
    articles, setArticles, notifications,
    refreshArticles, refreshNotifications,
    navigate, openReview, unreadCount,
    globalSearch, setGlobalSearch,
    dashboardFilter, setDashboardFilter,
    reviewTab, setReviewTab,
  }), [user, auth, openLogin, editions, selectedEdition, articles, notifications, refreshArticles, refreshNotifications, navigate, openReview, unreadCount, globalSearch, dashboardFilter, reviewTab]);

  const searchApplicable = page === "dashboard" || page === "upload" || (page === "review" && !selectedId);

  const searchFeedback = useMemo((): SearchFeedback | null => {
    const q = globalSearch.trim();
    if (!q) return null;

    if (page === "dashboard" || (page === "review" && !selectedId)) {
      const editionArticles = articles.filter(a => a.edition === selectedEdition);
      const matched = filterArticles(editionArticles, { search: q });
      return { count: matched.length, total: editionArticles.length, entityLabel: "기사", applicable: true };
    }
    return {
      count: 0,
      total: 0,
      entityLabel: "",
      applicable: false,
      hint: "검색은 대시보드 · 기사 검수에서 적용됩니다",
    };
  }, [globalSearch, page, selectedId, articles, selectedEdition]);

  if (loginOpen) {
    return (
      <LoginPage
        required={auth.required}
        onCancel={() => setLoginOpen(false)}
        onLoggedIn={() => {
          setLoginOpen(false);
          setLoadError(null);
          setInitialLoading(true);
          void getAuthStatus().then(status => {
            setAuth(status);
            void (status.valid ? loadCoreData() : loadGuestData());
          });
        }}
      />
    );
  }

  if (initialLoading) {
    return (
      <div className="flex h-screen bg-background items-center justify-center">
        <LoadingState message="사랑기사 평가 시스템을 준비하는 중..." />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex h-screen bg-background items-center justify-center p-6">
        <div className="text-center max-w-sm">
          <p className="text-sm text-red-700 mb-4">{loadError}</p>
          <button onClick={() => { setInitialLoading(true); loadCoreData(); }} className="px-4 py-2 rounded-xl bg-brand text-white text-sm font-medium hover:bg-brand-hover">
            다시 시도
          </button>
        </div>
      </div>
    );
  }

  return (
    <AppContext.Provider value={contextValue}>
      <div className="flex h-screen bg-background font-['Noto_Sans_KR',sans-serif] overflow-hidden">
        <Sidebar page={page} setPage={goPage} open={sidebarOpen} onClose={() => setSidebarOpen(false)} pendingCount={pendingCount} auth={auth} onLogin={openLogin} />
        {sidebarOpen && <div className="fixed inset-0 bg-black/40 z-30 lg:hidden" onClick={() => setSidebarOpen(false)} aria-hidden />}

        <main className="flex-1 flex flex-col overflow-hidden relative min-w-0">
          <div className="lg:hidden flex items-center gap-3 px-4 py-3 border-b border-border bg-card flex-shrink-0">
            <button onClick={() => setSidebarOpen(true)} className="p-2 rounded-lg hover:bg-muted" aria-label="메뉴">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
            </button>
            <span className="text-sm font-semibold">성심당 사랑기사 평가</span>
          </div>

          <TopBar
            search={globalSearch}
            onSearchChange={setGlobalSearch}
            showSearch={searchApplicable}
            showEdition
          />
          {searchFeedback && (
            <SearchFeedbackBar
              query={globalSearch}
              feedback={searchFeedback}
              onClear={() => setGlobalSearch("")}
            />
          )}

          {page === "dashboard" && (
            <DashboardPage onOpen={openReview} setPage={goPage} />
          )}
          {page === "upload" && <UploadPage />}
          {page === "review" && (
            <ReviewPage
              selectedId={selectedId}
              setSelectedId={(id) => { setSelectedId(id); navigate("review", id); }}
              onBackToList={() => navigate("review", null)}
            />
          )}
          {page === "scores" && <PractitionerScorePage />}
          {page === "editions" && <EditionPage />}
          <ChatbotWidget onOpenReview={openReview} page={page} articleId={selectedId} />
        </main>
      </div>
    </AppContext.Provider>
  );
}

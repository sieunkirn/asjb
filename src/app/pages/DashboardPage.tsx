import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle, Building2, ChevronDown, ChevronLeft, ChevronRight, ChevronsUpDown, ChevronUp,
  Download, Eye, FilePlus2, Filter, Pencil, Star, CheckCircle2, Clock, Ban,
} from "lucide-react";
import type { Article, Page, Status } from "../types";
import { useApp } from "../context/AppContext";
import { filterArticles, countByStatus, getDepartments } from "../lib/articleFilters";
import { useScrollToResults } from "../hooks/useScrollToResults";
import { exportArticlesToExcel } from "../utils";
import { ScoreDots, StatusTag } from "../components/common";
import { PageHeader, StatCard } from "../components/ui/PageHeader";
import { Button } from "../components/ui/Button";
import { DropdownSelect } from "../components/ui/DropdownSelect";
import { Card } from "../components/ui/Card";
import { DataTable, TH_CLS } from "../components/ui/DataTable";
import { EmptyState, ErrorBanner } from "../components/ui/Feedback";
import { scoringApi } from "../api/scoring";
import { ARTICLES_FROM_DB, isDbUnavailable } from "../api/scoringDb";

const STATUSES = ["전체", "승인", "재확인 필요", "중복 제외"] as const;

/** 기사 테이블 페이지당 표시 건수 */
const PAGE_SIZE = 10;

type SortKey = "id" | "author" | "subject" | "department" | "aiScore" | "finalScore" | "status" | "date";

/** 컬럼 정의 — key가 null이면 정렬 미지원(버튼 컬럼) */
const SORT_COLUMNS: { key: SortKey | null; label: string }[] = [
  { key: "id", label: "ID" },
  { key: "author", label: "작성자" },
  { key: "subject", label: "실천자" },
  { key: "department", label: "부서" },
  { key: "aiScore", label: "AI" },
  { key: "finalScore", label: "최종" },
  { key: "status", label: "상태" },
  { key: "date", label: "날짜" },
  { key: null, label: "" },
];

const STATUS_ORDER: Record<Status, number> = { "재확인 필요": 0, "승인": 1, "중복 제외": 2 };

function compareArticles(a: Article, b: Article, key: SortKey): number {
  switch (key) {
    case "id": {
      const pa = a.id.split("-").map(Number);
      const pb = b.id.split("-").map(Number);
      return (pa[0] - pb[0]) || ((pa[1] ?? 0) - (pb[1] ?? 0));
    }
    case "aiScore":
      return a.aiScore - b.aiScore;
    case "finalScore":
      return (a.finalScore ?? -1) - (b.finalScore ?? -1);
    case "status":
      return STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    case "date":
      return (a.date || "").localeCompare(b.date || "");
    default:
      return String(a[key] ?? "").localeCompare(String(b[key] ?? ""), "ko");
  }
}

export function DashboardPage({
  onOpen,
  setPage,
}: {
  onOpen: (id: string) => void;
  setPage: (p: Page) => void;
}) {
  const { auth, openLogin, articles, selectedEdition, editions, globalSearch, dashboardFilter, setDashboardFilter, setReviewTab, navigate, refreshArticles } = useApp();
  const [filterStatus, setFilterStatus] = useState<string>(dashboardFilter);
  const [department, setDepartment] = useState("전체");
  const [tablePage, setTablePage] = useState(1);
  // DB 모드에서 분석 서버가 꺼져 있으면 빈 화면 대신 안내 배너를 띄운다
  const [serverDown, setServerDown] = useState(false);
  // 컬럼 헤더 클릭 정렬 (같은 컬럼 재클릭 시 오름차순 ↔ 내림차순)
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // 점수 컬럼은 높은 값부터 보는 게 자연스러워 내림차순으로 시작 (팀 개선 반영)
      setSortDir(key === "aiScore" || key === "finalScore" ? "desc" : "asc");
    }
    setTablePage(1);
  };

  const editionArticles = useMemo(
    () => articles.filter(a => a.edition === selectedEdition),
    [articles, selectedEdition],
  );

  const filtered = useMemo(
    () => filterArticles(editionArticles, {
      status: filterStatus as Status | "전체",
      department,
      search: globalSearch,
    }),
    [editionArticles, filterStatus, department, globalSearch],
  );

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      // 최종 점수 미확정(undefined)은 정렬 방향과 무관하게 항상 뒤로 (팀 개선 반영)
      if (sortKey === "finalScore") {
        const av = a.finalScore ?? (sortDir === "asc" ? Infinity : -Infinity);
        const bv = b.finalScore ?? (sortDir === "asc" ? Infinity : -Infinity);
        return (av - bv) * dir;
      }
      return compareArticles(a, b, sortKey) * dir;
    });
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const paged = useMemo(
    () => sorted.slice((tablePage - 1) * PAGE_SIZE, tablePage * PAGE_SIZE),
    [sorted, tablePage],
  );

  useEffect(() => {
    setTablePage(1);
  }, [filterStatus, department, globalSearch, selectedEdition]);

  useEffect(() => {
    if (tablePage > totalPages) setTablePage(totalPages);
  }, [tablePage, totalPages]);

  const departments = useMemo(() => getDepartments(editionArticles), [editionArticles]);
  const pending = countByStatus(editionArticles, "재확인 필요");
  const editionLabel = editions.find(e => e.id === selectedEdition)?.label ?? `${selectedEdition}호`;
  const isSearching = globalSearch.trim().length > 0;
  const resultsRef = useScrollToResults(globalSearch, isSearching);

  useEffect(() => {
    setFilterStatus(dashboardFilter);
  }, [dashboardFilter]);

  // 서버는 켜져 있는데 DB에 연결되지 않은 상태 (DATABASE_URL 미설정 등)
  const [dbDown, setDbDown] = useState(() => ARTICLES_FROM_DB && isDbUnavailable());

  useEffect(() => {
    if (ARTICLES_FROM_DB) {
      scoringApi.health().then(ok => setServerDown(!ok)).catch(() => setServerDown(true));
      setDbDown(isDbUnavailable());
    }
  }, []);

  const retryConnect = async () => {
    const ok = await scoringApi.health();
    setServerDown(!ok);
    if (ok) await refreshArticles();
    setDbDown(isDbUnavailable());
  };

  /** 상단 통계 카드 클릭 → 기사 검수의 해당 상태 탭으로 이동 */
  const goReview = (tab: Status | "전체") => {
    setReviewTab(tab);
    navigate("review", null);
  };

  return (
    <div className="flex-1 overflow-auto">
      <div className={`page-container ${isSearching ? "max-w-none" : ""}`}>
        {!isSearching && (
          <PageHeader
            title="메인 대시보드"
            description={`AI 분류 결과 검수 현황 — ${editionLabel}`}
          />
        )}

        {!isSearching && auth.required && !auth.valid && (
          <div className="mb-6 rounded-2xl border border-brand/30 bg-accent/40 px-4 py-3 text-sm text-foreground flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <p>
              <b>로그인하면</b> 기사와 점수가 표시됩니다. 접속 코드는 관리자에게 받아 주세요.
            </p>
            <Button size="sm" onClick={openLogin} className="flex-shrink-0">로그인</Button>
          </div>
        )}

        {!isSearching && serverDown && (
          <div className="mb-6">
            <ErrorBanner
              message="분석 서버(SSD_Scoring)에 연결할 수 없어 기사가 표시되지 않습니다. ‘사랑기사_시스템_시작.bat’을 실행(또는 서버 상태 확인) 후 [다시 시도]를 눌러 주세요."
              onRetry={() => void retryConnect()}
            />
          </div>
        )}

        {!isSearching && !serverDown && auth.valid && dbDown && (
          <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <p>
              서버는 켜져 있지만 <b>DB에 연결되지 않아</b> 기사가 표시되지 않습니다.
              DB 주소(DATABASE_URL)와 OpenAI 키가 입력됐는지 확인해 주세요.
              ‘파일 업로드 · 분석’ 탭 맨 위의 <b>백엔드 설정</b>에서 입력할 수 있습니다.
            </p>
            <div className="flex gap-2 flex-shrink-0">
              <Button size="sm" onClick={() => setPage("upload")}>설정 열기</Button>
              <Button size="sm" variant="ghost" onClick={() => void retryConnect()}>다시 시도</Button>
            </div>
          </div>
        )}

        {!isSearching && (
          <>
            <Card padding="md" hover onClick={() => setPage("upload")} className="mb-6 border-dashed border-brand/25 bg-accent/30">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-brand-light flex items-center justify-center">
                    <FilePlus2 size={18} className="text-brand" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-brand">새 신문 파일 업로드</div>
                    <div className="text-xs text-muted-foreground mt-0.5">PDF 업로드 시 AI가 자동으로 기사를 추출합니다</div>
                  </div>
                </div>
                <span className="text-xs text-brand font-medium">파일 업로드 →</span>
              </div>
            </Card>

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
              <StatCard label="전체 기사" value={editionArticles.length} sub={`${editionLabel} 제출`} icon={FilePlus2} onClick={() => goReview("전체")} />
              <StatCard label="처리 완료" value={countByStatus(editionArticles, "승인")} sub="승인 처리" tone="success" icon={CheckCircle2} onClick={() => goReview("승인")} />
              <StatCard label="재확인" value={pending} sub="검수 대기" tone="warning" icon={Clock} onClick={() => goReview("재확인 필요")} />
              <StatCard label="중복 제외" value={countByStatus(editionArticles, "중복 제외")} sub="중복 감지" tone="muted" icon={Ban} onClick={() => goReview("중복 제외")} />
            </div>
          </>
        )}

        <Card padding="md" className={isSearching ? "ring-2 ring-brand/20" : ""}>
          <div ref={resultsRef} className="scroll-mt-4">
            {!isSearching && pending > 0 && (
              <div className="mb-4 flex items-start gap-2.5 p-3 rounded-xl border border-amber-200/80 bg-amber-50/80 text-amber-800">
                <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
                <p className="text-xs leading-relaxed">
                  <span className="font-semibold">{pending}건</span> 검수 대기 — 사이드바 <strong>기사 검수</strong>에서 처리하세요.
                </p>
              </div>
            )}

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Filter size={14} />
                <span className={isSearching ? "text-base font-medium text-foreground" : ""}>{filtered.length}건 표시</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <DropdownSelect
                  value={department}
                  onChange={setDepartment}
                  options={[
                    { value: "전체", label: "전체 부서" },
                    ...departments.map(d => ({ value: d, label: d })),
                  ]}
                />
                <Button
                  variant="excel"
                  size="sm"
                  icon={Download}
                  onClick={() => void exportArticlesToExcel(filtered, filterStatus, editionLabel)}
                >
                  엑셀
                </Button>
                <DropdownSelect
                  value={filterStatus}
                  onChange={v => {
                    setFilterStatus(v);
                    setDashboardFilter(v as Status | "전체");
                  }}
                  options={STATUSES.map(s => ({ value: s, label: s }))}
                  align="right"
                />
              </div>
            </div>

            {filtered.length === 0 ? (
              <EmptyState
                icon={Filter}
                title={isSearching ? "검색 결과가 없습니다" : "표시할 기사 없음"}
                description={isSearching ? "다른 검색어를 입력하거나 필터를 변경해 보세요." : undefined}
                actionLabel={isSearching ? undefined : "업로드"}
                onAction={isSearching ? undefined : () => setPage("upload")}
              />
            ) : (
              <DataTable className={`[&_table]:min-w-[760px] ${isSearching ? "[&_td]:py-4 [&_th]:py-3 [&_td]:text-sm" : ""}`}>
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    {SORT_COLUMNS.map(col => (
                      <th key={col.label || "actions"} className={TH_CLS}>
                        {col.key ? (
                          <button
                            type="button"
                            onClick={() => handleSort(col.key!)}
                            className={`inline-flex items-center gap-1 uppercase tracking-wider cursor-pointer hover:text-brand transition-colors ${sortKey === col.key ? "text-brand" : ""}`}
                            title="클릭하여 정렬 (다시 클릭 시 역순)"
                          >
                            {col.label}
                            {sortKey === col.key
                              ? (sortDir === "asc" ? <ChevronUp size={12} /> : <ChevronDown size={12} />)
                              : <ChevronsUpDown size={11} className="opacity-35" />}
                          </button>
                        ) : col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {paged.map((a, idx) => (
                    <tr key={a.id} className={`hover:bg-accent/30 transition-colors ${idx % 2 ? "bg-muted/10" : ""}`}>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground whitespace-nowrap">{a.id}</td>
                      <td className="px-4 py-3 font-medium">
                        <div className="max-w-[10rem] truncate" title={a.author}>{a.author}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="max-w-[14rem] truncate" title={a.subject}>{a.subject}</div>
                      </td>
                      <td className="px-4 py-3"><span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Building2 size={11} />{a.department}</span></td>
                      <td className="px-4 py-3"><ScoreDots score={a.aiScore} /></td>
                      <td className="px-4 py-3">
                        {a.status === "중복 제외" ? <span className="text-xs text-muted-foreground">제외</span>
                          : a.finalScore != null ? <span className="inline-flex items-center gap-1 font-mono font-semibold text-brand"><Star size={11} className="fill-brand text-brand" />{a.finalScore.toFixed(1)}</span>
                          : <span className="text-xs text-muted-foreground">미확정</span>}
                      </td>
                      <td className="px-4 py-3"><StatusTag status={a.status} /></td>
                      <td className="px-4 py-3 text-xs font-mono text-muted-foreground">{a.date}</td>
                      <td className="px-4 py-3">
                        <Button variant={a.status === "재확인 필요" ? "secondary" : "ghost"} size="sm" icon={a.status === "승인" ? Pencil : Eye} onClick={() => onOpen(a.id)}
                          className={a.status === "재확인 필요" ? "border-amber-200 text-amber-700" : ""}>
                          {a.status === "재확인 필요" ? "검수" : a.status === "승인" ? "재검수" : "보기"}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            )}

            {sorted.length > PAGE_SIZE && (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mt-4">
                <span className="text-xs text-muted-foreground font-mono tabular-nums">
                  {(tablePage - 1) * PAGE_SIZE + 1}–{Math.min(tablePage * PAGE_SIZE, sorted.length)} / {sorted.length}건
                </span>
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={ChevronLeft}
                    disabled={tablePage === 1}
                    onClick={() => setTablePage(p => Math.max(1, p - 1))}
                  >
                    이전
                  </Button>
                  <span className="text-xs font-mono tabular-nums text-muted-foreground px-2">
                    {tablePage} / {totalPages}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={ChevronRight}
                    disabled={tablePage === totalPages}
                    onClick={() => setTablePage(p => Math.min(totalPages, p + 1))}
                  >
                    다음
                  </Button>
                </div>
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

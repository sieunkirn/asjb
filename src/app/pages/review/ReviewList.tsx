import { useEffect, useState } from "react";
import {
  Building2, CheckCircle2, ChevronLeft, ChevronRight,
  Inbox } from "lucide-react";
import type { Status } from "../../types";
import { useApp } from "../../context/AppContext";
import { filterArticles, sortArticles } from "../../lib/articleFilters";
import { useScrollToResults } from "../../hooks/useScrollToResults";
import { ConfirmDialog, ScoreDots, StatusTag } from "../../components/common";
import { reviewerName } from "../../api/auth";
import { ARTICLES_FROM_DB, scoringDb } from "../../api/scoringDb";
import { ScoreTypeGuide } from "../../components/ScoreTypeGuide";
import { PageHeader } from "../../components/ui/PageHeader";
import { Tabs, DataTable, TH_CLS } from "../../components/ui/DataTable";
import { DropdownSelect } from "../../components/ui/DropdownSelect";
import { EmptyState } from "../../components/ui/Feedback";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";

export type TabId = Status | "전체";
const TABS: Status[] = ["재확인 필요", "승인", "중복 제외"];

/** 검수 목록 페이지당 표시 건수 */
const PAGE_SIZE = 10;

type SortBy = "priority" | "subject" | "score-desc" | "score-asc" | "date";

export function ReviewList({ articles, onOpen }: { articles: import("../../types").Article[]; onOpen: (id: string) => void }) {
  const { globalSearch, reviewTab, setReviewTab, selectedEdition, refreshArticles } = useApp();
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>(reviewTab);
  const [sortBy, setSortBy] = useState<SortBy>("priority");
  const [tablePage, setTablePage] = useState(1);
  const isSearching = globalSearch.trim().length > 0;
  const resultsRef = useScrollToResults(globalSearch, isSearching);

  useEffect(() => {
    setTab(reviewTab);
  }, [reviewTab]);

  const tabFiltered = tab === "전체" ? articles : articles.filter(a => a.status === tab);
  const list = sortArticles(filterArticles(tabFiltered, { search: globalSearch }), sortBy);
  const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const paged = list.slice((tablePage - 1) * PAGE_SIZE, tablePage * PAGE_SIZE);

  useEffect(() => {
    setTablePage(1);
  }, [tab, sortBy, globalSearch]);

  useEffect(() => {
    if (tablePage > totalPages) setTablePage(totalPages);
  }, [tablePage, totalPages]);
  const needsCount = articles.filter(a => a.status === "재확인 필요").length;
  const unconfirmedApproved = articles.filter(a => a.status === "승인" && a.finalScore == null).length;

  const runBulkConfirm = async () => {
    setBulkBusy(true);
    setBulkMsg(null);
    try {
      const res = await scoringDb.bulkConfirm(selectedEdition, reviewerName());
      await refreshArticles();
      setBulkMsg(`승인 상태 ${res.confirmed}건을 AI 점수 그대로 최종 확정했습니다.`);
    } catch (e) {
      setBulkMsg(e instanceof Error ? e.message : "일괄 확정에 실패했습니다.");
    } finally {
      setBulkBusy(false);
      setBulkOpen(false);
    }
  };
  const tabs = [...TABS.map(t => ({ id: t as TabId, label: t, count: articles.filter(a => a.status === t).length })), { id: "전체" as TabId, label: "전체", count: articles.length }];

  return (
    <div className="flex-1 overflow-auto">
      <div className="page-container max-w-5xl">
        <PageHeader title="기사 검수" description={`재확인 필요 ${needsCount}건`} />
        <div className="mb-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <Tabs tabs={tabs} active={tab} onChange={t => { setTab(t); setReviewTab(t); }} />
          <div className="flex flex-wrap items-center gap-2">
          {ARTICLES_FROM_DB && tab === "승인" && unconfirmedApproved > 0 && (
            <Button size="sm" variant="secondary" icon={CheckCircle2} disabled={bulkBusy} loading={bulkBusy} onClick={() => setBulkOpen(true)}>
              AI 점수대로 일괄 확정 ({unconfirmedApproved}건)
            </Button>
          )}
          <DropdownSelect
            value={sortBy}
            onChange={v => setSortBy(v as SortBy)}
            align="right"
            options={[
              { value: "priority", label: "우선순위순" },
              { value: "subject", label: "실천자순" },
              { value: "score-desc", label: "AI 점수 높은순" },
              { value: "score-asc", label: "AI 점수 낮은순" },
              { value: "date", label: "날짜순" },
            ]}
          />
          </div>
        </div>
        {bulkMsg && (
          <p className="mb-4 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">{bulkMsg}</p>
        )}
        <div ref={resultsRef} className="scroll-mt-4">
        {list.length === 0 ? (
          <Card padding="none">
            <EmptyState
              icon={Inbox}
              title={isSearching ? "검색 결과가 없습니다" : "해당 상태의 기사가 없습니다"}
              description={isSearching ? "다른 검색어를 입력하거나 탭을 변경해 보세요." : undefined}
            />
          </Card>
        ) : (
          <DataTable>
            <thead><tr className="border-b bg-muted/30">
              {["작성자", "실천자", "부서", "AI", "상태", ""].map(h => <th key={h || "x"} className={TH_CLS}>{h}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-border">
              {paged.map((a, idx) => (
                <tr
                  key={a.id}
                  onClick={() => onOpen(a.id)}
                  tabIndex={0}
                  onKeyDown={e => {
                    if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                      e.preventDefault();
                      onOpen(a.id);
                    }
                  }}
                  aria-label={`기사 ${a.id} 열기`}
                  className={`cursor-pointer hover:bg-accent/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 ${idx % 2 ? "bg-muted/10" : ""}`}
                >
                  <td className="px-4 py-3.5">
                    <div className="max-w-[10rem] truncate" title={a.author}>{a.author}</div>
                  </td>
                  <td className="px-4 py-3.5 font-medium">
                    <div className="max-w-[14rem] truncate" title={a.subject}>{a.subject}</div>
                  </td>
                  <td className="px-4 py-3.5"><span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Building2 size={11} />{a.department}</span></td>
                  <td className="px-4 py-3.5"><ScoreDots score={a.aiScore} /></td>
                  <td className="px-4 py-3.5"><StatusTag status={a.status} /></td>
                  <td className="px-4 py-3.5"><span className="flex justify-end items-center gap-1 text-xs font-medium text-brand">검수<ChevronRight size={13} /></span></td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}

        {list.length > PAGE_SIZE && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mt-4">
            <span className="text-xs text-muted-foreground font-mono tabular-nums">
              {(tablePage - 1) * PAGE_SIZE + 1}–{Math.min(tablePage * PAGE_SIZE, list.length)} / {list.length}건
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

        <div className="mt-6">
          <ScoreTypeGuide />
        </div>
      </div>

      <ConfirmDialog
        open={bulkOpen}
        title="AI 점수대로 일괄 확정할까요?"
        message={<>승인(자동 확정) 상태이지만 최종 점수가 미확정인 <span className="font-medium text-foreground">{unconfirmedApproved}건</span>을 AI 점수 그대로 확정합니다. 검수 이력에 “{reviewerName()}” 이름으로 기록됩니다.</>}
        confirmLabel="일괄 확정"
        loading={bulkBusy}
        onCancel={() => setBulkOpen(false)}
        onConfirm={runBulkConfirm}
      />
    </div>
  );
}

/** 검수자 이름 표시·변경 (localStorage 저장, 검수 이력에 기록) */

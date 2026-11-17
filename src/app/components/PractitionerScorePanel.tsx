import { useEffect, useMemo, useState } from "react";
import { saveBlob } from "../lib/download";
import { Award, ChevronDown, ChevronsUpDown, ChevronUp, Download, Loader2 } from "lucide-react";
import type { Article } from "../types";
import { useApp } from "../context/AppContext";
import { ARTICLES_FROM_DB, scoringDb } from "../api/scoringDb";
import { Card } from "./ui/Card";
import { Button } from "./ui/Button";
import { DropdownSelect } from "./ui/DropdownSelect";
import { DataTable, TH_CLS } from "../components/ui/DataTable";

/** 실천자 한 명의 점수 집계 */
export interface PractitionerScore {
  name: string;
  department: string;
  approved: number;
  pending: number;
  excluded: number;
  /** 승인 건의 최종 점수 합계 (확정 점수 우선, 미확정 승인 건은 AI 점수) */
  totalScore: number;
}

/** 기사 목록 → 실천자별 점수 집계 (실천자별 행 분리된 DB 데이터 기준) */
export function aggregatePractitionerScores(articles: Article[]): PractitionerScore[] {
  const map = new Map<string, PractitionerScore>();
  for (const a of articles) {
    const name = a.subject?.trim();
    if (!name || name === "-") continue;
    const key = `${name}|${a.department}`;
    const entry = map.get(key) ?? {
      name,
      department: a.department,
      approved: 0,
      pending: 0,
      excluded: 0,
      totalScore: 0,
    };
    if (a.status === "승인") {
      entry.approved += 1;
      entry.totalScore += a.finalScore ?? a.aiScore;
    } else if (a.status === "재확인 필요") {
      entry.pending += 1;
    } else {
      entry.excluded += 1;
    }
    map.set(key, entry);
  }
  return [...map.values()].sort(
    (x, y) => y.totalScore - x.totalScore || y.approved - x.approved || x.name.localeCompare(y.name, "ko"),
  );
}

async function exportScoresToExcel(
  rows: PractitionerScore[],
  scopeLabel: string,
  detailArticles: Article[] | null,
) {
  // exceljs는 무거워서 다운로드 시점에만 동적 로딩
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "BREDRED Love Article Review";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("실천자 점수");
  sheet.addRow(["실천자", "부서", "승인 건수", "재확인 건수", "중복 제외", "최종 점수 합계"]);
  for (const r of rows) {
    sheet.addRow([r.name, r.department, r.approved, r.pending, r.excluded, Number(r.totalScore.toFixed(1))]);
  }
  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFDE9DC" } };
  [18, 22, 10, 10, 10, 14].forEach((w, i) => { sheet.getColumn(i + 1).width = w; });

  // 전체 기간 다운로드에는 호수별 상세 시트를 함께 담는다
  if (detailArticles && detailArticles.length) {
    const detail = workbook.addWorksheet("호수별 상세");
    detail.addRow(["실천자", "부서", "호수", "날짜", "상태", "점수(확정 우선)"]);
    const sorted = [...detailArticles]
      .filter(a => a.subject && a.subject !== "-")
      .sort((a, b) => a.subject.localeCompare(b.subject, "ko") || b.edition - a.edition);
    for (const a of sorted) {
      detail.addRow([
        a.subject,
        a.department,
        a.edition ? `${a.edition}호` : "미지정",
        a.date,
        a.status,
        Number((a.finalScore ?? a.aiScore).toFixed(1)),
      ]);
    }
    const h2 = detail.getRow(1);
    h2.font = { bold: true };
    h2.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFDE9DC" } };
    [18, 22, 10, 12, 12, 14].forEach((w, i) => { detail.getColumn(i + 1).width = w; });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  saveBlob(blob, `실천자점수_${scopeLabel.replace(/\s/g, "") || "전체"}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

type Scope = "edition" | "all";

type ScoreSortKey = "name" | "department" | "approved" | "pending" | "totalScore";

const SCORE_COLUMNS: { key: ScoreSortKey; label: string }[] = [
  { key: "name", label: "실천자" },
  { key: "department", label: "부서" },
  { key: "approved", label: "승인" },
  { key: "pending", label: "재확인" },
  { key: "totalScore", label: "최종 점수" },
];

/**
 * 실천자별 최종 점수 집계 카드 (실천자 점수 탭)
 * 현재 호수 또는 전체 기간의 기사를 집계해 보여주고 엑셀로 내려받는다.
 */
export function PractitionerScorePanel() {
  const { articles, selectedEdition, editions } = useApp();
  const [scope, setScope] = useState<Scope>("edition");
  const [allArticles, setAllArticles] = useState<Article[] | null>(null);
  const [loadingAll, setLoadingAll] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [showAll, setShowAll] = useState(false);
  // 컬럼 헤더 클릭 정렬 (기본: 최종 점수 내림차순)
  const [sortKey, setSortKey] = useState<ScoreSortKey>("totalScore");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const handleSort = (key: ScoreSortKey) => {
    if (sortKey === key) {
      setSortDir(d => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" || key === "department" ? "asc" : "desc");
    }
  };

  const editionLabel = editions.find(e => e.id === selectedEdition)?.label ?? `${selectedEdition}호`;
  const scopeLabel = scope === "edition" ? editionLabel : "전체 기간";

  // 전체 기간 선택 시 전 호수 데이터를 1회 조회해 캐시
  useEffect(() => {
    if (scope !== "all" || allArticles !== null || !ARTICLES_FROM_DB) return;
    let cancelled = false;
    setLoadingAll(true);
    scoringDb.listArticles()
      .then(list => { if (!cancelled) setAllArticles(list); })
      .catch(() => { if (!cancelled) setAllArticles([]); })
      .finally(() => { if (!cancelled) setLoadingAll(false); });
    return () => { cancelled = true; };
  }, [scope, allArticles]);

  const source = useMemo(() => {
    if (scope === "all") return allArticles ?? [];
    return articles.filter(a => a.edition === selectedEdition);
  }, [scope, allArticles, articles, selectedEdition]);

  const rows = useMemo(() => {
    const base = aggregatePractitionerScores(source);
    const dir = sortDir === "asc" ? 1 : -1;
    return [...base].sort((x, y) => {
      const v = (sortKey === "name" || sortKey === "department")
        ? x[sortKey].localeCompare(y[sortKey], "ko")
        : x[sortKey] - y[sortKey];
      return v * dir || y.totalScore - x.totalScore;
    });
  }, [source, sortKey, sortDir]);
  const visible = showAll ? rows : rows.slice(0, 10);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      await exportScoresToExcel(rows, scopeLabel, scope === "all" ? source : null);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Card padding="md" className="mb-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Award size={16} className="text-brand" />
          <h2 className="text-sm font-semibold">실천자별 최종 점수 — {scopeLabel}</h2>
          <span className="text-xs text-muted-foreground">({rows.length}명)</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DropdownSelect
            value={scope}
            onChange={v => setScope(v as Scope)}
            options={[
              { value: "edition", label: `현재 호수 (${editionLabel})` },
              { value: "all", label: "전체 기간 합산" },
            ]}
          />
          <Button
            variant="excel"
            size="sm"
            icon={downloading ? Loader2 : Download}
            loading={downloading}
            disabled={rows.length === 0 || downloading || loadingAll}
            onClick={handleDownload}
          >
            점수 엑셀 다운로드
          </Button>
        </div>
      </div>

      {loadingAll ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-6 justify-center">
          <Loader2 size={14} className="animate-spin" /> 전체 기간 데이터를 불러오는 중...
        </div>
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground py-4 text-center">
          {scopeLabel}에 집계할 실천자 점수가 없습니다.
        </p>
      ) : (
        <>
          <DataTable>
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {SCORE_COLUMNS.map(col => (
                  <th key={col.key} className={TH_CLS}>
                    <button
                      type="button"
                      onClick={() => handleSort(col.key)}
                      className={`inline-flex items-center gap-1 uppercase tracking-wider cursor-pointer hover:text-brand transition-colors ${sortKey === col.key ? "text-brand" : ""}`}
                      title="클릭하여 정렬 (다시 클릭 시 역순)"
                    >
                      {col.label}
                      {sortKey === col.key
                        ? (sortDir === "asc" ? <ChevronUp size={12} /> : <ChevronDown size={12} />)
                        : <ChevronsUpDown size={11} className="opacity-35" />}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visible.map((r, idx) => (
                <tr key={`${r.name}|${r.department}`} className={idx % 2 ? "bg-muted/10" : ""}>
                  <td className="px-4 py-2.5 font-medium">{r.name}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{r.department}</td>
                  <td className="px-4 py-2.5 font-mono text-xs tabular-nums">{r.approved}건</td>
                  <td className="px-4 py-2.5 font-mono text-xs tabular-nums text-amber-700">{r.pending > 0 ? `${r.pending}건` : "-"}</td>
                  <td className="px-4 py-2.5 font-mono font-semibold text-brand tabular-nums">{r.totalScore.toFixed(1)}점</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
          {rows.length > 10 && (
            <button
              type="button"
              onClick={() => setShowAll(v => !v)}
              className="mt-3 text-xs text-brand hover:underline cursor-pointer"
            >
              {showAll ? "접기" : `전체 ${rows.length}명 보기`}
            </button>
          )}
        </>
      )}
    </Card>
  );
}

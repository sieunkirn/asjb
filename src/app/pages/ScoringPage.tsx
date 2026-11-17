import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CloudUpload, Download,
  FileSearch, FileText, Loader2, Play, RefreshCw, RotateCcw, Wifi, WifiOff } from "lucide-react";
import {
  scoringApi, isScoringApiError,
  type ArticleEvaluation, type EvaluationSummary, type ExtractedArticle, type ScoringDocument,
} from "../api/scoring";
import {
  SCORING_LAST_DOCUMENT_KEY,
  extractionStatusLabel,
  isEvaluationFinished, isExtractionFinished, isExtractionReadyForScoring,
  summarizeEvaluations } from "../lib/scoringLabels";
import { ConfirmDialog } from "../components/common";
import { scoringDb } from "../api/scoringDb";
import { useApp } from "../context/AppContext";
import { ScoringSettingsPanel } from "../components/ScoringSettingsPanel";
import { PageHeader } from "../components/ui/PageHeader";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { ProgressBar, Tabs } from "../components/ui/DataTable";
import { ErrorBanner } from "../components/ui/Feedback";
import { formatFileSize } from "../utils";
import { ArticlesTable } from "../components/scoring/ArticlesTable";
import { EvaluationsSection } from "../components/scoring/EvaluationsSection";
import { errorText, formatDateTime } from "../components/scoring/helpers";
import { Badge, Toggle, extractionTone } from "../components/scoring/ui";

type ResultTab = "articles" | "evaluations";

const POLL_INTERVAL_MS = 3000;
/** 점수화 시작 직후 백엔드가 아직 processing 으로 바꾸기 전 상태를 "완료"로 오인하지 않도록 최소 폴링 횟수 */
const MIN_EVALUATION_POLLS = 2;

// ─── 분석 · 채점 섹션 ─────────────────────────────────────────────────────────

/** "2026-09"(month input 값) → "2026년 9월" */
const monthInputToLabel = (value: string): string | null => {
  const m = value.match(/^(\d{4})-(\d{2})$/);
  return m ? `${m[1]}년 ${+m[2]}월` : null;
};

export function ScoringSection({ embedded = false }: { embedded?: boolean }) {
  const { refreshArticles } = useApp();
  const [serverOk, setServerOk] = useState<boolean | null>(null);
  const [documents, setDocuments] = useState<ScoringDocument[]>([]);
  const [documentsError, setDocumentsError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(
    () => localStorage.getItem(SCORING_LAST_DOCUMENT_KEY),
  );
  const [doc, setDoc] = useState<ScoringDocument | null>(null);
  const [docLoading, setDocLoading] = useState(false);
  const [articles, setArticles] = useState<ExtractedArticle[]>([]);
  const [evaluations, setEvaluations] = useState<ArticleEvaluation[]>([]);
  const [summary, setSummary] = useState<EvaluationSummary | null>(null);
  const [tab, setTab] = useState<ResultTab>("articles");

  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [evalRunning, setEvalRunning] = useState(false);
  const [confirmForce, setConfirmForce] = useState(false);
  const [downloading, setDownloading] = useState<"excel" | "pdf" | null>(null);
  const [reevaluating, setReevaluating] = useState<number[]>([]);

  const [onlyArticleReview, setOnlyArticleReview] = useState(false);
  const [onlyEvalReview, setOnlyEvalReview] = useState(false);
  const [expandedArticle, setExpandedArticle] = useState<number | null>(null);
  const [expandedEval, setExpandedEval] = useState<number | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const evalPollCount = useRef(0);
  // 업로드하는 신문의 발행월 (호수에 저장됨). 기본값: 이번 달
  const [uploadMonth, setUploadMonth] = useState(() => new Date().toISOString().slice(0, 7));
  // 자동 점수화 (추출 완료 → 즉시 점수화). 설정은 브라우저에 저장
  const [autoScore, setAutoScore] = useState(() => localStorage.getItem("bredred-auto-score") !== "0");
  const autoScoreRef = useRef(autoScore);
  useEffect(() => {
    autoScoreRef.current = autoScore;
    localStorage.setItem("bredred-auto-score", autoScore ? "1" : "0");
  }, [autoScore]);
  const beginEvaluationRef = useRef<(force: boolean) => void>(() => undefined);

  // ── 서버 상태 · 문서 목록 ──────────────────────────────────────────────────

  const checkServer = useCallback(async () => {
    setServerOk(await scoringApi.health());
  }, []);

  const loadDocuments = useCallback(async () => {
    setDocumentsError(null);
    try {
      setDocuments(await scoringApi.listDocuments(50));
    } catch (e) {
      setDocumentsError(
        isScoringApiError(e) && e.code === "CONNECTION_ERROR"
          ? "분석 서버에 연결되면 업로드 이력이 표시됩니다."
          : errorText(e, "업로드 이력을 불러오지 못했습니다."),
      );
    }
  }, []);

  useEffect(() => {
    checkServer();
    loadDocuments();
  }, [checkServer, loadDocuments]);

  // ── 선택 문서 로드 ─────────────────────────────────────────────────────────

  const loadEvaluations = useCallback(async (documentId: string) => {
    const res = await scoringApi.getEvaluations(documentId);
    setSummary(res.summary);
    setEvaluations(res.evaluations);
    return res.summary;
  }, []);

  const loadArticles = useCallback(async (documentId: string) => {
    const res = await scoringApi.listArticles(documentId);
    setArticles(res.articles);
  }, []);

  // 문서를 빠르게 바꿀 때 늦게 도착한 이전 응답이 화면을 덮어쓰지 않도록 최신 요청만 반영한다.
  const loadSeq = useRef(0);

  const loadDocument = useCallback(async (documentId: string, { silent = false } = {}) => {
    const seq = ++loadSeq.current;
    const isStale = () => seq !== loadSeq.current;
    if (!silent) setDocLoading(true);
    try {
      const d = await scoringApi.getDocument(documentId);
      if (isStale()) return null;
      setDoc(d);
      // 기사/평가 조회는 추출 전에도 빈 목록을 돌려주므로 실패해도 문서 상태는 유지
      const [a, ev] = await Promise.allSettled([loadArticles(documentId), loadEvaluations(documentId)]);
      if (isStale()) return null;
      if (a.status === "rejected") setArticles([]);
      if (ev.status === "rejected") { setSummary(null); setEvaluations([]); }
      // 이전에 점수화가 진행 중이던 문서면 자동으로 이어서 폴링
      if (ev.status === "fulfilled" && ev.value.status === "processing") {
        evalPollCount.current = MIN_EVALUATION_POLLS;
        setEvalRunning(true);
      }
      return d;
    } catch (e) {
      if (isStale()) return null;
      setDoc(null);
      setArticles([]);
      setEvaluations([]);
      setSummary(null);
      setError(errorText(e, "문서 정보를 불러오지 못했습니다."));
      if (isScoringApiError(e) && e.code === "DOCUMENT_NOT_FOUND") {
        localStorage.removeItem(SCORING_LAST_DOCUMENT_KEY);
        setSelectedId(null);
      }
      return null;
    } finally {
      if (!isStale()) setDocLoading(false);
    }
  }, [loadArticles, loadEvaluations]);

  useEffect(() => {
    if (!selectedId) {
      setDoc(null);
      setArticles([]);
      setEvaluations([]);
      setSummary(null);
      return;
    }
    localStorage.setItem(SCORING_LAST_DOCUMENT_KEY, selectedId);
    setError(null);
    setExpandedArticle(null);
    setExpandedEval(null);
    setEvalRunning(false);
    loadDocument(selectedId);
  }, [selectedId, loadDocument]);

  // ── 기사 추출 진행 폴링 ────────────────────────────────────────────────────

  // 폴링 대상은 문서 id로만 결정한다 (doc 객체가 바뀔 때마다 타이머를 다시 만들지 않는다)
  const extractionPollId = doc && !isExtractionFinished(doc.status) ? doc.document_id : null;

  useEffect(() => {
    if (!extractionPollId) return;
    const id = extractionPollId;
    let cancelled = false;
    let busy = false; // 응답이 3초보다 늦어도 요청이 겹치지 않게 한다
    const timer = setInterval(async () => {
      if (busy || cancelled) return;
      busy = true;
      try {
        const d = await scoringApi.getDocument(id);
        if (cancelled) return;
        setDoc(d);
        await loadArticles(id);
        if (cancelled) return;
        if (isExtractionFinished(d.status)) {
          // 최종 상태가 되면 목록의 상태·기사 수도 맞춰 준다
          setDocuments(prev => prev.map(x => (x.document_id === id ? d : x)));
          const s = await loadEvaluations(id).catch(() => undefined);
          if (cancelled) return;
          // 자동 점수화: 추출이 막 끝났고 아직 채점 전이면 바로 점수화 시작
          if (
            autoScoreRef.current
            && s && s.status === "pending"
            && d.article_count > 0
            && isExtractionReadyForScoring(d.status)
          ) {
            beginEvaluationRef.current(false);
          }
        }
      } catch {
        /* 일시적 네트워크 오류는 다음 폴링에서 재시도 */
      } finally {
        busy = false;
      }
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [extractionPollId, loadArticles, loadEvaluations]);

  // ── 점수화 진행 폴링 ───────────────────────────────────────────────────────

  const evalPollId = evalRunning && doc ? doc.document_id : null;

  useEffect(() => {
    if (!evalPollId) return;
    const id = evalPollId;
    let cancelled = false;
    let busy = false;
    const timer = setInterval(async () => {
      if (busy || cancelled) return;
      busy = true;
      try {
        const s = await loadEvaluations(id);
        if (cancelled) return;
        evalPollCount.current += 1;
        if (
          evalPollCount.current >= MIN_EVALUATION_POLLS
          && isEvaluationFinished(s.status)
          && s.processing === 0
        ) {
          setEvalRunning(false);
          setReevaluating([]);
        }
      } catch {
        /* 다음 폴링에서 재시도 */
      } finally {
        busy = false;
      }
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [evalPollId, loadEvaluations]);

  // ── 업로드 ─────────────────────────────────────────────────────────────────

  const handleUpload = useCallback(async (fileList: FileList | File[]) => {
    const file = Array.from(fileList)[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setError("PDF 파일만 업로드할 수 있습니다.");
      return;
    }
    setUploading(true);
    setError(null);
    setNotice(null);
    try {
      const created = await scoringApi.uploadDocument(file);
      setDocumentsError(null);
      setDocuments(prev => [created, ...prev.filter(d => d.document_id !== created.document_id)]);
      loadDocuments();
      setSelectedId(created.document_id);
      setTab("articles");
      // 파일명에서 호수를 읽어 이 신문의 발행월을 저장한다
      const editionMatch = created.original_filename.match(/(\d{3,4})\s*호/);
      const monthLabel = monthInputToLabel(uploadMonth);
      let monthNote = "";
      if (editionMatch && monthLabel) {
        scoringDb.updateEdition(Number(editionMatch[1]), { month: monthLabel })
          .then(() => refreshArticles())
          .catch(() => { /* 발행월 저장 실패는 치명적이지 않음 — 호수 관리에서 수정 가능 */ });
        monthNote = ` 발행월은 ${monthLabel}로 지정했습니다.`;
      }
      setNotice(
        `${created.original_filename} 업로드 완료 — 사랑기사 페이지 ${created.total_love_pages}면을 찾았습니다. `
        + `기사 추출이 백그라운드에서 진행됩니다.${monthNote}`,
      );
      setServerOk(true);
    } catch (e) {
      if (isScoringApiError(e) && e.code === "DUPLICATE_FILE") {
        // 같은 PDF 재업로드 — 비용 낭비 없이 기존 결과로 이동
        const existingId = typeof e.payload?.document_id === "string" ? e.payload.document_id : null;
        setNotice(`${e.message}${existingId ? " 기존 업로드 결과를 불러왔습니다." : ""}`);
        if (existingId) {
          setSelectedId(existingId);
          setTab("articles");
        }
      } else {
        setError(errorText(e, "PDF 업로드에 실패했습니다."));
        if (isScoringApiError(e) && e.code === "CONNECTION_ERROR") setServerOk(false);
      }
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }, [loadDocuments, uploadMonth, refreshArticles]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) handleUpload(e.dataTransfer.files);
  }, [handleUpload]);

  // ── 점수화 ─────────────────────────────────────────────────────────────────

  const beginEvaluation = useCallback(async (force: boolean) => {
    if (!doc) return;
    setStarting(true);
    setError(null);
    setNotice(null);
    try {
      const res = await scoringApi.startEvaluation(doc.document_id, force);
      setNotice(`${res.message} (기사 ${res.total}건)`);
      setTab("evaluations");
      evalPollCount.current = 0;
      setEvalRunning(true);
      await loadEvaluations(doc.document_id).catch(() => undefined);
    } catch (e) {
      if (isScoringApiError(e) && e.code === "EVALUATION_ALREADY_COMPLETED") {
        setConfirmForce(true);
      } else if (isScoringApiError(e) && e.code === "EVALUATION_ALREADY_RUNNING") {
        setNotice(e.message);
        setTab("evaluations");
        evalPollCount.current = MIN_EVALUATION_POLLS;
        setEvalRunning(true);
      } else {
        setError(errorText(e, "점수화를 시작하지 못했습니다."));
      }
    } finally {
      setStarting(false);
    }
  }, [doc, loadEvaluations]);

  beginEvaluationRef.current = beginEvaluation;

  const handleReevaluate = useCallback(async (articleId: number) => {
    if (!doc) return;
    setError(null);
    setReevaluating(prev => (prev.includes(articleId) ? prev : [...prev, articleId]));
    try {
      await scoringApi.reevaluateArticle(articleId);
      evalPollCount.current = 0;
      setEvalRunning(true);
    } catch (e) {
      setReevaluating(prev => prev.filter(id => id !== articleId));
      setError(errorText(e, "기사 재평가를 시작하지 못했습니다."));
    }
  }, [doc]);

  // ── 다운로드 ───────────────────────────────────────────────────────────────

  const handleDownloadExcel = useCallback(async () => {
    if (!doc) return;
    setDownloading("excel");
    setError(null);
    try {
      const stem = doc.original_filename.replace(/\.pdf$/i, "");
      const name = await scoringApi.downloadEvaluationsExcel(doc.document_id, `${stem}_사랑평가결과.xlsx`);
      setNotice(`${name} 다운로드를 시작했습니다.`);
    } catch (e) {
      setError(errorText(e, "점수 엑셀을 다운로드하지 못했습니다."));
    } finally {
      setDownloading(null);
    }
  }, [doc]);

  const handleDownloadClipped = useCallback(async () => {
    if (!doc) return;
    setDownloading("pdf");
    setError(null);
    try {
      const stem = doc.original_filename.replace(/\.pdf$/i, "");
      await scoringApi.downloadClippedPdf(doc.document_id, `${stem}_사랑기사.pdf`);
    } catch (e) {
      setError(errorText(e, "사랑기사 PDF를 다운로드하지 못했습니다."));
    } finally {
      setDownloading(null);
    }
  }, [doc]);

  const handleRefresh = useCallback(async () => {
    await Promise.all([checkServer(), loadDocuments(), selectedId ? loadDocument(selectedId, { silent: true }) : Promise.resolve()]);
  }, [checkServer, loadDocuments, loadDocument, selectedId]);

  // ── 파생 값 ────────────────────────────────────────────────────────────────

  const articleReviewCount = useMemo(() => articles.filter(a => a.needs_review).length, [articles]);
  const visibleArticles = useMemo(
    () => (onlyArticleReview ? articles.filter(a => a.needs_review) : articles),
    [articles, onlyArticleReview],
  );
  const visibleEvaluations = useMemo(
    () => (onlyEvalReview ? evaluations.filter(ev => ev.evaluation_needs_review) : evaluations),
    [evaluations, onlyEvalReview],
  );
  const evalTotals = useMemo(() => summarizeEvaluations(evaluations), [evaluations]);

  const extractionReady = doc ? isExtractionReadyForScoring(doc.status) : false;
  const excelReady = !!summary && summary.done > 0 && summary.pending === 0 && summary.processing === 0;
  const evalBusy = evalRunning || starting;

  // ── 렌더 ───────────────────────────────────────────────────────────────────

  const serverBadge =
    serverOk == null ? null : serverOk ? (
      <Badge tone="success"><Wifi size={11} /> 분석 서버 연결됨</Badge>
    ) : (
      <Badge tone="danger"><WifiOff size={11} /> 분석 서버 연결 안 됨</Badge>
    );

  const refreshButton = (
    <Button variant="secondary" size="sm" icon={RefreshCw} onClick={handleRefresh}>
      새로고침
    </Button>
  );

  const description =
    "분석 서버가 '사랑의 챔피언' 페이지를 찾아 기사를 추출하고, 실천자별 사랑평가 점수를 산정합니다. 1번·2번·기타내용 유형은 자동 확정하지 않고 기업 검토 대상으로 표시합니다.";

  const recentListCard = (
    <Card padding="none" className="overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">최근 업로드</h2>
        <span className="text-[11px] text-muted-foreground font-mono">{documents.length}건</span>
      </div>
      {documentsError ? (
        <div className="p-4 text-xs text-red-700">{documentsError}</div>
      ) : documents.length === 0 ? (
        <div className="p-6 text-center text-xs text-muted-foreground">아직 업로드한 문서가 없습니다.</div>
      ) : (
        <ul className={`${embedded ? "max-h-64" : "max-h-[560px]"} overflow-y-auto divide-y divide-border`}>
          {documents.map(d => {
            const active = d.document_id === selectedId;
            return (
              <li key={d.document_id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(d.document_id)}
                  className={`w-full text-left px-4 py-3 transition-colors ${active ? "bg-accent/70" : "hover:bg-muted/50"}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className={`text-xs font-medium truncate ${active ? "text-brand" : "text-foreground"}`}>{d.original_filename}</span>
                    <Badge tone={extractionTone(d.status)}>{extractionStatusLabel(d.status)}</Badge>
                  </div>
                  <div className="text-[11px] text-muted-foreground font-mono mt-1">
                    {formatDateTime(d.created_at)} · 기사 {d.article_count}건 · {Math.round(d.progress_percent)}%
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );

  return (
    <section>
      {embedded ? (
        // 통합 모드에서는 페이지 상단 제목(파일 업로드 · AI 분석 · 채점)이 있으므로
        // 여기서는 서버 상태 배지와 새로고침만 보여준다.
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>{serverBadge}</div>
          {refreshButton}
        </div>
      ) : (
        <PageHeader
          title="사랑기사 분석 · 채점"
          description={`한가족신문 PDF를 업로드하면 ${description}`}
          badge={serverBadge}
          action={refreshButton}
        />
      )}

      {serverOk === false && (
        <div className="mb-5">
          <ErrorBanner
            message="분석 서버(SSD_Scoring, http://127.0.0.1:8000)에 연결할 수 없습니다. 백엔드 폴더에서 run_api.bat 또는 `python -m uvicorn api.app:app --port 8000`을 실행한 뒤 다시 시도해 주세요."
            onRetry={handleRefresh}
          />
        </div>
      )}
      {error && (
        <div className="mb-5">
          <ErrorBanner message={error} />
        </div>
      )}
      {notice && (
        <p className="mb-5 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
          {notice}
        </p>
      )}

      <div className="mb-5">
        <ScoringSettingsPanel serverOk={serverOk} onSaved={loadDocuments} />
      </div>

      <div className={embedded ? "space-y-5" : "grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-5 items-start"}>
        {/* ── 업로드 + 선택 문서 ─────────────────────────────────────────── */}
        <div className="min-w-0 space-y-5">
          <div
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => !uploading && inputRef.current?.click()}
            className={`cursor-pointer rounded-2xl border-2 border-dashed transition-all duration-200 flex flex-col items-center justify-center py-9 px-6 text-center select-none ${
              dragging
                ? "border-brand bg-accent scale-[1.01]"
                : uploading
                  ? "border-border bg-muted/30 cursor-wait opacity-70"
                  : "border-border hover:border-brand/40 hover:bg-accent/30 bg-card"
            }`}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,application/pdf"
              className="hidden"
              onChange={e => e.target.files && handleUpload(e.target.files)}
            />
            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-3 transition-colors ${dragging ? "bg-brand-light" : "bg-muted"}`}>
              {uploading
                ? <Loader2 size={24} className="text-brand animate-spin" />
                : <CloudUpload size={24} className={dragging ? "text-brand" : "text-muted-foreground"} />}
            </div>
            <p className="text-sm font-semibold text-foreground mb-1">
              {uploading ? "PDF를 업로드하고 사랑기사 페이지를 찾는 중..." : dragging ? "여기에 PDF를 놓으세요" : "신문 PDF를 여기에 드래그하거나 클릭해 선택하세요"}
            </p>
            <p className="text-xs text-muted-foreground">
              업로드 즉시 기사 추출이 시작되며, 완료 후 ‘점수화 시작’을 누르면 실천자별 점수를 계산합니다.
            </p>
          </div>

          <div className="flex items-center justify-between gap-3 flex-wrap -mt-2">
            <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
              이 신문의 발행월
              <input
                type="month"
                value={uploadMonth}
                onChange={e => setUploadMonth(e.target.value)}
                className="px-2 py-1.5 rounded-lg border border-border bg-card text-xs focus:outline-none focus:border-brand"
                title="업로드하는 신문이 몇 월 발행분인지 지정합니다 (호수 관리에 저장됨)"
              />
            </label>
            <Toggle checked={autoScore} onChange={setAutoScore} label="추출 완료 시 자동으로 점수화 시작" />
          </div>

          {embedded && recentListCard}

          {selectedId && docLoading && !doc && (
            <Card padding="md">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 size={14} className="animate-spin" /> 문서 정보를 불러오는 중...
              </div>
            </Card>
          )}

          {doc && (
            <>
              {/* 문서 상태 카드 */}
              <Card padding="md" className="!p-4">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center flex-shrink-0">
                      <FileText size={17} className="text-muted-foreground" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-foreground truncate">{doc.original_filename}</div>
                      <div className="text-xs text-muted-foreground font-mono mt-0.5">
                        {formatFileSize(doc.file_size_bytes)} · 전체 {doc.total_pages}면 · 사랑기사 {doc.total_love_pages}면
                        {doc.love_page_numbers?.length > 0 && ` (p.${doc.love_page_numbers.join(", ")})`}
                        {` · 기사 ${doc.article_count}건`}
                      </div>
                    </div>
                  </div>
                  <Badge tone={extractionTone(doc.status)}>
                    {!isExtractionFinished(doc.status) && <Loader2 size={10} className="animate-spin" />}
                    {extractionStatusLabel(doc.status)}
                  </Badge>
                </div>

                <ProgressBar value={doc.progress_percent} done={doc.status === "completed"} className="mb-2" />
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>기사 추출 {doc.processed_pages}/{doc.total_love_pages} 페이지</span>
                  <span className="font-mono font-semibold tabular-nums">{doc.progress_percent}%</span>
                </div>

                {doc.error_message && (
                  <p className="mt-3 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 whitespace-pre-wrap">
                    {doc.error_message}
                  </p>
                )}

                <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-border">
                  <Button
                    size="sm"
                    icon={starting ? Loader2 : Play}
                    loading={starting}
                    disabled={!extractionReady || evalBusy || doc.article_count === 0}
                    onClick={() => beginEvaluation(false)}
                    title={!extractionReady ? "기사 추출이 완료된 뒤 점수화할 수 있습니다" : undefined}
                  >
                    {evalRunning ? "점수화 진행 중…" : "점수화 시작"}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={RotateCcw}
                    disabled={!extractionReady || evalBusy || !summary || summary.done + summary.error === 0}
                    onClick={() => setConfirmForce(true)}
                  >
                    전체 재평가
                  </Button>
                  <Button
                    size="sm"
                    variant="excel"
                    icon={downloading === "excel" ? Loader2 : Download}
                    loading={downloading === "excel"}
                    disabled={!excelReady || downloading != null}
                    onClick={handleDownloadExcel}
                    title={!excelReady ? "점수화가 완료되면 다운로드할 수 있습니다" : undefined}
                  >
                    점수 엑셀 다운로드
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={downloading === "pdf" ? Loader2 : FileSearch}
                    loading={downloading === "pdf"}
                    disabled={downloading != null}
                    onClick={handleDownloadClipped}
                  >
                    사랑기사 PDF
                  </Button>
                </div>
              </Card>

              {/* 결과 탭 */}
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <Tabs<ResultTab>
                  tabs={[
                    { id: "articles", label: "추출 기사", count: articles.length },
                    { id: "evaluations", label: "채점 결과", count: summary?.done ?? 0 },
                  ]}
                  active={tab}
                  onChange={setTab}
                />
                {tab === "articles" ? (
                  <Toggle checked={onlyArticleReview} onChange={setOnlyArticleReview} label="기술 확인 필요만" count={articleReviewCount} />
                ) : (
                  <Toggle checked={onlyEvalReview} onChange={setOnlyEvalReview} label="기업 검토 필요 기사만" count={summary?.needs_review ?? 0} />
                )}
              </div>

              {tab === "articles" && (
                <ArticlesTable
                  articles={visibleArticles}
                  extracting={!isExtractionFinished(doc.status)}
                  expandedId={expandedArticle}
                  onToggle={id => setExpandedArticle(prev => (prev === id ? null : id))}
                />
              )}

              {tab === "evaluations" && (
                <EvaluationsSection
                  summary={summary}
                  evaluations={visibleEvaluations}
                  totals={evalTotals}
                  running={evalRunning}
                  extractionReady={extractionReady}
                  reevaluating={reevaluating}
                  expandedId={expandedEval}
                  onToggle={id => setExpandedEval(prev => (prev === id ? null : id))}
                  onReevaluate={handleReevaluate}
                />
              )}
            </>
          )}
        </div>

        {/* ── 단독 페이지에서는 오른쪽 열, 통합 모드에서는 위에 배치됨 ───── */}
        {!embedded && recentListCard}
      </div>

      <ConfirmDialog
        open={confirmForce}
        title="문서 전체를 다시 채점할까요?"
        message={
          <>
            <span className="font-medium text-foreground">{doc?.original_filename}</span>의 기사 {summary?.total ?? doc?.article_count ?? 0}건을
            모두 다시 평가합니다. 기존 점수 결과는 새 결과로 덮어쓰이며, 기사 수만큼 AI 호출 비용이 다시 발생합니다.
          </>
        }
        confirmLabel="전체 재평가"
        loading={starting}
        onCancel={() => setConfirmForce(false)}
        onConfirm={async () => { setConfirmForce(false); await beginEvaluation(true); }}
      />
    </section>
  );
}

// ─── 추출 기사 테이블 ─────────────────────────────────────────────────────────


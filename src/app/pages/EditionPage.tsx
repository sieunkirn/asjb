import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Cpu, FileSearch, Pencil, Trash2 } from "lucide-react";
import { editionsApi } from "../api";
import { useApp } from "../context/AppContext";
import { groupEditionsByMonthWeek } from "../lib/editionGrouping";
import { PageHeader } from "../components/ui/PageHeader";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { ProgressBar } from "../components/ui/DataTable";
import { ConfirmDialog } from "../components/common";

/** "2026년 9월" · "2026-09" · "2026.9" → "2026년 9월"로 정규화, 아니면 null */
function normalizeMonth(raw: string): string | null {
  const s = raw.trim();
  const m = s.match(/^(\d{4})\s*년\s*(\d{1,2})\s*월$/) ?? s.match(/^(\d{4})[-./](\d{1,2})$/);
  if (!m) return null;
  const month = +m[2];
  if (month < 1 || month > 12) return null;
  return `${m[1]}년 ${month}월`;
}

/**
 * 호수 관리 — 호수별 검수 진행 현황판
 * 각 호수의 진행률(확정+중복제외 / 전체)과 남은 작업을 보여주고,
 * 해당 작업 화면(검수·채점)으로 바로 이동한다.
 * 호수는 PDF 업로드 시 파일명에서 자동 생성되므로 수동 추가 기능은 없다.
 */
export function EditionPage() {
  const { editions, refreshArticles, setSelectedEdition, selectedEdition, navigate, setReviewTab } = useApp();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editMonth, setEditMonth] = useState("");
  // 명시적으로 토글한 값이 기본값(소수 그룹 자동 열림)보다 우선 — 강제 열림으로 닫히지 않던 버그 방지(팀 수정 반영)
  const [monthOpenState, setMonthOpenState] = useState<Record<string, boolean>>({});
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const groups = useMemo(() => groupEditionsByMonthWeek(editions), [editions]);

  const isMonthOpen = (month: string) => monthOpenState[month] ?? (groups.length <= 2);

  const toggleMonth = (month: string) => {
    setMonthOpenState(prev => ({ ...prev, [month]: !isMonthOpen(month) }));
  };

  /** 해당 호수의 검수(재확인 탭)로 이동 */
  const goReview = (id: number) => {
    setSelectedEdition(id);
    setReviewTab("재확인 필요");
    navigate("review", null);
  };

  /** 해당 호수의 채점(업로드 탭)으로 이동 */
  const goScoring = (id: number) => {
    setSelectedEdition(id);
    navigate("upload", null);
  };

  const startEdit = (id: number, label: string, month: string) => {
    setEditingId(id);
    setEditLabel(label);
    setEditMonth(month);
    setError(null);
    setMessage(null);
  };

  const handleSaveEdit = async () => {
    if (editingId == null) return;
    const month = normalizeMonth(editMonth);
    if (!month) {
      setError("발행월은 ‘2026년 9월’ 형식으로 입력해 주세요.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await editionsApi.update(editingId, {
        label: editLabel.trim() || `${editingId}호`,
        month,
      });
      await refreshArticles();
      setMessage(`${editingId}호 정보가 수정되었습니다.`);
      setEditingId(null);
    } catch {
      setError("호수 수정에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (deleteTarget == null) return;
    setLoading(true);
    setError(null);
    try {
      await editionsApi.remove(deleteTarget);
      await refreshArticles();
      if (selectedEdition === deleteTarget) {
        const next = editions.find(e => e.id !== deleteTarget);
        if (next) setSelectedEdition(next.id);
      }
      setMessage(`${deleteTarget}호가 삭제되었습니다.`);
      setDeleteTarget(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "호수 삭제에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 overflow-auto">
      <div className="page-container max-w-3xl">
        <PageHeader
          title="호수 관리"
          description="호수별 검수 진행 현황을 확인하고 발행월을 관리합니다"
        />

        {message && (
          <p className="mb-4 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">{message}</p>
        )}
        {error && (
          <p className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3">{error}</p>
        )}

        <Card padding="md" className="mb-4">
          <div className="space-y-1.5">
            {groups.length === 0 && (
              <p className="text-xs text-muted-foreground py-6 text-center">
                아직 호수가 없습니다. 업로드 탭에서 신문 PDF를 올리면 자동으로 생성됩니다.
              </p>
            )}
            {groups.map(group => {
              const monthOpen = isMonthOpen(group.month);
              const monthEditions = group.weeks.flatMap(w => w.editions);
              return (
                <div key={group.month} className="border border-border rounded-xl overflow-hidden">
                  <button
                    type="button"
                    onClick={() => toggleMonth(group.month)}
                    className="w-full flex items-center gap-2 px-3 py-2.5 bg-muted/40 hover:bg-muted/60 text-sm font-semibold text-left"
                  >
                    {monthOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    {group.month}
                    <span className="text-xs text-muted-foreground font-normal ml-auto">
                      {monthEditions.length}개 호수 · {monthEditions.reduce((n, e) => n + e.articleCount, 0)}건
                    </span>
                  </button>

                  {monthOpen && monthEditions.map(ed => {
                    const progress = ed.progressPercent ?? 0;
                    const pending = ed.pending ?? 0;
                    const errors = ed.errors ?? 0;
                    const unscored = ed.unscored ?? 0;
                    const isSelected = selectedEdition === ed.id;
                    return (
                      <div key={ed.id} className="px-3 py-3 border-t border-border/60 bg-card">
                        {editingId === ed.id ? (
                          <div className="flex items-center gap-2">
                            <input value={editLabel} onChange={e => setEditLabel(e.target.value)} className="flex-1 min-w-0 px-2 py-1 rounded-lg border border-border text-sm" placeholder="라벨" />
                            <input value={editMonth} onChange={e => setEditMonth(e.target.value)} className="flex-1 min-w-0 px-2 py-1 rounded-lg border border-border text-sm" placeholder="예: 2026년 9월" />
                            <Button size="sm" onClick={handleSaveEdit} disabled={loading}>저장</Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>취소</Button>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center gap-2 flex-wrap">
                              <button
                                type="button"
                                onClick={() => setSelectedEdition(ed.id)}
                                className={`text-sm font-semibold hover:text-brand cursor-pointer ${isSelected ? "text-brand" : ""}`}
                                title="이 호수를 상단 선택 호수로 지정"
                              >
                                {ed.label}
                              </button>
                              {isSelected && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent text-brand font-medium">선택됨</span>
                              )}
                              <span className="text-xs text-muted-foreground">
                                {ed.month}
                                {ed.monthSource === "upload_date" && <span className="opacity-60"> (업로드일 기준 — 연필로 확정)</span>}
                              </span>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded ${progress === 100 ? "bg-emerald-50 text-emerald-700" : "bg-muted"}`}>
                                {progress === 100 ? "검수 완료" : ed.status}
                              </span>
                              <span className="ml-auto flex items-center gap-1">
                                {pending > 0 && (
                                  <Button size="sm" variant="secondary" icon={FileSearch} onClick={() => goReview(ed.id)} title="이 호수의 재확인 건을 검수합니다">
                                    검수 ({pending})
                                  </Button>
                                )}
                                {(unscored > 0 || errors > 0) && (
                                  <Button size="sm" variant="ghost" icon={Cpu} onClick={() => goScoring(ed.id)} title="채점 전·오류 건이 있습니다 — 업로드 탭에서 점수화를 실행하세요">
                                    채점 ({unscored + errors})
                                  </Button>
                                )}
                                <button type="button" onClick={() => startEdit(ed.id, ed.label, ed.month)} className="p-1.5 rounded-lg hover:bg-muted" aria-label="수정" title="이름·발행월 수정">
                                  <Pencil size={13} />
                                </button>
                                <button type="button" onClick={() => setDeleteTarget(ed.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-muted-foreground hover:text-danger" aria-label="삭제" title="호수 삭제 (복구 불가)">
                                  <Trash2 size={13} />
                                </button>
                              </span>
                            </div>

                            <div className="mt-2 flex items-center gap-3">
                              <ProgressBar value={progress} done={progress === 100} className="flex-1" />
                              <span className="text-[11px] font-mono font-semibold tabular-nums text-muted-foreground w-10 text-right">{progress}%</span>
                            </div>
                            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                              {ed.sourceFile && <span title="이 호수를 만든 업로드 파일">📄 {ed.sourceFile}</span>}
                              <span>전체 {ed.articleCount}건</span>
                              <span className="text-emerald-700">확정 {ed.confirmed ?? 0}</span>
                              {(ed.excluded ?? 0) > 0 && <span>중복 제외 {ed.excluded}</span>}
                              <span className={pending > 0 ? "text-amber-700 font-medium" : ""}>재확인 {pending}</span>
                              {errors > 0 && <span className="text-red-700 font-medium">채점 오류 {errors}</span>}
                              {unscored > 0 && <span className="text-violet-700 font-medium">채점 전 {unscored}</span>}
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </Card>

        <p className="text-xs text-muted-foreground bg-muted/40 border border-border rounded-xl px-4 py-3 leading-relaxed">
          호수는 <span className="font-medium text-foreground">PDF 업로드 시 파일명</span>(예: 한가족신문_956호.pdf)에서 자동으로 생성됩니다.
          발행월·이름은 연필 아이콘으로 수정하고, 진행률은 <span className="font-medium text-foreground">(확정 + 중복 제외) ÷ 전체</span> 기준입니다.
        </p>
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="호수를 삭제할까요?"
        message={deleteTarget != null && (
          <><span className="font-medium">{deleteTarget}호</span>의 업로드 문서·기사·채점·검수 기록이 <span className="font-medium text-danger">영구 삭제</span>됩니다. 되돌릴 수 없습니다.</>
        )}
        confirmLabel="삭제"
        tone="danger"
        loading={loading}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
      />
    </div>
  );
}

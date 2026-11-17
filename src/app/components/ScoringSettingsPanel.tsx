import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2, ChevronDown, ChevronRight, Database, Eye, EyeOff, KeyRound, Loader2,
  PlugZap, Save, Settings2, XCircle,
} from "lucide-react";
import {
  scoringApi, isScoringApiError,
  type ScoringSettingsStatus, type ScoringSettingsTestResult,
} from "../api/scoring";
import { Card } from "./ui/Card";
import { Button } from "./ui/Button";

/**
 * 백엔드(SSD_Scoring)의 OPENAI_API_KEY · DATABASE_URL을 웹에서 입력하는 패널
 * ─────────────────────────────────────────────────────────────────────────
 * - 값은 백엔드 `.env`에 저장되고 서버 재시작 없이 바로 반영됩니다.
 * - 저장된 비밀값은 다시 내려받지 않습니다(마스킹된 꼬리만 표시).
 * - 구버전 백엔드(설정 API 없음)에서는 안내만 표시합니다.
 */
export function ScoringSettingsPanel({
  serverOk,
  onSaved,
}: {
  /** 상위 페이지의 health 결과. false면 조회를 시도하지 않음 */
  serverOk: boolean | null;
  /** 저장 후(예: 업로드 이력 다시 불러오기) */
  onSaved?: () => void;
}) {
  const [status, setStatus] = useState<ScoringSettingsStatus | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [autoOpened, setAutoOpened] = useState(false);

  const [apiKey, setApiKey] = useState("");
  const [dbUrl, setDbUrl] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [showDb, setShowDb] = useState(false);

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<ScoringSettingsTestResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const s = await scoringApi.getSettings();
      setStatus(s);
      setUnsupported(false);
    } catch (e) {
      if (isScoringApiError(e) && e.status === 404) {
        setUnsupported(true);
      } else if (!(isScoringApiError(e) && e.code === "CONNECTION_ERROR")) {
        setError(e instanceof Error ? e.message : "설정 상태를 불러오지 못했습니다.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (serverOk) load();
  }, [serverOk, load]);

  // 키나 DB가 비어 있으면 처음 한 번은 자동으로 펼쳐서 안내
  useEffect(() => {
    if (status && !autoOpened && (!status.openai.configured || !status.database.configured)) {
      setOpen(true);
      setAutoOpened(true);
    }
  }, [status, autoOpened]);

  const hasInput = apiKey.trim().length > 0 || dbUrl.trim().length > 0;

  const handleTest = useCallback(async () => {
    setTesting(true);
    setError(null);
    setNotice(null);
    setTestResult(null);
    try {
      const res = await scoringApi.testSettings({
        ...(apiKey.trim() ? { openai_api_key: apiKey.trim() } : {}),
        ...(dbUrl.trim() ? { database_url: dbUrl.trim() } : {}),
      });
      setTestResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "연결 확인에 실패했습니다.");
    } finally {
      setTesting(false);
    }
  }, [apiKey, dbUrl]);

  const handleSave = useCallback(async () => {
    if (!hasInput) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    setTestResult(null);
    try {
      const res = await scoringApi.updateSettings({
        ...(apiKey.trim() ? { openai_api_key: apiKey.trim() } : {}),
        ...(dbUrl.trim() ? { database_url: dbUrl.trim() } : {}),
      });
      setStatus(res);
      setApiKey("");
      setDbUrl("");
      const savedLabels = (res.saved ?? []).map(k => (k === "openai_api_key" ? "OpenAI API 키" : "DB 주소"));
      setNotice(`${savedLabels.join(" · ")} 저장 완료 — 백엔드 .env에 기록되었고 바로 적용됩니다.`);
      onSaved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }, [apiKey, dbUrl, hasInput, onSaved]);

  const keyOk = status?.openai.configured ?? false;
  const dbOk = status?.database.configured ?? false;
  const headerTone = !status ? "text-muted-foreground" : keyOk && dbOk ? "text-emerald-700" : "text-amber-700";

  return (
    <Card padding="none" className="overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/40 transition-colors"
      >
        <span className="flex items-center gap-2.5 min-w-0">
          <span className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
            <Settings2 size={15} className="text-muted-foreground" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-foreground">백엔드 설정 — OpenAI API 키 · DB 주소</span>
            <span className={`block text-xs mt-0.5 ${headerTone}`}>
              {unsupported
                ? "이 백엔드 버전에는 설정 API가 없습니다 (api/routes/settings.py 필요)"
                : loading && !status
                  ? "설정 상태 확인 중..."
                  : status
                    ? `API 키 ${keyOk ? `설정됨 (${status.openai.masked})` : "미설정"} · DB ${dbOk ? `연결 설정됨 (${status.database.label})` : "미설정"}`
                    : serverOk === false
                      ? "분석 서버가 꺼져 있습니다 — 백엔드(run_api.bat)를 켜면 여기서 입력할 수 있습니다"
                      : "분석 서버에 연결되면 확인할 수 있습니다"}
            </span>
          </span>
        </span>
        <span className="flex items-center gap-2 flex-shrink-0">
          {status && (
            <>
              <StatusDot ok={keyOk} label="키" />
              <StatusDot ok={dbOk} label="DB" />
            </>
          )}
          {open ? <ChevronDown size={16} className="text-muted-foreground" /> : <ChevronRight size={16} className="text-muted-foreground" />}
        </span>
      </button>

      {open && !unsupported && serverOk === false && (
        <div className="px-4 pb-4 pt-3 border-t border-border">
          <p className="text-xs text-muted-foreground leading-relaxed">
            분석 서버가 실행 중이 아니라서 아직 입력할 수 없습니다. 백엔드 폴더에서{" "}
            <code className="font-mono bg-muted px-1 rounded">run_api.bat</code>을 실행한 뒤 위의 ‘새로고침’ 버튼을 누르면
            이 패널에서 OpenAI API 키와 DB 주소를 바로 입력할 수 있습니다. (키가 비어 있어도 서버는 켜집니다)
          </p>
        </div>
      )}

      {open && !unsupported && serverOk !== false && (
        <div className="px-4 pb-4 pt-1 border-t border-border space-y-3">
          <p className="text-xs text-muted-foreground leading-relaxed">
            입력한 값은 <span className="font-medium text-foreground">백엔드 서버의 <code className="font-mono">.env</code> 파일</span>에 저장되고 즉시 적용됩니다
            (서버 재시작 불필요). 브라우저에는 저장되지 않으며, 저장된 값은 다시 표시되지 않습니다. 변경할 항목만 입력하면 됩니다.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <SecretField
              icon={KeyRound}
              label="OpenAI API 키"
              placeholder={keyOk ? `현재 ${status?.openai.masked} · 바꾸려면 새 키 입력` : "sk-..."}
              value={apiKey}
              onChange={setApiKey}
              show={showKey}
              onToggleShow={() => setShowKey(v => !v)}
              hint={status ? `모델 ${status.openai.model} · 비전 ${status.openai.vision_model}` : undefined}
            />
            <SecretField
              icon={Database}
              label="DATABASE_URL (PostgreSQL)"
              placeholder={dbOk ? `현재 ${status?.database.label} · 바꾸려면 새 주소 입력` : "postgresql://USER:PASSWORD@HOST/DB?sslmode=require"}
              value={dbUrl}
              onChange={setDbUrl}
              show={showDb}
              onToggleShow={() => setShowDb(v => !v)}
              hint="Neon 등 PostgreSQL 접속 문자열"
            />
          </div>

          {error && (
            <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</p>
          )}
          {notice && (
            <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">{notice}</p>
          )}
          {testResult && (
            <div className="space-y-1.5">
              {testResult.openai && <TestLine ok={testResult.openai.ok} message={testResult.openai.message} />}
              {testResult.database && <TestLine ok={testResult.database.ok} message={testResult.database.message} />}
            </div>
          )}

          <div className="flex flex-wrap gap-2 items-center">
            <Button
              size="sm"
              icon={saving ? Loader2 : Save}
              loading={saving}
              disabled={!hasInput || saving || testing}
              onClick={handleSave}
            >
              저장
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon={testing ? Loader2 : PlugZap}
              loading={testing}
              disabled={saving || testing}
              onClick={handleTest}
              title={hasInput ? "입력한 값으로 연결을 확인합니다 (저장 안 함)" : "현재 저장된 값으로 연결을 확인합니다"}
            >
              {hasInput ? "입력값으로 연결 확인" : "현재 설정 연결 확인"}
            </Button>
            <span className="text-[11px] text-muted-foreground ml-auto">
              값을 지우려면 백엔드 .env 파일에서 직접 삭제하세요
            </span>
          </div>
        </div>
      )}
    </Card>
  );
}

function StatusDot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${ok ? "text-emerald-700" : "text-amber-700"}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${ok ? "bg-emerald-500" : "bg-amber-500"}`} />
      {label}
    </span>
  );
}

function TestLine({ ok, message }: { ok: boolean; message: string }) {
  return (
    <p className={`text-xs rounded-xl px-3 py-2 border flex items-start gap-1.5 ${ok ? "text-emerald-700 bg-emerald-50 border-emerald-200" : "text-red-700 bg-red-50 border-red-200"}`}>
      {ok ? <CheckCircle2 size={13} className="mt-0.5 flex-shrink-0" /> : <XCircle size={13} className="mt-0.5 flex-shrink-0" />}
      <span className="break-all">{message}</span>
    </p>
  );
}

function SecretField({
  icon: Icon, label, placeholder, value, onChange, show, onToggleShow, hint,
}: {
  icon: typeof KeyRound;
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggleShow: () => void;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="flex items-center gap-1.5 text-xs font-medium text-foreground mb-1.5">
        <Icon size={13} className="text-muted-foreground" /> {label}
      </span>
      <span className="relative block">
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          className="w-full pl-3 pr-10 py-2.5 rounded-xl border border-border bg-card text-sm font-mono text-foreground placeholder:text-muted-foreground placeholder:font-sans focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/15 transition-all"
        />
        <button
          type="button"
          onClick={onToggleShow}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
          aria-label={show ? "값 숨기기" : "값 보기"}
          tabIndex={-1}
        >
          {show ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </span>
      {hint && <span className="block text-[11px] text-muted-foreground mt-1">{hint}</span>}
    </label>
  );
}

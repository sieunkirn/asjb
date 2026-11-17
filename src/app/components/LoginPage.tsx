import { useState } from "react";
import { Heart, Loader2 } from "lucide-react";
import { reviewerName, tryLogin } from "../api/auth";

/**
 * 로그인 화면 — 서버에 접속 코드(API_ACCESS_TOKEN)가 설정되어 있을 때만 나타난다.
 * 이름은 검수 이력(누가 확정했는지)에 기록되고, 접속 코드는 이 브라우저에만 저장된다.
 * (코드가 화면 파일에 들어 있지 않으므로 공개 서버에서도 보호 수단이 된다)
 */
export function LoginPage({ onLoggedIn }: { onLoggedIn: () => void }) {
  const initialName = reviewerName();
  const [name, setName] = useState(initialName === "웹 검수자" ? "" : initialName);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!name.trim()) return setError("이름을 입력해 주세요. 검수 이력에 기록됩니다.");
    if (!code.trim()) return setError("접속 코드를 입력해 주세요.");
    setBusy(true);
    setError(null);
    const result = await tryLogin(code, name);
    setBusy(false);
    if (result === "ok") return onLoggedIn();
    setError(
      result === "locked"
        ? "접속 코드를 여러 번 잘못 입력했습니다. 약 5분 뒤에 다시 시도해 주세요."
        : result === "offline"
          ? "서버에 연결할 수 없습니다. 서버가 켜져 있는지 확인해 주세요."
          : "접속 코드가 올바르지 않습니다. 관리자에게 코드를 확인해 주세요.",
    );
  };

  const field =
    "w-full px-3 py-2.5 rounded-xl border border-border bg-card text-sm focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/15";

  return (
    <div className="flex min-h-screen bg-background items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm bg-card border border-border rounded-2xl shadow-sm p-7">
        <div className="flex items-center gap-2.5 mb-6">
          <div className="w-9 h-9 rounded-lg bg-brand flex items-center justify-center shadow-sm">
            <Heart size={16} className="text-white fill-white" />
          </div>
          <div>
            <div className="text-sm font-semibold leading-tight">성심당</div>
            <div className="text-[11px] text-muted-foreground leading-tight">사랑기사 평가 시스템</div>
          </div>
        </div>

        <label className="block text-xs font-medium text-muted-foreground mb-1.5" htmlFor="login-name">이름 (검수자)</label>
        <input
          id="login-name" className={field} value={name} onChange={e => setName(e.target.value)}
          autoComplete="name" autoFocus placeholder="예: 김검수"
        />

        <label className="block text-xs font-medium text-muted-foreground mt-4 mb-1.5" htmlFor="login-code">접속 코드</label>
        <input
          id="login-code" className={field} type="password" value={code} onChange={e => setCode(e.target.value)}
          autoComplete="current-password" placeholder="관리자에게 받은 코드"
        />

        {error && <p role="alert" className="text-xs text-red-700 mt-3">{error}</p>}

        <button
          type="submit" disabled={busy}
          className="mt-5 w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-brand text-white text-sm font-medium hover:bg-brand-hover disabled:opacity-60"
        >
          {busy && <Loader2 size={15} className="animate-spin" />}
          로그인
        </button>
        <p className="text-[11px] text-muted-foreground mt-4 leading-relaxed">
          접속 코드는 이 브라우저에만 저장됩니다. 공용 컴퓨터에서는 사용 후 사이드바의 로그아웃을 눌러 주세요.
        </p>
      </form>
    </div>
  );
}

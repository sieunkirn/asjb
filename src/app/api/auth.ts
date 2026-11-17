/**
 * 로그인(접속 코드) · 검수자 이름 · 브라우저 저장소.
 * 서버에 접속 코드(API_ACCESS_TOKEN)가 설정되어 있을 때만 로그인 화면이 나타난다.
 */
import { API_BASE } from "./config";

function readStored(key: string): string | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
  } catch {
    return null; // 개인정보 보호 모드 등에서 localStorage 접근이 막힌 경우
  }
}

/**
 * 접속 토큰 — 브라우저 localStorage("bredred-access-token") 우선, 없으면 빌드 환경변수.
 * 호출할 때마다 읽으므로 토큰을 바꿔도 새로고침이 필요 없다.
 * ※ VITE_ 로 시작하는 빌드 환경변수는 화면 코드(JS)에 그대로 들어가 누구나 볼 수 있다.
 *   인터넷에 공개되는 서버의 보호 수단으로 쓰지 말고, 내부망·로컬 PC 용으로만 사용하세요.
 */
export const getAccessToken = (): string =>
  (readStored("bredred-access-token") ?? import.meta.env.VITE_API_ACCESS_TOKEN ?? "").trim();

/** 설정 화면(API 키·DB 주소 변경)용 관리자 토큰 — 서버의 SETTINGS_ADMIN_TOKEN 과 같은 값 */
export const getAdminToken = (): string => (readStored("bredred-admin-token") ?? "").trim();

export const tokenHeaders = (): Record<string, string> => {
  const headers: Record<string, string> = {};
  const access = getAccessToken();
  if (access) headers["X-Access-Token"] = access;
  const admin = getAdminToken();
  if (admin) headers["X-Admin-Token"] = admin;
  return headers;
};

/** 접속 코드가 필요한데 없거나 틀렸을 때(401) 발생하는 이벤트 — App이 로그인 화면을 보여준다 */
export const AUTH_REQUIRED_EVENT = "bredred-auth-required";

export const notifyAuthRequired = (): void => {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
};

function writeStored(key: string, value: string | null): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* 저장이 막힌 환경 — 이번 방문에서만 유지 */
  }
}

/** 앱을 열 때: 접속 코드가 필요한 서버면 저장된 코드가 맞는지 확인한다 */
export async function checkAuth(): Promise<"ok" | "login"> {
  try {
    const status = await fetch(`${API_BASE}/api/v1/auth/status`);
    if (!status.ok) return "ok"; // 구버전 서버·프록시 오류 → 예전처럼 진행
    const { required } = (await status.json()) as { required?: boolean };
    if (!required) return "ok";
    const res = await fetch(`${API_BASE}/api/v1/auth/check`, { headers: tokenHeaders() });
    return res.ok ? "ok" : "login";
  } catch {
    return "ok"; // 서버가 꺼져 있으면 기존 '연결 안 됨' 안내가 처리한다
  }
}

export type LoginResult = "ok" | "wrong" | "locked" | "offline";

/** 로그인: 접속 코드를 서버에 확인하고, 맞으면 코드와 검수자 이름을 이 브라우저에 저장한다 */
export async function tryLogin(token: string, name: string): Promise<LoginResult> {
  try {
    const res = await fetch(`${API_BASE}/api/v1/auth/check`, { headers: { "X-Access-Token": token.trim() } });
    if (res.ok) {
      writeStored("bredred-access-token", token.trim());
      writeStored("bredred-reviewer-name", name.trim() || null);
      return "ok";
    }
    return res.status === 429 ? "locked" : "wrong";
  } catch {
    return "offline";
  }
}

/** 로그아웃: 저장된 접속 코드를 지우고 로그인 화면으로 돌려보낸다 */
export function logout(): void {
  writeStored("bredred-access-token", null);
  notifyAuthRequired();
}

/** 검수자 이름을 바꾼다 (검수 상세 상단의 "검수자: ✎") */
export const setReviewerName = (name: string): void => writeStored("bredred-reviewer-name", name.trim() || null);

/** 검수자 이름 — 로그인 때 입력하거나 검수 상세 상단의 "검수자: ✎"에서 변경, 검수 이력에 기록됨 */
export const reviewerName = (): string => readStored("bredred-reviewer-name")?.trim() || "웹 검수자";

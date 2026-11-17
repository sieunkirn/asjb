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

export interface AuthStatus {
  /** 서버가 접속 코드를 요구하는가 */
  required: boolean;
  /** 지금 이 브라우저가 데이터를 볼 수 있는가 (코드가 필요 없거나, 저장된 코드가 맞음) */
  valid: boolean;
}

/**
 * 로그인 상태 확인. 서버에 연결할 수 없거나 구버전 서버면 '로그인 필요 없음'으로 본다
 * (서버가 꺼져 있을 때의 안내는 기존 '연결 안 됨' 배너가 맡는다).
 */
export async function getAuthStatus(): Promise<AuthStatus> {
  const open: AuthStatus = { required: false, valid: true };
  try {
    const status = await fetch(`${API_BASE}/api/v1/auth/status`);
    if (!status.ok) return open;
    const { required } = (await status.json()) as { required?: boolean };
    if (!required) return open;
    const res = await fetch(`${API_BASE}/api/v1/auth/check`, { headers: tokenHeaders() });
    return { required: true, valid: res.ok };
  } catch {
    return open;
  }
}

export type LoginResult = "ok" | "wrong" | "locked" | "offline";

/**
 * 로그인. 접속 코드가 필요한 서버면 코드를 서버에 확인하고, 맞으면 코드와 검수자 이름을 이 브라우저에 저장한다.
 * 코드가 필요 없는 서버면 검수자 이름만 저장한다 (검수 이력에 이름이 남는다).
 */
export async function tryLogin(token: string, name: string, required: boolean): Promise<LoginResult> {
  if (!required) {
    writeStored("bredred-reviewer-name", name.trim() || null);
    return "ok";
  }
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

/** 로그아웃: 저장된 접속 코드와 이름을 지운다. 로그인 상태가 바뀌었음을 앱에 알린다. */
export function logout(): void {
  writeStored("bredred-access-token", null);
  writeStored("bredred-reviewer-name", null);
  notifyAuthRequired();
}

/** 이 브라우저에 로그인한 이름이 저장돼 있는가 */
export const hasStoredReviewer = (): boolean => Boolean(readStored("bredred-reviewer-name")?.trim());

/** 검수자 이름을 바꾼다 (검수 상세 상단의 "검수자: ✎") */
export const setReviewerName = (name: string): void => writeStored("bredred-reviewer-name", name.trim() || null);

/** 검수자 이름 — 로그인 때 입력하거나 검수 상세 상단의 "검수자: ✎"에서 변경, 검수 이력에 기록됨 */
export const reviewerName = (): string => readStored("bredred-reviewer-name")?.trim() || "웹 검수자";

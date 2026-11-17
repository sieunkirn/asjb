import { notifyAuthRequired } from "./auth";

export interface HttpErrorInfo {
  status: number;
  code: string;
  message: string;
  /** 서버가 detail 객체로 준 추가 정보 (예: 중복 문서 id) */
  payload?: Record<string, unknown>;
  /** JSON이 아닌 5xx = 개발 서버(Vite) 프록시가 백엔드에 붙지 못한 것 → 연결 오류로 취급 */
  isConnectionError: boolean;
}

/** 실패한 응답(res.ok === false)에서 오류 코드 · 메시지를 읽는다. 401이면 로그인 화면을 띄운다. */
export async function readHttpError(res: Response): Promise<HttpErrorInfo> {
  if (res.status === 401) notifyAuthRequired(); // 접속 코드가 없거나 틀림 → 로그인 화면

  let code = "UNKNOWN_ERROR";
  let message = `요청에 실패했습니다 (${res.status})`;
  let payload: Record<string, unknown> | undefined;
  let parsed = false;
  try {
    const body = (await res.json()) as {
      detail?: { code?: string; message?: string } | string;
      code?: string;
      message?: string;
    };
    parsed = true;
    if (typeof body.detail === "object" && body.detail) {
      code = body.detail.code ?? code;
      message = body.detail.message ?? message;
      payload = body.detail as Record<string, unknown>;
    } else if (typeof body.detail === "string") {
      message = body.detail;
    } else {
      code = body.code ?? code;
      message = body.message ?? message;
    }
  } catch {
    /* 본문이 JSON이 아니면 기본 메시지를 쓴다 */
  }
  return {
    status: res.status,
    code,
    message,
    payload,
    isConnectionError: !parsed && [500, 502, 503, 504].includes(res.status),
  };
}

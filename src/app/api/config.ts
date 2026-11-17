/** 분석 서버(FastAPI) 주소. 비우면 같은 출처(/api/...)로 호출한다 — 개발 중에는 Vite 프록시가 받는다. */
export const API_BASE = (import.meta.env.VITE_SCORING_API_BASE_URL ?? "").replace(/\/$/, "");

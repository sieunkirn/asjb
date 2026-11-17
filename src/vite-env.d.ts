/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_USE_MOCK?: string;
  readonly VITE_CHAT_PROVIDER?: "rule" | "llm";
  /** 사랑기사 분석·채점 백엔드(SSD_Scoring) 주소. 비우면 Vite 프록시(/api/v1 → 127.0.0.1:8000) 사용 */
  readonly VITE_SCORING_API_BASE_URL?: string;
  /** 기사·호수·통계 데이터 출처: "db"(기본, 분석 서버 PostgreSQL) | "mock"(기존 데모) */
  readonly VITE_ARTICLES_SOURCE?: "db" | "mock";
  /** (선택) 접속 토큰 — 백엔드 API_ACCESS_TOKEN과 동일 값 */
  readonly VITE_API_ACCESS_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

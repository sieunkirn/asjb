import { defineConfig } from "vite";
import path from "path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { chatApiPlugin } from "./server/viteChatPlugin";

export default defineConfig({
  plugins: [react(), tailwindcss(), chatApiPlugin()],
  server: {
    proxy: {
      // 사랑기사 분석·채점 백엔드 (SSD_Scoring FastAPI, port 8000) — docs/scoring-integration.md 참고
      "/api/v1": {
        target: process.env.SCORING_API_PROXY_TARGET || "http://127.0.0.1:8000",
        changeOrigin: true,
      },
      // 화면용 DB API (기사·호수·통계·검수 이력) — api/routes/webapp.py
      "/api/articles": { target: process.env.SCORING_API_PROXY_TARGET || "http://127.0.0.1:8000", changeOrigin: true },
      "/api/editions": { target: process.env.SCORING_API_PROXY_TARGET || "http://127.0.0.1:8000", changeOrigin: true },
      "/api/audit": { target: process.env.SCORING_API_PROXY_TARGET || "http://127.0.0.1:8000", changeOrigin: true },
      "/api/stats": { target: process.env.SCORING_API_PROXY_TARGET || "http://127.0.0.1:8000", changeOrigin: true },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});

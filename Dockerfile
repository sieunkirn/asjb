# Render 등 클라우드 배포용 — 화면(dist)을 빌드한 뒤 백엔드 서버 하나로 서빙한다.
# (로컬 담당자 PC 운영은 기존 bat 방식 그대로이며 이 파일과 무관)

# ── 1단계: 프론트 화면 빌드 ─────────────────────────────
FROM node:20-slim AS frontend
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ── 2단계: 백엔드 + 빌드된 화면 ─────────────────────────
FROM python:3.12-slim
WORKDIR /app/backend
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ .
# app.py가 /app/dist 를 자동 탐색한다 (FRONTEND_DIST 설정 불필요)
COPY --from=frontend /app/dist /app/dist
ENV PYTHONUTF8=1
# Render가 PORT 환경변수를 주입한다 (로컬 docker run 시엔 8000)
CMD uvicorn api.app:app --host 0.0.0.0 --port ${PORT:-8000}

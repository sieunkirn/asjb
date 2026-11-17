#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [[ ! -f .env ]]; then
  cp .env.example .env
  echo ".env 파일을 만들었습니다. OPENAI_API_KEY와 DATABASE_URL을 입력한 뒤 다시 실행하세요."
  exit 1
fi
PYTHON="python"
if [[ -x .venv/bin/python ]]; then
  PYTHON=".venv/bin/python"
fi
"$PYTHON" -m uvicorn api.app:app --reload --host 127.0.0.1 --port 8000

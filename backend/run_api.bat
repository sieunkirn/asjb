@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"
set "PYTHONUTF8=1"

echo ============================================
echo SSD Scoring API
echo ============================================
echo.

if not exist ".venv\Scripts\python.exe" (
    echo ERROR: The virtual environment was not found.
    echo Run setup_windows.bat first.
    pause
    exit /b 1
)

if not exist ".env" (
    copy /Y ".env.example" ".env" >nul
    echo NOTE: .env did not exist, so a new one was created from .env.example.
)

set "ENV_READY=1"
findstr /R /C:"^OPENAI_API_KEY=..*" ".env" >nul
if errorlevel 1 set "ENV_READY=0"
findstr /R /C:"^DATABASE_URL=postgres.*" ".env" >nul
if errorlevel 1 set "ENV_READY=0"
findstr /C:"USER:PASSWORD@HOST" ".env" >nul
if not errorlevel 1 set "ENV_READY=0"

if "%ENV_READY%"=="0" (
    echo WARNING: OPENAI_API_KEY and/or DATABASE_URL are not configured yet.
    echo          You can enter them in the web UI ^(front-end "기사 분석 · 채점" page,
    echo          "백엔드 설정" panel^) or edit .env directly. The server will start anyway.
    echo.
)

echo Starting the API server...
echo Upload page: http://127.0.0.1:8000/
echo API docs:    http://127.0.0.1:8000/docs
echo Press Ctrl+C to stop the server.
echo.

".venv\Scripts\python.exe" -m uvicorn api.app:app --reload --host 127.0.0.1 --port 8000
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if not "%EXIT_CODE%"=="0" echo ERROR: The API server stopped with exit code %EXIT_CODE%.
pause
exit /b %EXIT_CODE%

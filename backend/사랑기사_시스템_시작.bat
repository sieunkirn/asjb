@echo off
setlocal EnableExtensions
cd /d "%~dp0"
set "PYTHONUTF8=1"

rem == 성심당 사랑기사 평가 시스템 - 더블클릭 한 번으로 실행 ==
rem 서버(백엔드+화면)를 최소화된 창으로 켜고 브라우저를 엽니다.
rem 사용 중에는 최소화된 서버 창을 닫지 마세요.

set "PYEXE=.venv\Scripts\python.exe"
if not exist "%PYEXE%" set "PYEXE=python"

rem 이미 실행 중이면 브라우저만 연다
netstat -ano | findstr /R /C:":8000 .*LISTENING" >nul 2>&1
if not errorlevel 1 (
    start "" http://127.0.0.1:8000/
    exit /b 0
)

echo 서버를 시작하는 중입니다... (잠시만 기다려 주세요)
start "SSD server - do not close" /min "%PYEXE%" -m uvicorn api.app:app --host 127.0.0.1 --port 8000

rem 서버가 뜰 때까지 최대 25초 대기
set /a TRIES=0
:waitloop
timeout /t 1 /nobreak >nul
netstat -ano | findstr /R /C:":8000 .*LISTENING" >nul 2>&1
if not errorlevel 1 goto ready
set /a TRIES+=1
if %TRIES% lss 25 goto waitloop

echo.
echo 서버가 25초 안에 시작되지 않았습니다.
echo 최소화된 "SSD server" 창을 열어 오류 메시지를 확인해 주세요.
echo (.env의 DATABASE_URL / OPENAI_API_KEY 설정을 확인해 주세요)
pause
exit /b 1

:ready
start "" http://127.0.0.1:8000/
exit /b 0

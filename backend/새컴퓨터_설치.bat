@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo ==================================================
echo   사랑기사 평가 시스템 - 새 컴퓨터 설치
echo ==================================================
echo.
echo 이 파일은 처음 한 번만 실행하면 됩니다.
echo 이후에는 "사랑기사_시스템_시작.bat"만 쓰세요.
echo.

rem ── 1/3 Python 확인 ─────────────────────────────
echo [1/3] Python 확인 중...
set "PYEXE="
py -3 --version >nul 2>&1
if not errorlevel 1 set "PYEXE=py -3"
if defined PYEXE goto pyok
python --version >nul 2>&1
if not errorlevel 1 set "PYEXE=python"
if defined PYEXE goto pyok

echo     Python이 없어 자동 설치를 시도합니다... (1~2분)
winget install -e --id Python.Python.3.12 --silent --accept-source-agreements --accept-package-agreements
py -3 --version >nul 2>&1
if not errorlevel 1 set "PYEXE=py -3"
if defined PYEXE goto pyok

echo.
echo     Python 자동 설치에 실패했습니다.
echo     지금 열리는 웹페이지에서 Python을 내려받아 설치한 뒤
echo     이 파일을 다시 실행해 주세요.
echo     (설치 화면에서 "Add python.exe to PATH" 반드시 체크!)
start https://www.python.org/downloads/
pause
exit /b 1

:pyok
echo     Python 확인 완료

rem ── 2/3 구성요소 설치 ───────────────────────────
echo.
echo [2/3] 프로그램 구성요소 설치 중... (처음엔 몇 분 걸립니다)
if not exist ".venv\Scripts\python.exe" (
    %PYEXE% -m venv .venv
)
if not exist ".venv\Scripts\python.exe" (
    echo     가상환경 생성에 실패했습니다. 관리자에게 문의해 주세요.
    pause
    exit /b 1
)
".venv\Scripts\python.exe" -m pip install --upgrade pip --quiet --disable-pip-version-check
".venv\Scripts\python.exe" -m pip install -r requirements.txt --quiet --disable-pip-version-check
if errorlevel 1 (
    echo.
    echo     구성요소 설치에 실패했습니다.
    echo     인터넷 연결을 확인한 뒤 이 파일을 다시 실행해 주세요.
    pause
    exit /b 1
)
echo     구성요소 설치 완료

rem ── 3/3 설정 파일 확인 ──────────────────────────
echo.
echo [3/3] 설정 파일(.env) 확인 중...
set "DISTOK="
if exist "..\dist\index.html" set "DISTOK=1"
if exist "..\BREDRED_frontend\dist\index.html" set "DISTOK=1"
if not defined DISTOK (
    echo     [참고] 화면 파일^(dist 폴더^)이 보이지 않습니다.
    echo     폴더를 복사할 때 dist 폴더가 빠지지 않았는지 확인하세요.
)
if exist ".env" goto envok

echo.
echo     설정 파일(.env)이 아직 없습니다.
echo.
echo     기존에 쓰던 컴퓨터의 backend 폴더에서 .env 파일을 복사해
echo     이 폴더에 붙여넣은 뒤, 이 파일을 다시 실행해 주세요.
echo.
echo     현재 폴더: %CD%
echo.
echo     (.env 안에는 OpenAI 키와 데이터베이스 주소가 들어 있습니다.
echo      새로 만들어야 하면 .env.example 파일을 메모장으로 열어 참고하세요.)
pause
exit /b 1

:envok
echo     설정 확인 완료
echo.
echo ==================================================
echo   설치가 끝났습니다! 시스템을 시작합니다...
echo ==================================================
call "사랑기사_시스템_시작.bat"

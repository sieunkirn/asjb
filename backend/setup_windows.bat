@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================
echo SSD Scoring - Windows setup
echo ============================================
echo.

where py >nul 2>&1
if not errorlevel 1 goto :use_py_launcher

where python >nul 2>&1
if not errorlevel 1 goto :use_python_command

echo ERROR: Python 3 was not found.
echo Install Python 3.11 or 3.12 and enable "Add python.exe to PATH".
echo Then run this file again.
pause
exit /b 1

:use_py_launcher
set "PY_CMD=py -3"
goto :python_ready

:use_python_command
set "PY_CMD=python"

:python_ready
echo [1/5] Checking Python...
%PY_CMD% --version
if errorlevel 1 goto :failed

if exist ".venv" if not exist ".venv\Scripts\python.exe" (
    echo Removing an incomplete virtual environment...
    rmdir /s /q ".venv"
)

if not exist ".venv\Scripts\python.exe" (
    echo [2/5] Creating virtual environment...
    %PY_CMD% -m venv ".venv"
    if errorlevel 1 goto :failed
) else (
    echo [2/5] Reusing existing virtual environment.
)

set "PY_VERSION="
set "PY_MINOR="
for /f "tokens=2" %%V in ('.venv\Scripts\python.exe --version 2^>^&1') do set "PY_VERSION=%%V"
if not defined PY_VERSION goto :failed
for /f "tokens=1,2 delims=." %%A in ("%PY_VERSION%") do set "PY_MINOR=%%B"
if not defined PY_MINOR goto :failed

set "REQUIREMENTS=requirements.txt"
if "%PY_MINOR%"=="14" set "REQUIREMENTS=requirements-python314.txt"

if not exist "%REQUIREMENTS%" (
    echo ERROR: %REQUIREMENTS% was not found.
    goto :failed
)

echo [3/5] Upgrading pip...
".venv\Scripts\python.exe" -m pip install --upgrade pip setuptools wheel
if errorlevel 1 goto :failed

echo [4/5] Installing packages from %REQUIREMENTS%...
".venv\Scripts\python.exe" -m pip install -r "%REQUIREMENTS%"
if errorlevel 1 goto :failed

echo [5/5] Preparing .env...
if not exist ".env" (
    copy /Y ".env.example" ".env" >nul
    if errorlevel 1 goto :failed
    echo Created .env from .env.example.
) else (
    echo Existing .env was kept.
)

echo.
echo Setup completed successfully.
echo Open .env and enter OPENAI_API_KEY and DATABASE_URL.
echo Then run run_api.bat.
echo.
start "" notepad.exe ".env"
pause
exit /b 0

:failed
echo.
echo ERROR: Setup failed. Review the error message above.
pause
exit /b 1

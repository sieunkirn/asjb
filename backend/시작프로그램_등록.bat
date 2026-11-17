@echo off
setlocal EnableExtensions

rem == 컴퓨터를 켜면 사랑기사 시스템이 자동 실행되도록 등록 (1회만 실행) ==

powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $lnk = $ws.CreateShortcut([Environment]::GetFolderPath('Startup') + '\사랑기사시스템.lnk'); $lnk.TargetPath = '%~dp0사랑기사_시스템_시작.bat'; $lnk.WorkingDirectory = '%~dp0'; $lnk.WindowStyle = 7; $lnk.Save()"

if errorlevel 1 (
    echo 등록에 실패했습니다. 관리자에게 문의해 주세요.
) else (
    echo 등록 완료! 다음 부팅부터 자동으로 실행됩니다.
    echo 해제하려면: Win+R 에서 shell:startup 입력 후 바로가기 삭제
)
pause

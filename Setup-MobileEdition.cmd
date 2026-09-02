@echo off
setlocal

set "SETUP_ROUTER=%~dp0scripts\Start-MobileEditionSetup.ps1"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SETUP_ROUTER%" %*
set "SETUP_EXIT=%ERRORLEVEL%"

if not "%SETUP_EXIT%"=="0" (
    echo.
    echo Setup failed with exit code %SETUP_EXIT%.
    if not defined FEEDBACK_MOBILE_EDITION_NO_PAUSE pause
)

exit /b %SETUP_EXIT%

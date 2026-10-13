@echo off
setlocal
title ParallelSystems.Web.TaskManagement Production Deployment

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Deploy-ParallelSystems-TaskManagement.ps1" %*
set "DEPLOY_EXIT=%ERRORLEVEL%"

echo.
if not "%DEPLOY_EXIT%"=="0" (
    echo Deployment did not complete. Review the error above.
) else (
    echo Deployment process finished.
)
echo.
pause
exit /b %DEPLOY_EXIT%

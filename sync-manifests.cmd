@echo off
setlocal
set "REPO_DIR=%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%REPO_DIR%tools\update-manifests.ps1" -RepoDir "%REPO_DIR%"
exit /b %ERRORLEVEL%

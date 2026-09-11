@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\update-manifests.ps1"
exit /b %ERRORLEVEL%

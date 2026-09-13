@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\tools\update-manifests.ps1"
exit /b %ERRORLEVEL%

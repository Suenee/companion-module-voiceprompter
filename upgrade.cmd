@echo off
setlocal EnableExtensions
cd /d "%~dp0"
set "REPO_URL=https://github.com/Suenee/companion-module-voiceprompter.git"
set "BRANCH=main"
echo ============================================
echo VoicePrompter Module - GitHub upgrade
echo ============================================
where git >NUL 2>&1
if errorlevel 1 (echo ERROR: Git for Windows is not installed or git.exe is not in PATH.&goto :fail)
if not exist ".git" (
  echo [1/4] Connecting existing folder to GitHub...
  git init || goto :fail
  git remote add origin "%REPO_URL%" 2>NUL
  git remote set-url origin "%REPO_URL%"
  git fetch origin "%BRANCH%" || goto :fail
  git checkout -B "%BRANCH%" "origin/%BRANCH%" || goto :fail
) else (
  echo [1/4] Checking local source tree...
  git remote set-url origin "%REPO_URL%" >NUL 2>&1
  git diff --quiet || (echo ERROR: Local tracked source files contain changes.&goto :fail)
  git diff --cached --quiet || (echo ERROR: Local staged source changes exist.&goto :fail)
  echo [2/4] Downloading current source from GitHub...
  git fetch origin "%BRANCH%" || goto :fail
  git checkout "%BRANCH%" >NUL 2>&1
  git reset --hard "origin/%BRANCH%" || goto :fail
)
echo [3/4] Removing obsolete untracked source files...
git clean -fd
echo [4/4] Installing/updating dependencies...
call npm install || goto :fail
call npm run build --if-present || goto :fail
echo.
echo UPGRADE COMPLETED SUCCESSFULLY
echo Companion developer module should reload automatically.
exit /b 0
:fail
echo.
echo UPGRADE FAILED
pause
exit /b 1

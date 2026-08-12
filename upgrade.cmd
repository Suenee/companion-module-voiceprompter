@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "REPO_URL=https://github.com/Suenee/companion-module-voiceprompter.git"
set "BRANCH=main"

echo ============================================
echo VoicePrompter Module - GitHub upgrade
echo ============================================
echo.

where git >NUL 2>&1
if errorlevel 1 (
    echo ERROR: Git for Windows is not installed or git.exe is not in PATH.
    goto :fail
)

if not exist ".git" (
    echo [1/4] Converting this installation to a GitHub working copy...
    git init
    if errorlevel 1 goto :fail
    git remote add origin "%REPO_URL%" 2>NUL
    git remote set-url origin "%REPO_URL%"
    git fetch origin "%BRANCH%"
    if errorlevel 1 goto :fail
    rem Replace the old non-Git source tree with the canonical repository state.
    git reset --hard "origin/%BRANCH%"
    if errorlevel 1 goto :fail
    git branch -M "%BRANCH%"
) else (
    echo [1/4] Checking local source tree...
    git remote set-url origin "%REPO_URL%" >NUL 2>&1
    git diff --quiet
    if errorlevel 1 (
        echo ERROR: Local tracked source files contain changes.
        echo Commit/revert them before running upgrade.cmd.
        goto :fail
    )
    git diff --cached --quiet
    if errorlevel 1 (
        echo ERROR: Local staged source changes exist.
        echo Commit/revert them before running upgrade.cmd.
        goto :fail
    )
    echo [2/4] Downloading current source from GitHub...
    git fetch origin "%BRANCH%"
    if errorlevel 1 goto :fail
    git checkout "%BRANCH%" >NUL 2>&1
    if errorlevel 1 git checkout -B "%BRANCH%" "origin/%BRANCH%"
    if errorlevel 1 goto :fail
    git reset --hard "origin/%BRANCH%"
    if errorlevel 1 goto :fail
)

echo [3/4] Removing obsolete untracked source files...
git clean -fd

echo [4/4] Installing/updating dependencies...
call npm install
if errorlevel 1 goto :fail
call npm run build --if-present
if errorlevel 1 goto :fail

echo.
echo ============================================
echo UPGRADE COMPLETED SUCCESSFULLY
echo ============================================
echo Companion developer module should reload automatically.
exit /b 0

:fail
echo.
echo ============================================
echo UPGRADE FAILED
echo ============================================
pause
exit /b 1

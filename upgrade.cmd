@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "REPO_URL=https://github.com/Suenee/companion-module-voiceprompter.git"
set "BRANCH=devel"
set "SELF_URL=https://raw.githubusercontent.com/Suenee/companion-module-voiceprompter/devel/upgrade.cmd"
set "SELF_TMP=%TEMP%\vpm-upgrade-%RANDOM%-%RANDOM%.cmd"

echo ============================================
echo VoicePrompter Module - GitHub DEVEL upgrade
echo ============================================
echo.

echo [SELF] Checking upgrade.cmd version...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -UseBasicParsing -Uri '%SELF_URL%' -OutFile '%SELF_TMP%'" >NUL 2>&1
if errorlevel 1 (
    echo ERROR: Unable to check the latest upgrade.cmd on GitHub.
    if exist "%SELF_TMP%" del /q "%SELF_TMP%" >NUL 2>&1
    goto :fail
)

fc /b "%~f0" "%SELF_TMP%" >NUL 2>&1
if errorlevel 1 (
    echo [SELF] Newer/different upgrade.cmd found. Updating updater first...
    copy /y "%SELF_TMP%" "%~f0" >NUL
    if errorlevel 1 (
        del /q "%SELF_TMP%" >NUL 2>&1
        echo ERROR: Unable to replace upgrade.cmd.
        goto :fail
    )
    del /q "%SELF_TMP%" >NUL 2>&1
    echo [SELF] Restarting with the current updater...
    call "%~f0" --self-updated
    exit /b %errorlevel%
)

del /q "%SELF_TMP%" >NUL 2>&1

echo [SELF] upgrade.cmd is current.
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
    git reset --hard "origin/%BRANCH%"
    if errorlevel 1 goto :fail
    git branch -M "%BRANCH%"
) else (
    echo [1/4] Checking local source tree...
    git remote set-url origin "%REPO_URL%" >NUL 2>&1
    rem upgrade.cmd may legitimately differ because the self-update runs before Git reset.
    git diff --quiet -- . ":(exclude)upgrade.cmd"
    if errorlevel 1 (
        echo ERROR: Local tracked source files contain changes.
        echo Commit/revert them before running upgrade.cmd.
        goto :fail
    )
    git diff --cached --quiet -- . ":(exclude)upgrade.cmd"
    if errorlevel 1 (
        echo ERROR: Local staged source changes exist.
        echo Commit/revert them before running upgrade.cmd.
        goto :fail
    )
    echo [2/4] Downloading current DEVEL source from GitHub...
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
echo DEVEL UPGRADE COMPLETED SUCCESSFULLY
echo ============================================
echo Companion developer module should reload automatically.
exit /b 0

:fail
echo.
echo ============================================
echo DEVEL UPGRADE FAILED
echo ============================================
pause
exit /b 1

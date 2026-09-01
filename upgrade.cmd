@echo off
setlocal EnableExtensions EnableDelayedExpansion
pushd "%~dp0" >NUL 2>&1
if errorlevel 1 (
    echo ERROR: Unable to enter the module directory.
    exit /b 1
)

set "REPO_URL=https://github.com/Suenee/companion-module-voiceprompter.git"
set "BRANCH=devel"
set "SELF_URL=https://raw.githubusercontent.com/Suenee/companion-module-voiceprompter/devel/upgrade.cmd"
set "SELF_TMP=%TEMP%\sum-upgrade-%RANDOM%-%RANDOM%.cmd"
set "DIRTY_TMP=%TEMP%\sum-dirty-%RANDOM%-%RANDOM%.txt"
set "DIRTY_FILTERED=%TEMP%\sum-dirty-filtered-%RANDOM%-%RANDOM%.txt"

echo ============================================
echo Socket Universe Module - GitHub DEVEL upgrade
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
    popd
    call "%~f0" --self-updated
    exit /b %errorlevel%
)

del /q "%SELF_TMP%" >NUL 2>&1
echo [SELF] upgrade.cmd is current.
echo.

where git >NUL 2>&1
if errorlevel 1 (
    echo ERROR: Git for Windows is not installed or git.exe is not in PATH.
    echo For a fresh PC/install run install.cmd instead.
    goto :fail
)

git -c safe.directory=* rev-parse --is-inside-work-tree >NUL 2>&1
if errorlevel 1 (
    echo ERROR: This folder is not a Git working tree.
    echo For a fresh PC/install run install.cmd instead.
    goto :fail
)

echo [1/4] Checking local source tree...
git -c safe.directory=* remote set-url origin "%REPO_URL%" >NUL 2>&1

rem upgrade.cmd may legitimately differ because self-update runs before Git reset.
call :check_tracked_changes
if errorlevel 1 (
    echo ERROR: Local tracked source files contain changes.
    echo Commit/revert them before running upgrade.cmd.
    goto :fail
)
call :check_staged_changes
if errorlevel 1 (
    echo ERROR: Local staged source changes exist.
    echo Commit/revert them before running upgrade.cmd.
    goto :fail
)

echo [2/4] Downloading current DEVEL source from GitHub...
git -c safe.directory=* fetch origin "%BRANCH%"
if errorlevel 1 goto :fail
git -c safe.directory=* checkout "%BRANCH%" >NUL 2>&1
if errorlevel 1 git -c safe.directory=* checkout -B "%BRANCH%" "origin/%BRANCH%"
if errorlevel 1 goto :fail
git -c safe.directory=* reset --hard "origin/%BRANCH%"
if errorlevel 1 goto :fail

echo [3/4] Removing obsolete untracked source files...
git -c safe.directory=* clean -fd

echo [4/4] Installing/updating dependencies...
call npm install
if errorlevel 1 goto :fail
call npm run build --if-present
if errorlevel 1 goto :fail

del /q "%DIRTY_TMP%" "%DIRTY_FILTERED%" >NUL 2>&1
popd
echo.
echo ============================================
echo DEVEL UPGRADE COMPLETED SUCCESSFULLY
echo ============================================
echo Companion developer module should reload automatically.
echo IMPORTANT: Select a manifest in the module configuration. SUM does not connect with Manifest=None.
exit /b 0

:check_tracked_changes
git -c safe.directory=* diff --name-only -- > "%DIRTY_TMP%"
if errorlevel 1 exit /b 1
findstr /V /X /C:"upgrade.cmd" "%DIRTY_TMP%" > "%DIRTY_FILTERED%" 2>NUL
for %%Z in ("%DIRTY_FILTERED%") do if %%~zZ GTR 0 exit /b 1
exit /b 0

:check_staged_changes
git -c safe.directory=* diff --cached --name-only -- > "%DIRTY_TMP%"
if errorlevel 1 exit /b 1
findstr /V /X /C:"upgrade.cmd" "%DIRTY_TMP%" > "%DIRTY_FILTERED%" 2>NUL
for %%Z in ("%DIRTY_FILTERED%") do if %%~zZ GTR 0 exit /b 1
exit /b 0

:fail
del /q "%DIRTY_TMP%" "%DIRTY_FILTERED%" "%SELF_TMP%" >NUL 2>&1
popd
echo.
echo ============================================
echo DEVEL UPGRADE FAILED
echo ============================================
pause
exit /b 1

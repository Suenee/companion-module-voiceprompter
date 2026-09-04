@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "BRANCH=devel"
set "REPO_DIR=%~dp0"
if "%REPO_DIR:~-1%"=="\" set "REPO_DIR=%REPO_DIR:~0,-1%"

if /I "%~1"=="--temp-launcher" (
    set "REPO_DIR=%~2"
    if not defined REPO_DIR (
        echo ERROR: Repository path was not supplied to temporary launcher.
        exit /b 1
    )

    pushd "!REPO_DIR!" >NUL 2>&1
    if errorlevel 1 (
        echo ERROR: Unable to enter repository directory.
        exit /b 1
    )

    echo ============================================
    echo Socket Universe Module - GitHub DEVEL upgrade
    echo ============================================
    echo.
    echo [SELF-UPDATE] Loading authoritative upgrade runner from origin/%BRANCH%...

    where git >NUL 2>&1
    if errorlevel 1 (
        echo ERROR: Git for Windows is not installed or git.exe is not in PATH.
        echo For a fresh PC/install run install.cmd instead.
        popd
        exit /b 1
    )
    where powershell >NUL 2>&1
    if errorlevel 1 (
        echo ERROR: Windows PowerShell is not available.
        popd
        exit /b 1
    )

    set "GIT_CONFIG_COUNT=1"
    set "GIT_CONFIG_KEY_0=safe.directory"
    set "GIT_CONFIG_VALUE_0=!REPO_DIR:\=/!"

    git rev-parse --is-inside-work-tree >NUL 2>&1
    if errorlevel 1 (
        echo ERROR: This folder is not a Git working tree.
        echo For a fresh PC/install run install.cmd instead.
        popd
        exit /b 1
    )

    git fetch origin "%BRANCH%"
    if errorlevel 1 (
        echo ERROR: Unable to fetch origin/%BRANCH%.
        popd
        exit /b 1
    )

    set "TMP_RUNNER=%TEMP%\sum-upgrade-runner-%RANDOM%-%RANDOM%.ps1"
    git show "origin/%BRANCH%:upgrade.ps1" > "!TMP_RUNNER!"
    if errorlevel 1 (
        echo ERROR: Unable to extract current upgrade.ps1 from origin/%BRANCH%.
        if exist "!TMP_RUNNER!" del /q "!TMP_RUNNER!" >NUL 2>&1
        popd
        exit /b 1
    )

    popd
    powershell -NoProfile -ExecutionPolicy Bypass -File "!TMP_RUNNER!" -RepoDir "!REPO_DIR!"
    set "RC=!errorlevel!"
    del /q "!TMP_RUNNER!" >NUL 2>&1
    if not "!RC!"=="0" pause
    exit /b !RC!
)

set "TMP_LAUNCHER=%TEMP%\sum-upgrade-launcher-%RANDOM%-%RANDOM%.cmd"
copy /y "%~f0" "%TMP_LAUNCHER%" >NUL 2>&1
if errorlevel 1 (
    echo ERROR: Unable to create temporary upgrade launcher.
    exit /b 1
)

call "%TMP_LAUNCHER%" --temp-launcher "%REPO_DIR%"
set "RC=!errorlevel!"
del /q "%TMP_LAUNCHER%" >NUL 2>&1
exit /b !RC!

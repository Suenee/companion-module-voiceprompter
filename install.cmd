@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem Socket Universe Module / VoicePrompter Module - fresh PC installer
rem Safe for local, mapped and UNC project folders. Uses a private portable Node 22 runtime.

if /I not "%~1"=="--temp-run" (
    set "SUM_INSTALL_SOURCE=%~dp0"
    set "SUM_INSTALL_TEMP=%TEMP%\sum-install-%RANDOM%-%RANDOM%.cmd"
    copy /y "%~f0" "!SUM_INSTALL_TEMP!" >NUL
    if errorlevel 1 exit /b 1
    call "!SUM_INSTALL_TEMP!" --temp-run "!SUM_INSTALL_SOURCE!"
    set "SUM_INSTALL_RC=!ERRORLEVEL!"
    del /q "!SUM_INSTALL_TEMP!" >NUL 2>&1
    exit /b !SUM_INSTALL_RC!
)

set "TARGET=%~2"
if not defined TARGET set "TARGET=%CD%"
if "!TARGET:~-1!"=="\" set "TARGET=!TARGET:~0,-1!"
set "REPO_URL=https://github.com/Suenee/companion-module-voiceprompter.git"
set "BRANCH=devel"
set "NODE_VERSION=22.20.0"
set "NODE_HOME=%LOCALAPPDATA%\SocketUniverse\node-v%NODE_VERSION%-win-x64"
set "NODE_ZIP=%TEMP%\node-v%NODE_VERSION%-win-x64-%RANDOM%.zip"
set "NODE_URL=https://nodejs.org/dist/v%NODE_VERSION%/node-v%NODE_VERSION%-win-x64.zip"
set "DIRTY_TMP=%TEMP%\sum-install-dirty-%RANDOM%-%RANDOM%.txt"
set "DIRTY_FILTERED=%TEMP%\sum-install-dirty-filtered-%RANDOM%-%RANDOM%.txt"
set "PUSHED=0"

echo ============================================
echo Socket Universe Module - FRESH INSTALL
echo ============================================
echo Target: !TARGET!
echo.

where powershell.exe >NUL 2>&1
if errorlevel 1 goto :powershell_missing
call :ensure_git
if errorlevel 1 goto :fail
call :ensure_node22
if errorlevel 1 goto :fail

set "PATH=!NODE_HOME!;!PATH!"
where node.exe >NUL 2>&1
if errorlevel 1 goto :node_missing
where npm.cmd >NUL 2>&1
if errorlevel 1 goto :npm_missing

for /f "delims=" %%V in ('node --version') do set "NODE_ACTUAL=%%V"
for /f "delims=" %%V in ('npm --version') do set "NPM_ACTUAL=%%V"
echo Node: !NODE_ACTUAL!  [private runtime]
echo npm:  !NPM_ACTUAL!
echo.

if not exist "!TARGET!" mkdir "!TARGET!"
if errorlevel 1 goto :target_create_failed
pushd "!TARGET!" >NUL 2>&1
if errorlevel 1 goto :target_enter_failed
set "PUSHED=1"

if exist ".git" goto :existing_repo

call :folder_is_bootstrap_safe
if errorlevel 1 goto :unsafe_folder

echo [1/5] Creating DEVEL working copy...
git -c safe.directory=* init
if errorlevel 1 goto :fail
git -c safe.directory=* remote add origin "!REPO_URL!" 2>NUL
git -c safe.directory=* remote set-url origin "!REPO_URL!"
if errorlevel 1 goto :fail
git -c safe.directory=* fetch origin "!BRANCH!"
if errorlevel 1 goto :fail
git -c safe.directory=* checkout -f -B "!BRANCH!" "origin/!BRANCH!"
if errorlevel 1 goto :fail
goto :repo_ready

:existing_repo
echo [1/5] Updating existing DEVEL working copy...
git -c safe.directory=* rev-parse --is-inside-work-tree >NUL 2>&1
if errorlevel 1 goto :invalid_repo
git -c safe.directory=* remote set-url origin "!REPO_URL!"
if errorlevel 1 goto :fail
call :check_local_changes
if errorlevel 1 goto :dirty_repo
git -c safe.directory=* fetch origin "!BRANCH!"
if errorlevel 1 goto :fail
git -c safe.directory=* checkout -f -B "!BRANCH!" "origin/!BRANCH!"
if errorlevel 1 goto :fail

:repo_ready
echo [2/5] Verifying source tree...
if not exist "package.json" goto :package_missing
if not exist "main.js" goto :main_missing
if not exist "companion\manifest.json" goto :manifest_missing

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$p=Get-Content -LiteralPath 'package.json' -Raw | ConvertFrom-Json; if($p.engines.node -ne '^22.20'){exit 2}"
if errorlevel 1 goto :engine_changed
echo Required Node engine: ^22.20

echo [3/5] Installing dependencies...
call npm install --no-audit --no-fund
if errorlevel 1 goto :fail

echo [4/5] Validating Companion module package...
call npm run package
if errorlevel 1 goto :fail

echo [5/5] Final verification...
if not exist "node_modules\@companion-module\base" goto :base_missing
if not exist "node_modules\@companion-module\tools" goto :tools_missing
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$m=Get-Content -LiteralPath 'companion\manifest.json' -Raw | ConvertFrom-Json; if($m.runtime.type -ne 'node22' -or $m.runtime.entrypoint -ne '../main.js'){exit 3}"
if errorlevel 1 goto :manifest_invalid
for /f "delims=" %%H in ('git -c safe.directory^=* rev-parse HEAD') do set "HEAD_SHA=%%H"
for /f "delims=" %%H in ('git -c safe.directory^=* rev-parse origin/!BRANCH!') do set "ORIGIN_SHA=%%H"
if /I not "!HEAD_SHA!"=="!ORIGIN_SHA!" goto :head_mismatch

call :cleanup
echo.
echo ============================================
echo INSTALL OK
echo ============================================
echo SUM/VPM is ready for Bitfocus Companion.
echo Project: !TARGET!
echo Commit:  !HEAD_SHA!
echo Node:    !NODE_ACTUAL! ^(private, installer-managed^)
echo.
echo In Companion select this developer module folder and its manifest.
echo Manifest: companion\manifest.json
exit /b 0

:ensure_git
where git.exe >NUL 2>&1
if not errorlevel 1 exit /b 0
echo Git for Windows not found. Installing...
where winget.exe >NUL 2>&1
if errorlevel 1 goto :git_winget_missing
winget install --id Git.Git --exact --accept-package-agreements --accept-source-agreements --silent
if errorlevel 1 exit /b 1
set "PATH=%ProgramFiles%\Git\cmd;!PATH!"
where git.exe >NUL 2>&1
if errorlevel 1 goto :git_install_unavailable
exit /b 0

:ensure_node22
if exist "!NODE_HOME!\node.exe" if exist "!NODE_HOME!\npm.cmd" exit /b 0
echo Installing private Node.js !NODE_VERSION! runtime...
if exist "!NODE_HOME!" rmdir /s /q "!NODE_HOME!"
if not exist "%LOCALAPPDATA%\SocketUniverse" mkdir "%LOCALAPPDATA%\SocketUniverse"
if errorlevel 1 exit /b 1
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -UseBasicParsing -Uri '!NODE_URL!' -OutFile '!NODE_ZIP!'; Expand-Archive -LiteralPath '!NODE_ZIP!' -DestinationPath '%LOCALAPPDATA%\SocketUniverse' -Force"
if errorlevel 1 goto :node_download_failed
del /q "!NODE_ZIP!" >NUL 2>&1
if not exist "!NODE_HOME!\node.exe" goto :node_extract_failed
exit /b 0

:folder_is_bootstrap_safe
set "UNSAFE=0"
for /f "delims=" %%F in ('dir /b /a 2^>NUL') do (
    if /I not "%%F"=="install.cmd" if /I not "%%F"=="logs" set "UNSAFE=1"
)
if "!UNSAFE!"=="1" exit /b 1
exit /b 0

:check_local_changes
git -c safe.directory=* diff --name-only -- > "!DIRTY_TMP!"
if errorlevel 1 exit /b 1
findstr /V /X /C:"install.cmd" /C:"upgrade.cmd" "!DIRTY_TMP!" > "!DIRTY_FILTERED!" 2>NUL
for %%Z in ("!DIRTY_FILTERED!") do if %%~zZ GTR 0 exit /b 1
git -c safe.directory=* diff --cached --name-only -- > "!DIRTY_TMP!"
if errorlevel 1 exit /b 1
findstr /V /X /C:"install.cmd" /C:"upgrade.cmd" "!DIRTY_TMP!" > "!DIRTY_FILTERED!" 2>NUL
for %%Z in ("!DIRTY_FILTERED!") do if %%~zZ GTR 0 exit /b 1
exit /b 0

:powershell_missing
echo ERROR: Windows PowerShell is required.
goto :fail
:node_missing
echo ERROR: Private Node 22 runtime is unavailable.
goto :fail
:npm_missing
echo ERROR: npm is unavailable in the private Node 22 runtime.
goto :fail
:target_create_failed
echo ERROR: Cannot create target directory.
goto :fail
:target_enter_failed
echo ERROR: Cannot enter target directory.
goto :fail
:unsafe_folder
echo ERROR: Target is not an empty/bootstrap folder.
echo Keep only install.cmd ^(and optionally logs^) or use an existing Git checkout.
goto :fail
:invalid_repo
echo ERROR: Invalid Git working copy.
goto :fail
:dirty_repo
echo ERROR: Tracked local source changes exist.
echo Commit or revert them before reinstalling.
goto :fail
:package_missing
echo ERROR: package.json is missing.
goto :fail
:main_missing
echo ERROR: main.js is missing.
goto :fail
:manifest_missing
echo ERROR: companion\manifest.json is missing.
goto :fail
:engine_changed
echo ERROR: package.json Node engine changed from ^22.20. Installer must be reviewed.
goto :fail
:base_missing
echo ERROR: Companion base dependency is missing.
goto :fail
:tools_missing
echo ERROR: Companion tools dependency is missing.
goto :fail
:manifest_invalid
echo ERROR: Companion manifest runtime validation failed.
goto :fail
:head_mismatch
echo ERROR: Local HEAD differs from origin/!BRANCH!.
goto :fail
:git_winget_missing
echo ERROR: winget is required to install Git automatically.
exit /b 1
:git_install_unavailable
echo ERROR: Git was installed but is not available.
exit /b 1
:node_download_failed
del /q "!NODE_ZIP!" >NUL 2>&1
echo ERROR: Unable to download/extract Node.js !NODE_VERSION!.
exit /b 1
:node_extract_failed
echo ERROR: Node.js runtime extraction failed.
exit /b 1

:cleanup
del /q "!DIRTY_TMP!" "!DIRTY_FILTERED!" >NUL 2>&1
if "!PUSHED!"=="1" popd
set "PUSHED=0"
exit /b 0

:fail
call :cleanup
echo.
echo ============================================
echo INSTALL FAILED
echo ============================================
exit /b 1

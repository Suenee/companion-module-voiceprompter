@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem Socket Universe Module / VoicePrompter Module - fresh PC installer
rem Safe for local, mapped and UNC project folders. Uses a private portable Node 22 runtime.

if /I not "%~1"=="--temp-run" (
    set "SUM_INSTALL_SOURCE=%~dp0"
    set "SUM_INSTALL_TEMP=%TEMP%\sum-install-%RANDOM%-%RANDOM%.cmd"
    copy /y "%~f0" "!SUM_INSTALL_TEMP!" >NUL || exit /b 1
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

echo ============================================
echo Socket Universe Module - FRESH INSTALL
echo ============================================
echo Target: !TARGET!
echo.

where powershell.exe >NUL 2>&1 || (
    echo ERROR: Windows PowerShell is required.
    goto :fail
)

call :ensure_git || goto :fail
call :ensure_node22 || goto :fail

set "PATH=!NODE_HOME!;!PATH!"
where node.exe >NUL 2>&1 || (echo ERROR: Private Node 22 runtime is unavailable.& goto :fail)
where npm.cmd >NUL 2>&1 || (echo ERROR: npm is unavailable in the private Node 22 runtime.& goto :fail)

for /f "delims=" %%V in ('node --version') do set "NODE_ACTUAL=%%V"
echo Node: !NODE_ACTUAL!  [private runtime]
for /f "delims=" %%V in ('npm --version') do set "NPM_ACTUAL=%%V"
echo npm:  !NPM_ACTUAL!
echo.

if not exist "!TARGET!" mkdir "!TARGET!" || goto :fail
pushd "!TARGET!" || (echo ERROR: Cannot enter target directory.& goto :fail)

if exist ".git" goto :existing_repo

call :folder_is_bootstrap_safe
if errorlevel 1 (
    echo ERROR: Target is not an empty/bootstrap folder.
    echo Keep only install.cmd ^(and optionally logs^) or use an existing Git checkout.
    popd
    goto :fail
)

echo [1/5] Creating DEVEL working copy...
git -c safe.directory=* init || (popd& goto :fail)
git -c safe.directory=* remote add origin "!REPO_URL!" 2>NUL
git -c safe.directory=* remote set-url origin "!REPO_URL!" || (popd& goto :fail)
git -c safe.directory=* fetch origin "!BRANCH!" || (popd& goto :fail)
git -c safe.directory=* checkout -f -B "!BRANCH!" "origin/!BRANCH!" || (popd& goto :fail)
goto :repo_ready

:existing_repo
echo [1/5] Updating existing DEVEL working copy...
git -c safe.directory=* rev-parse --is-inside-work-tree >NUL 2>&1 || (echo ERROR: Invalid Git working copy.& popd& goto :fail)
git -c safe.directory=* remote set-url origin "!REPO_URL!" || (popd& goto :fail)
for /f "delims=" %%S in ('git -c safe.directory^=* status --porcelain --untracked-files=no') do (
    echo ERROR: Tracked local changes exist: %%S
    echo Commit or revert them before reinstalling.
    popd
    goto :fail
)
git -c safe.directory=* fetch origin "!BRANCH!" || (popd& goto :fail)
git -c safe.directory=* checkout -f -B "!BRANCH!" "origin/!BRANCH!" || (popd& goto :fail)

:repo_ready
echo [2/5] Verifying source tree...
if not exist "package.json" (echo ERROR: package.json is missing.& popd& goto :fail)
if not exist "main.js" (echo ERROR: main.js is missing.& popd& goto :fail)
if not exist "companion\manifest.json" (echo ERROR: companion\manifest.json is missing.& popd& goto :fail)

for /f "delims=" %%V in ('node -p "require('./package.json').engines.node"') do set "NODE_ENGINE=%%V"
echo Required Node engine: !NODE_ENGINE!
node -e "const e=require('./package.json').engines.node;if(!/^\^22\.20/.test(e))process.exit(2)" || (
    echo ERROR: package.json Node engine changed. Installer must be reviewed before continuing.
    popd
    goto :fail
)

echo [3/5] Installing dependencies...
call npm install --no-audit --no-fund || (popd& goto :fail)

echo [4/5] Validating Companion module package...
call npm run package || (popd& goto :fail)

echo [5/5] Final verification...
if not exist "node_modules\@companion-module\base" (echo ERROR: Companion base dependency is missing.& popd& goto :fail)
if not exist "node_modules\@companion-module\tools" (echo ERROR: Companion tools dependency is missing.& popd& goto :fail)
node -e "const m=require('fs').readFileSync('companion/manifest.json','utf8');const j=JSON.parse(m);if(j.runtime?.type!=='node22'||j.runtime?.entrypoint!=='../main.js')process.exit(3)" || (
    echo ERROR: Companion manifest runtime validation failed.
    popd
    goto :fail
)
for /f "delims=" %%H in ('git -c safe.directory^=* rev-parse HEAD') do set "HEAD_SHA=%%H"
for /f "delims=" %%H in ('git -c safe.directory^=* rev-parse origin/!BRANCH!') do set "ORIGIN_SHA=%%H"
if /I not "!HEAD_SHA!"=="!ORIGIN_SHA!" (
    echo ERROR: Local HEAD differs from origin/!BRANCH!.
    popd
    goto :fail
)
popd

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
where git.exe >NUL 2>&1 && exit /b 0
echo Git for Windows not found. Installing...
where winget.exe >NUL 2>&1 || (echo ERROR: winget is required to install Git automatically.& exit /b 1)
winget install --id Git.Git --exact --accept-package-agreements --accept-source-agreements --silent
if errorlevel 1 exit /b 1
set "PATH=%ProgramFiles%\Git\cmd;!PATH!"
where git.exe >NUL 2>&1 || (echo ERROR: Git was installed but is not available.& exit /b 1)
exit /b 0

:ensure_node22
if exist "!NODE_HOME!\node.exe" if exist "!NODE_HOME!\npm.cmd" exit /b 0
echo Installing private Node.js !NODE_VERSION! runtime...
if exist "!NODE_HOME!" rmdir /s /q "!NODE_HOME!"
if not exist "%LOCALAPPDATA%\SocketUniverse" mkdir "%LOCALAPPDATA%\SocketUniverse" || exit /b 1
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -UseBasicParsing -Uri '!NODE_URL!' -OutFile '!NODE_ZIP!'; Expand-Archive -LiteralPath '!NODE_ZIP!' -DestinationPath '%LOCALAPPDATA%\SocketUniverse' -Force"
if errorlevel 1 (
    del /q "!NODE_ZIP!" >NUL 2>&1
    echo ERROR: Unable to download/extract Node.js !NODE_VERSION!.
    exit /b 1
)
del /q "!NODE_ZIP!" >NUL 2>&1
if not exist "!NODE_HOME!\node.exe" (echo ERROR: Node.js runtime extraction failed.& exit /b 1)
exit /b 0

:folder_is_bootstrap_safe
set "UNSAFE=0"
for /f "delims=" %%F in ('dir /b /a 2^>NUL') do (
    if /I not "%%F"=="install.cmd" if /I not "%%F"=="logs" set "UNSAFE=1"
)
if "!UNSAFE!"=="1" exit /b 1
exit /b 0

:fail
echo.
echo ============================================
echo INSTALL FAILED
echo ============================================
exit /b 1

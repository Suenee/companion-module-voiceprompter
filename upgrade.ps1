param(
    [Parameter(Mandatory = $true)]
    [string]$RepoDir
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$RepoUrl = 'https://github.com/Suenee/companion-module-voiceprompter.git'
$Branch = 'devel'
$UpdaterRevision = '4'
$RepoDir = [System.IO.Path]::GetFullPath($RepoDir).TrimEnd('\')
$LogDir = Join-Path $RepoDir 'logs'
$LogFile = Join-Path $LogDir 'upgrade.log'
$Phase = 'BOOTSTRAP'
$HadWarning = $false
$Mutex = $null
$MutexOwned = $false

function Write-Log {
    param([string]$Message = '')
    $line = if ($Message) { "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message } else { '' }
    Write-Host $line
    Add-Content -LiteralPath $LogFile -Value $line -Encoding UTF8
}

function Set-Phase {
    param([string]$Name)
    $script:Phase = $Name
    Write-Log "PHASE: $Name"
}

function Fail {
    param([string]$Message)
    throw $Message
}

function Invoke-Native {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments
    )
    Write-Log ("RUN: {0} {1}" -f $FilePath, ($Arguments -join ' '))
    $output = & $FilePath @Arguments 2>&1
    $code = $LASTEXITCODE
    foreach ($line in @($output)) {
        $text = [string]$line
        Write-Host $text
        Add-Content -LiteralPath $LogFile -Value $text -Encoding UTF8
    }
    if ($code -ne 0) { Fail "$FilePath failed with exit code $code" }
    return @($output)
}

function Get-GitText {
    param([string[]]$Arguments)
    $value = & git @Arguments 2>$null
    if ($LASTEXITCODE -ne 0) { return $null }
    return (($value | Out-String).Trim())
}

function Get-TrackedChanges {
    $rows = & git status --porcelain --untracked-files=no 2>&1
    if ($LASTEXITCODE -ne 0) { Fail 'Unable to inspect local tracked changes.' }
    $paths = @()
    foreach ($row in @($rows)) {
        $text = [string]$row
        if ($text.Length -lt 4) { continue }
        $path = $text.Substring(3).Trim()
        if ($path -match ' -> ') { $path = ($path -split ' -> ')[-1] }
        $path = $path.Trim('"') -replace '/', '\'
        if ($path) { $paths += $path }
    }
    return $paths | Sort-Object -Unique
}

try {
    New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
    Set-Content -LiteralPath $LogFile -Value '' -Encoding UTF8

    Write-Log 'Socket Universe Module - GitHub DEVEL upgrade'
    Write-Log "Updater revision: $UpdaterRevision"
    Write-Log "Repository: $RepoDir"
    Write-Log "Target branch: $Branch"

    $mutexKeyBytes = [Text.Encoding]::UTF8.GetBytes($RepoDir.ToLowerInvariant())
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $mutexKey = ([BitConverter]::ToString($sha.ComputeHash($mutexKeyBytes))).Replace('-', '') } finally { $sha.Dispose() }
    $Mutex = New-Object System.Threading.Mutex($false, "Global\SUMUpgrade_$mutexKey")
    try {
        $MutexOwned = $Mutex.WaitOne(0)
    }
    catch [System.Threading.AbandonedMutexException] {
        $MutexOwned = $true
        $HadWarning = $true
        Write-Log 'WARNING: Recovered an abandoned upgrade lock from a previous interrupted run.'
    }
    if (-not $MutexOwned) { Fail 'Another upgrade is already running for this repository.' }

    Push-Location -LiteralPath $RepoDir
    try {
        Set-Phase 'REPOSITORY'

        if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Fail 'Git for Windows is not installed or git.exe is not in PATH. For a fresh installation run install.cmd.' }
        Write-Log ("Git: " + ((& git --version) -join ' '))

        # Process-scoped safe.directory exception for this exact repository only.
        $env:GIT_CONFIG_COUNT = '1'
        $env:GIT_CONFIG_KEY_0 = 'safe.directory'
        $env:GIT_CONFIG_VALUE_0 = $RepoDir.Replace('\', '/')

        $inside = Get-GitText @('rev-parse', '--is-inside-work-tree')
        if ($inside -ne 'true') { Fail 'This folder is not a Git working tree. For a fresh installation run install.cmd.' }

        $startCommit = Get-GitText @('rev-parse', 'HEAD')
        Write-Log "Starting commit: $startCommit"

        # A missing upgrade.ps1 is expected on pre-runner revisions. Probe without
        # inheriting ErrorActionPreference=Stop from native stderr output.
        $legacyProbe = & git cat-file -e 'HEAD:upgrade.ps1' 2>$null
        $legacyUpdaterTree = ($LASTEXITCODE -ne 0)

        Invoke-Native git @('remote', 'set-url', 'origin', $RepoUrl) | Out-Null
        Invoke-Native git @('fetch', 'origin', $Branch) | Out-Null

        $dirty = @(Get-TrackedChanges)
        $unexpected = @($dirty | Where-Object { $_ -ine 'upgrade.cmd' -or -not $legacyUpdaterTree })
        if ($unexpected.Count -gt 0) {
            Write-Log ('Tracked local changes: ' + ($unexpected -join ', '))
            Fail 'Local tracked source changes exist. Commit or revert them before upgrading.'
        }
        if ($legacyUpdaterTree -and $dirty -contains 'upgrade.cmd') {
            $HadWarning = $true
            Write-Log 'WARNING: Local upgrade.cmd differs from the legacy index. It is the known recoverable self-update artifact and will be replaced from origin/devel.'
        }

        # The active launcher and this runner execute from TEMP, so replacing repository updater files is safe.
        Invoke-Native git @('checkout', '-B', $Branch, "origin/$Branch", '--force') | Out-Null

        $activeBranch = Get-GitText @('branch', '--show-current')
        if ($activeBranch -ne $Branch) { Fail "Active branch is '$activeBranch', expected '$Branch'." }
        $head = Get-GitText @('rev-parse', 'HEAD')
        $remoteHead = Get-GitText @('rev-parse', "origin/$Branch")
        if (-not $head -or $head -ne $remoteHead) { Fail 'Repository synchronization verification failed: HEAD does not equal origin/devel.' }
        Write-Log "Synchronized commit: $head"

        Set-Phase 'DEPENDENCIES'
        if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { Fail 'npm is not installed or not in PATH.' }
        Write-Log ("Node: " + ((& node --version) -join ' '))
        Write-Log ("npm: " + ((& npm --version) -join ' '))
        Invoke-Native npm @('install') | Out-Null

        Set-Phase 'BUILD'
        Invoke-Native npm @('run', 'build', '--if-present') | Out-Null

        Set-Phase 'VERIFY'
        $package = Get-Content -LiteralPath (Join-Path $RepoDir 'package.json') -Raw | ConvertFrom-Json
        $manifest = Get-Content -LiteralPath (Join-Path $RepoDir 'companion\manifest.json') -Raw | ConvertFrom-Json
        $mainText = Get-Content -LiteralPath (Join-Path $RepoDir 'main.js') -Raw
        $mainMatch = [regex]::Match($mainText, "const MODULE_VERSION = '([^']+)'" )
        if (-not $mainMatch.Success) { Fail 'Cannot verify MODULE_VERSION in main.js.' }
        $mainVersion = $mainMatch.Groups[1].Value
        if ([string]$package.version -ne [string]$manifest.version -or [string]$package.version -ne $mainVersion) {
            Fail "Version mismatch: package=$($package.version), companion=$($manifest.version), main=$mainVersion"
        }
        Write-Log "Verified SUM version: $mainVersion"
        if (-not (Test-Path -LiteralPath (Join-Path $RepoDir 'upgrade.cmd'))) { Fail 'upgrade.cmd is missing after synchronization.' }
        if (-not (Test-Path -LiteralPath (Join-Path $RepoDir 'upgrade.ps1'))) { Fail 'upgrade.ps1 is missing after synchronization.' }

        Set-Phase 'COMPLETE'
        if ($HadWarning) {
            Write-Log 'STATUS: WARNING - phase=COMPLETE'
            Write-Host ''
            Write-Host '============================================'
            Write-Host 'DEVEL UPGRADE COMPLETED WITH WARNING'
            Write-Host '============================================'
        } else {
            Write-Log 'STATUS: SUCCESS - phase=COMPLETE'
            Write-Host ''
            Write-Host '============================================'
            Write-Host 'DEVEL UPGRADE COMPLETED SUCCESSFULLY'
            Write-Host '============================================'
        }
        Write-Host 'Companion developer module should reload automatically.'
        Write-Host 'IMPORTANT: Select a manifest in the module configuration. SUM does not connect with Manifest=None.'
        exit 0
    }
    finally {
        Pop-Location
    }
}
catch {
    try { Write-Log ("ERROR: " + $_.Exception.Message) } catch { Write-Host ("ERROR: " + $_.Exception.Message) }
    try { Write-Log "STATUS: FAILED - phase=$Phase" } catch {}
    Write-Host ''
    Write-Host '============================================'
    Write-Host 'DEVEL UPGRADE FAILED'
    Write-Host '============================================'
    Write-Host "Phase: $Phase"
    Write-Host "Log: $LogFile"
    exit 1
}
finally {
    if ($Mutex) {
        if ($MutexOwned) { try { $Mutex.ReleaseMutex() } catch {} }
        $Mutex.Dispose()
    }
}

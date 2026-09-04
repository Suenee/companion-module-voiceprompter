param(
    [Parameter(Mandatory = $true)]
    [string]$RepoDir
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$RepoUrl = 'https://github.com/Suenee/companion-module-voiceprompter.git'
$Branch = 'devel'
$UpdaterRevision = '9'
$RepoDir = [System.IO.Path]::GetFullPath($RepoDir).TrimEnd('\')
$LogDir = Join-Path $RepoDir 'logs'
$LogFile = Join-Path $LogDir 'upgrade.log'
$Phase = 'BOOTSTRAP'
$HadWarning = $false
$Mutex = $null
$MutexOwned = $false
$ResultVersion = $null

function Write-Log {
    param(
        [string]$Message = '',
        [ConsoleColor]$Color = [ConsoleColor]::Gray
    )
    $line = if ($Message) { "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message } else { '' }
    Write-Host $line -ForegroundColor $Color
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

function Format-ProcessArgument {
    param([string]$Value)
    if ($null -eq $Value) { return '""' }
    if ($Value -notmatch '[\s"]') { return $Value }
    return '"' + $Value.Replace('"', '\"') + '"'
}

function Invoke-ExternalProcess {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [string[]]$Arguments = @(),
        [int[]]$AllowedExitCodes = @(0),
        [switch]$QuietCommand,
        [switch]$QuietOutput
    )

    $argumentText = (($Arguments | ForEach-Object { Format-ProcessArgument ([string]$_) }) -join ' ')
    if (-not $QuietCommand) { Write-Log (("RUN: {0} {1}" -f $FilePath, $argumentText).TrimEnd()) }

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $extension = [System.IO.Path]::GetExtension($FilePath)
    if ($extension -ieq '.cmd' -or $extension -ieq '.bat') {
        $psi.FileName = $env:ComSpec
        if (-not $psi.FileName) { $psi.FileName = 'cmd.exe' }
        $tool = '"' + $FilePath + '"'
        $inner = if ($argumentText) { "$tool $argumentText" } else { $tool }
        $psi.Arguments = '/d /s /c "' + $inner + '"'
    }
    else {
        $psi.FileName = $FilePath
        $psi.Arguments = $argumentText
    }
    $psi.WorkingDirectory = $RepoDir
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $psi
    try {
        if (-not $process.Start()) { Fail "Unable to start $FilePath" }
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        $process.WaitForExit()
        $stdout = $stdoutTask.Result
        $stderr = $stderrTask.Result
        $exitCode = $process.ExitCode
    }
    finally {
        $process.Dispose()
    }

    if (-not $QuietOutput) {
        foreach ($stream in @($stdout, $stderr)) {
            if ([string]::IsNullOrEmpty($stream)) { continue }
            foreach ($line in ($stream -split "`r?`n")) {
                if ($line -eq '') { continue }
                Write-Host $line -ForegroundColor Gray
                Add-Content -LiteralPath $LogFile -Value $line -Encoding UTF8
            }
        }
    }

    if ($AllowedExitCodes -notcontains $exitCode) {
        $details = ($stderr.Trim())
        if (-not $details) { $details = ($stdout.Trim()) }
        if ($details) { Fail "$FilePath failed with exit code $exitCode`: $details" }
        Fail "$FilePath failed with exit code $exitCode"
    }

    return [pscustomobject]@{
        ExitCode = $exitCode
        StdOut = $stdout
        StdErr = $stderr
    }
}

function Get-GitText {
    param([string[]]$Arguments)
    $result = Invoke-ExternalProcess -FilePath $script:GitExe -Arguments $Arguments -QuietCommand -QuietOutput
    return $result.StdOut.Trim()
}

function Get-TrackedChanges {
    $result = Invoke-ExternalProcess -FilePath $script:GitExe -Arguments @('status', '--porcelain', '--untracked-files=no') -QuietCommand -QuietOutput
    $paths = @()
    foreach ($row in ($result.StdOut -split "`r?`n")) {
        if ($row.Length -lt 4) { continue }
        $path = $row.Substring(3).Trim()
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
        Write-Log 'WARNING: Recovered an abandoned upgrade lock from a previous interrupted run.' Yellow
    }
    if (-not $MutexOwned) { Fail 'Another upgrade is already running for this repository.' }

    Push-Location -LiteralPath $RepoDir
    try {
        Set-Phase 'REPOSITORY'

        $gitCommand = Get-Command git.exe -ErrorAction SilentlyContinue
        if (-not $gitCommand) { Fail 'Git for Windows is not installed or git.exe is not in PATH. For a fresh installation run install.cmd.' }
        $script:GitExe = $gitCommand.Source

        $env:GIT_CONFIG_COUNT = '1'
        $env:GIT_CONFIG_KEY_0 = 'safe.directory'
        $env:GIT_CONFIG_VALUE_0 = $RepoDir.Replace('\', '/')

        $gitVersion = Invoke-ExternalProcess -FilePath $script:GitExe -Arguments @('--version') -QuietCommand -QuietOutput
        Write-Log ("Git: " + $gitVersion.StdOut.Trim())

        $inside = Get-GitText @('rev-parse', '--is-inside-work-tree')
        if ($inside -ne 'true') { Fail 'This folder is not a Git working tree. For a fresh installation run install.cmd.' }

        $startCommit = Get-GitText @('rev-parse', 'HEAD')
        Write-Log "Starting commit: $startCommit"

        Invoke-ExternalProcess -FilePath $script:GitExe -Arguments @('remote', 'set-url', 'origin', $RepoUrl) | Out-Null
        Invoke-ExternalProcess -FilePath $script:GitExe -Arguments @('fetch', 'origin', $Branch) | Out-Null

        $dirty = @(Get-TrackedChanges)
        $unexpected = @($dirty | Where-Object { $_ -ine 'upgrade.cmd' })
        if ($unexpected.Count -gt 0) {
            Write-Log ('Tracked local changes: ' + ($unexpected -join ', ')) Yellow
            Fail 'Local tracked source changes exist. Commit or revert them before upgrading.'
        }

        # upgrade.cmd is updater-owned bootstrap state. It must never block recovery of an old installation.
        # If it is locally dirty, preserve the exact current file before authoritative branch synchronization.
        if ($dirty -contains 'upgrade.cmd') {
            $recoveryDir = Join-Path $LogDir 'recovery'
            $recoveryFile = Join-Path $recoveryDir 'upgrade.cmd.before-sync'
            New-Item -ItemType Directory -Force -Path $recoveryDir | Out-Null
            Copy-Item -LiteralPath (Join-Path $RepoDir 'upgrade.cmd') -Destination $recoveryFile -Force
            $HadWarning = $true
            Write-Log "WARNING: Preserved locally modified upgrade.cmd at $recoveryFile before authoritative synchronization." Yellow
        }

        # This runner executes from TEMP. The target branch is authoritative for updater-owned files.
        Invoke-ExternalProcess -FilePath $script:GitExe -Arguments @('checkout', '-B', $Branch, "origin/$Branch", '--force') | Out-Null

        $activeBranch = Get-GitText @('branch', '--show-current')
        if ($activeBranch -ne $Branch) { Fail "Active branch is '$activeBranch', expected '$Branch'." }
        $head = Get-GitText @('rev-parse', 'HEAD')
        $remoteHead = Get-GitText @('rev-parse', "origin/$Branch")
        if (-not $head -or $head -ne $remoteHead) { Fail 'Repository synchronization verification failed: HEAD does not equal origin/devel.' }
        Write-Log "Synchronized commit: $head"

        Set-Phase 'DEPENDENCIES'
        $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
        $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
        if (-not $nodeCommand) { Fail 'Node.js is not installed or node.exe is not in PATH.' }
        if (-not $npmCommand) { Fail 'npm is not installed or npm.cmd is not in PATH.' }
        $nodeExe = $nodeCommand.Source
        $npmCmd = $npmCommand.Source

        $nodeVersion = Invoke-ExternalProcess -FilePath $nodeExe -Arguments @('--version') -QuietCommand -QuietOutput
        $npmVersion = Invoke-ExternalProcess -FilePath $npmCmd -Arguments @('--version') -QuietCommand -QuietOutput
        Write-Log ("Node: " + $nodeVersion.StdOut.Trim())
        Write-Log ("npm: " + $npmVersion.StdOut.Trim())
        Invoke-ExternalProcess -FilePath $npmCmd -Arguments @('install') | Out-Null

        Set-Phase 'BUILD'
        Invoke-ExternalProcess -FilePath $npmCmd -Arguments @('run', 'build', '--if-present') | Out-Null

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
        $ResultVersion = $mainVersion
        Write-Log "Verified SUM version: $mainVersion"
        if (-not (Test-Path -LiteralPath (Join-Path $RepoDir 'upgrade.cmd'))) { Fail 'upgrade.cmd is missing after synchronization.' }
        if (-not (Test-Path -LiteralPath (Join-Path $RepoDir 'upgrade.ps1'))) { Fail 'upgrade.ps1 is missing after synchronization.' }

        Set-Phase 'COMPLETE'
        Write-Log "RESULT VERSION: $ResultVersion" $(if ($HadWarning) { 'Yellow' } else { 'Green' })
        if ($HadWarning) {
            Write-Log 'STATUS: WARNING - phase=COMPLETE' Yellow
            Write-Host ''
            Write-Host '============================================' -ForegroundColor Yellow
            Write-Host 'SUM DEVEL UPGRADE COMPLETED WITH WARNING' -ForegroundColor Yellow
            Write-Host '============================================' -ForegroundColor Yellow
            Write-Host 'Status: WARNING' -ForegroundColor Yellow
            Write-Host "Version: $ResultVersion" -ForegroundColor Yellow
        } else {
            Write-Log 'STATUS: SUCCESS - phase=COMPLETE' Green
            Write-Host ''
            Write-Host '============================================' -ForegroundColor Green
            Write-Host 'SUM DEVEL UPGRADE COMPLETED SUCCESSFULLY' -ForegroundColor Green
            Write-Host '============================================' -ForegroundColor Green
            Write-Host 'Status: SUCCESS' -ForegroundColor Green
            Write-Host "Version: $ResultVersion" -ForegroundColor Green
        }
        Write-Host 'Phase: COMPLETE' -ForegroundColor Gray
        Write-Host "Log: $LogFile" -ForegroundColor Gray
        Write-Host 'Companion developer module should reload automatically.' -ForegroundColor Gray
        Write-Host 'IMPORTANT: Manifest, IP Address, Port, and Socket Box are required connection settings.' -ForegroundColor Yellow
        exit 0
    }
    finally {
        Pop-Location
    }
}
catch {
    $failedVersion = 'unknown'
    try {
        $failedPackagePath = Join-Path $RepoDir 'package.json'
        if (Test-Path -LiteralPath $failedPackagePath) {
            $failedPackage = Get-Content -LiteralPath $failedPackagePath -Raw | ConvertFrom-Json
            if ($failedPackage.version) { $failedVersion = [string]$failedPackage.version }
        }
    } catch {}
    try { Write-Log ("ERROR: " + $_.Exception.Message) Red } catch { Write-Host ("ERROR: " + $_.Exception.Message) -ForegroundColor Red }
    try { Write-Log "RESULT VERSION: $failedVersion (not verified)" Red } catch {}
    try { Write-Log "STATUS: FAILED - phase=$Phase" Red } catch {}
    Write-Host ''
    Write-Host '============================================' -ForegroundColor Red
    Write-Host 'SUM DEVEL UPGRADE FAILED' -ForegroundColor Red
    Write-Host '============================================' -ForegroundColor Red
    Write-Host 'Status: FAILED' -ForegroundColor Red
    Write-Host "Version: $failedVersion (not verified)" -ForegroundColor Red
    Write-Host "Phase: $Phase" -ForegroundColor Red
    Write-Host "Log: $LogFile" -ForegroundColor Gray
    exit 1
}
finally {
    if ($Mutex) {
        if ($MutexOwned) { try { $Mutex.ReleaseMutex() } catch {} }
        $Mutex.Dispose()
    }
}

param(
    [string]$RepoDir = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$RepoDir = [System.IO.Path]::GetFullPath($RepoDir).TrimEnd('\')
$ManifestDir = Join-Path $RepoDir 'manifests'
$ManifestListPath = Join-Path $ManifestDir 'manifests-list.json'
$HadWarning = $false

function Test-ManifestFile {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$ExpectedId
    )

    if (-not (Test-Path -LiteralPath $Path)) { return $false }
    try {
        $manifest = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
        return ([int]$manifest.manifestVersion -eq 1 -and [string]$manifest.id -eq $ExpectedId)
    }
    catch {
        return $false
    }
}

try {
    if (-not (Test-Path -LiteralPath $ManifestListPath)) {
        throw 'manifests/manifests-list.json is missing.'
    }

    $manifestList = Get-Content -LiteralPath $ManifestListPath -Raw | ConvertFrom-Json
    if ([int]$manifestList.listVersion -ne 1 -or $null -eq $manifestList.manifests) {
        throw 'Invalid manifests/manifests-list.json.'
    }

    New-Item -ItemType Directory -Force -Path $ManifestDir | Out-Null

    foreach ($entry in @($manifestList.manifests)) {
        $manifestId = [string]$entry.id
        $manifestFile = [string]$entry.file
        $manifestUrl = [string]$entry.url

        if (-not $manifestId -or -not $manifestFile -or -not $manifestUrl) {
            throw 'Manifest registry entry is missing id, file, or url.'
        }
        if ([System.IO.Path]::GetFileName($manifestFile) -ne $manifestFile -or -not $manifestFile.EndsWith('.json', [StringComparison]::OrdinalIgnoreCase)) {
            throw "Invalid manifest cache filename '$manifestFile'."
        }

        $target = Join-Path $ManifestDir $manifestFile
        $temp = "$target.download"
        try {
            if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Force }
            Invoke-WebRequest -Uri $manifestUrl -OutFile $temp -UseBasicParsing
            if (-not (Test-ManifestFile -Path $temp -ExpectedId $manifestId)) {
                throw "Downloaded manifest '$manifestId' failed validation."
            }
            Move-Item -LiteralPath $temp -Destination $target -Force
            Write-Host "Manifest synchronized: $manifestId -> manifests/$manifestFile"
        }
        catch {
            if (Test-Path -LiteralPath $temp) {
                Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
            }
            if (Test-ManifestFile -Path $target -ExpectedId $manifestId) {
                $HadWarning = $true
                Write-Host "WARNING: Could not refresh manifest '$manifestId'; using cached manifests/$manifestFile. $($_.Exception.Message)" -ForegroundColor Yellow
            }
            else {
                throw
            }
        }
    }

    foreach ($entry in @($manifestList.manifests)) {
        $verifiedPath = Join-Path $ManifestDir ([string]$entry.file)
        if (-not (Test-ManifestFile -Path $verifiedPath -ExpectedId ([string]$entry.id))) {
            throw "Manifest verification failed for '$($entry.id)'."
        }
    }

    if ($HadWarning) {
        Write-Host 'STATUS: WARNING - manifest synchronization completed using at least one cached manifest.' -ForegroundColor Yellow
    }
    else {
        Write-Host 'STATUS: SUCCESS - manifests synchronized and verified.' -ForegroundColor Green
    }
    exit 0
}
catch {
    Write-Host ("ERROR: " + $_.Exception.Message) -ForegroundColor Red
    Write-Host 'STATUS: FAILED - manifest synchronization did not complete.' -ForegroundColor Red
    exit 1
}

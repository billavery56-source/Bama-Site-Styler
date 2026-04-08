param(
    [string]$CommitMessage = ""
)

$ErrorActionPreference = "Stop"

function Write-Section($text) {
    Write-Host ""
    Write-Host "=== $text ===" -ForegroundColor Cyan
}

function Write-Good($text) {
    Write-Host $text -ForegroundColor Green
}

function Write-Warn($text) {
    Write-Host $text -ForegroundColor Yellow
}

function Write-Bad($text) {
    Write-Host $text -ForegroundColor Red
}

function Fail($msg) {
    Write-Host ""
    Write-Bad "ERROR: $msg"
    Write-Host ""
    exit 1
}

function Invoke-GitCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Args
    )

    $pretty = ($Args -join " ")
    Write-Host ""
    Write-Host "git $pretty" -ForegroundColor DarkCyan

    & git @Args
    if ($LASTEXITCODE -ne 0) {
        Fail "Git command failed: git $pretty"
    }
}

function Get-ManifestPath {
    $path = Join-Path $PWD "manifest.json"
    if (-not (Test-Path $path)) {
        Fail "manifest.json was not found in the project root."
    }
    return $path
}

function Get-ManifestObject {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ManifestPath
    )

    try {
        return (Get-Content -Raw -Path $ManifestPath | ConvertFrom-Json)
    }
    catch {
        Fail "Could not parse manifest.json."
    }
}

function Get-NextVersion {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Version
    )

    if ($Version -notmatch '^\d+\.\d+\.\d+$') {
        Fail "manifest.json version must be in x.y.z format. Current value: $Version"
    }

    $parts = $Version.Split('.')
    $major = [int]$parts[0]
    $minor = [int]$parts[1]
    $patch = [int]$parts[2]

    $patch++

    return "$major.$minor.$patch"
}

function Update-ManifestVersion {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ManifestPath,

        [Parameter(Mandatory = $true)]
        [string]$NewVersion
    )

    $raw = Get-Content -Raw -Path $ManifestPath

    $updated = [regex]::Replace(
        $raw,
        '"version"\s*:\s*"[^"]+"',
        ('"version": "{0}"' -f $NewVersion),
        1
    )

    if ($updated -eq $raw) {
        Fail 'Could not update the "version" field in manifest.json.'
    }

    Set-Content -Path $ManifestPath -Value $updated -Encoding UTF8
}

function Get-SafeFileName {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    $safe = $Name -replace '[\\/:*?"<>|]', '-'
    $safe = $safe -replace '\s+', '-'
    $safe = $safe.Trim('-')

    if ([string]::IsNullOrWhiteSpace($safe)) {
        $safe = "extension"
    }

    return $safe
}

function New-CleanDirectory {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if (Test-Path $Path) {
        Remove-Item -Path $Path -Recurse -Force
    }

    New-Item -ItemType Directory -Path $Path | Out-Null
}

function Copy-ProjectForZip {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SourceRoot,

        [Parameter(Mandatory = $true)]
        [string]$StageRoot
    )

    $excludeNames = @(
        ".git",
        ".vscode",
        "dist"
    )

    Get-ChildItem -Force -Path $SourceRoot | ForEach-Object {
        if ($excludeNames -contains $_.Name) {
            return
        }

        $destination = Join-Path $StageRoot $_.Name

        if ($_.PSIsContainer) {
            Copy-Item -Path $_.FullName -Destination $destination -Recurse -Force
        }
        else {
            Copy-Item -Path $_.FullName -Destination $destination -Force
        }
    }
}

function New-ExtensionZip {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ProjectRoot,

        [Parameter(Mandatory = $true)]
        [pscustomobject]$Manifest
    )

    $distDir = Join-Path $ProjectRoot "dist"
    if (-not (Test-Path $distDir)) {
        New-Item -ItemType Directory -Path $distDir | Out-Null
    }

    $safeName = Get-SafeFileName -Name $Manifest.name
    $zipName = "$safeName-v$($Manifest.version).zip"
    $zipPath = Join-Path $distDir $zipName

    $tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("bama-build-" + [guid]::NewGuid().ToString())
    $stageDir = Join-Path $tempRoot "package"

    New-CleanDirectory -Path $stageDir

    try {
        Copy-ProjectForZip -SourceRoot $ProjectRoot -StageRoot $stageDir

        if (Test-Path $zipPath) {
            Remove-Item -Path $zipPath -Force
        }

        Compress-Archive -Path (Join-Path $stageDir '*') -DestinationPath $zipPath -CompressionLevel Optimal -Force

        return $zipPath
    }
    finally {
        if (Test-Path $tempRoot) {
            Remove-Item -Path $tempRoot -Recurse -Force
        }
    }
}

Write-Section "Bama Backup Build Push"

try {
    git --version | Out-Null
}
catch {
    Fail "Git is not installed or not in PATH."
}

if (-not (Test-Path ".git")) {
    Fail "This folder is not a Git repository."
}

$repoRoot = (& git rev-parse --show-toplevel 2>$null).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($repoRoot)) {
    Fail "Could not determine repository root."
}

Write-Host "Repo:   $repoRoot" -ForegroundColor Gray

$currentBranch = (& git branch --show-current 2>$null).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($currentBranch)) {
    $currentBranch = "main"
}

Write-Host "Branch: $currentBranch" -ForegroundColor Gray

$manifestPath = Get-ManifestPath
$manifest = Get-ManifestObject -ManifestPath $manifestPath
$oldVersion = [string]$manifest.version
$newVersion = Get-NextVersion -Version $oldVersion

Write-Host ""
Write-Host "Version: $oldVersion -> $newVersion" -ForegroundColor Gray

Update-ManifestVersion -ManifestPath $manifestPath -NewVersion $newVersion

$manifest = Get-ManifestObject -ManifestPath $manifestPath
$zipPath = New-ExtensionZip -ProjectRoot $repoRoot -Manifest $manifest

Write-Host "Zip:     $zipPath" -ForegroundColor Gray

if ([string]::IsNullOrWhiteSpace($CommitMessage)) {
    $CommitMessage = "Backup v$($manifest.version) " + (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
}

Write-Host ""
Write-Host "Commit message: $CommitMessage" -ForegroundColor Gray

Invoke-GitCommand -Args @("add", ".")
Invoke-GitCommand -Args @("commit", "-m", $CommitMessage)
Invoke-GitCommand -Args @("push")

Write-Host ""
Write-Good "Backup complete."
Write-Good "Built zip: $zipPath"
Write-Host ""
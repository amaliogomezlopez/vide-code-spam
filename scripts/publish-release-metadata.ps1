<#
.SYNOPSIS
Generate checksums and package-manager manifests for a Vibe Spam release.

.DESCRIPTION
Releases are unsigned, so the SHA-256 of every artifact is the only thing users
can verify before running an executable that Windows will warn about. This walks
the built artifacts once and produces:

  SHA256SUMS.txt              checksums to paste into the release notes
  winget/<version>/*.yaml     winget manifests (version, installer, locale)
  scoop/vibe-spam.json        Scoop manifest

Nothing is uploaded: the output is reviewed and submitted deliberately.

.EXAMPLE
.\scripts\publish-release-metadata.ps1 -Version 0.2.0
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^\d+\.\d+\.\d+$')]
    [string]$Version,

    [string]$ArtifactsPath = "frontend/release",

    [string]$OutputPath = "release-metadata",

    [string]$Repository = "amaliogomezlopez/vide-code-spam",

    [string]$PackageIdentifier = "AmalioGomezLopez.VibeSpam"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

function Resolve-InputPath([string]$Path) {
    if ([System.IO.Path]::IsPathRooted($Path)) { return $Path }
    return Join-Path $root $Path
}

# Artifact names contain spaces ("Vibe Spam-Setup-..."), and GitHub serves them
# percent-encoded. An unencoded URL is rejected by winget and breaks Scoop.
function Get-AssetUrl([string]$Repo, [string]$Tag, [string]$FileName) {
    return "https://github.com/$Repo/releases/download/$Tag/$([uri]::EscapeDataString($FileName))"
}

$artifacts = Resolve-InputPath $ArtifactsPath
$output = Resolve-InputPath $OutputPath

if (-not (Test-Path $artifacts)) {
    throw "No artifacts found at $artifacts. Build a release first (scripts/build-windows-installer.ps1)."
}

$files = Get-ChildItem -Path $artifacts -Recurse -Include *.exe, *.dmg, *.AppImage -File |
    Sort-Object Name
if ($files.Count -eq 0) {
    throw "No release artifacts (.exe/.dmg/.AppImage) under $artifacts."
}

New-Item -ItemType Directory -Force -Path $output | Out-Null

Write-Host "[1/3] Hashing $($files.Count) artifact(s)..." -ForegroundColor Cyan
$checksumLines = foreach ($file in $files) {
    $hash = (Get-FileHash -Path $file.FullName -Algorithm SHA256).Hash.ToLower()
    Write-Host "  $($file.Name) $hash"
    "$hash  $($file.Name)"
}
$checksumFile = Join-Path $output "SHA256SUMS.txt"
Set-Content -Path $checksumFile -Value $checksumLines -Encoding utf8

# winget only accepts installers, not portable-style single executables that
# unpack at runtime, so the NSIS setup is the one that gets a manifest.
$installer = $files | Where-Object { $_.Name -like "*Setup*" -and $_.Name -like "*CPU*" } |
    Select-Object -First 1
if (-not $installer) {
    $installer = $files | Where-Object { $_.Name -like "*Setup*" } | Select-Object -First 1
}

Write-Host "[2/3] Writing winget manifests..." -ForegroundColor Cyan
if (-not $installer) {
    Write-Warning "No NSIS installer found; skipping the winget manifests."
} else {
    $installerHash = (Get-FileHash -Path $installer.FullName -Algorithm SHA256).Hash.ToUpper()
    $installerUrl = Get-AssetUrl $Repository "v$Version" $installer.Name
    $wingetDir = Join-Path $output "winget/$Version"
    New-Item -ItemType Directory -Force -Path $wingetDir | Out-Null

    @"
# yaml-language-server: `$schema=https://aka.ms/winget-manifest.version.1.6.0.schema.json
PackageIdentifier: $PackageIdentifier
PackageVersion: $Version
DefaultLocale: en-US
ManifestType: version
ManifestVersion: 1.6.0
"@ | Set-Content -Path (Join-Path $wingetDir "$PackageIdentifier.yaml") -Encoding utf8

    @"
# yaml-language-server: `$schema=https://aka.ms/winget-manifest.installer.1.6.0.schema.json
PackageIdentifier: $PackageIdentifier
PackageVersion: $Version
InstallerType: nullsoft
Scope: user
InstallModes:
  - interactive
  - silent
UpgradeBehavior: install
Installers:
  - Architecture: x64
    InstallerUrl: $installerUrl
    InstallerSha256: $installerHash
ManifestType: installer
ManifestVersion: 1.6.0
"@ | Set-Content -Path (Join-Path $wingetDir "$PackageIdentifier.installer.yaml") -Encoding utf8

    @"
# yaml-language-server: `$schema=https://aka.ms/winget-manifest.defaultLocale.1.6.0.schema.json
PackageIdentifier: $PackageIdentifier
PackageVersion: $Version
PackageLocale: en-US
Publisher: Amalio Gomez Lopez
PackageName: Vibe Spam
License: MIT
ShortDescription: Desktop orchestrator for multiple coding CLIs with local voice dictation.
PackageUrl: https://github.com/$Repository
ManifestType: defaultLocale
ManifestVersion: 1.6.0
"@ | Set-Content -Path (Join-Path $wingetDir "$PackageIdentifier.locale.en-US.yaml") -Encoding utf8
}

Write-Host "[3/3] Writing Scoop manifest..." -ForegroundColor Cyan
$portable = $files | Where-Object { $_.Name -like "*Portable*" -and $_.Name -like "*CPU*" } |
    Select-Object -First 1
if (-not $portable) {
    $portable = $files | Where-Object { $_.Name -like "*Portable*" } | Select-Object -First 1
}
if (-not $portable) {
    Write-Warning "No portable build found; skipping the Scoop manifest."
} else {
    $scoopDir = Join-Path $output "scoop"
    New-Item -ItemType Directory -Force -Path $scoopDir | Out-Null
    $portableUrl = Get-AssetUrl $Repository "v$Version" $portable.Name
    # Keep Scoop's literal $version placeholder after encoding the file name.
    $autoUpdateUrl = $portableUrl.Replace($Version, '$version')
    $manifest = [ordered]@{
        version     = $Version
        description = "Desktop orchestrator for multiple coding CLIs with local voice dictation."
        homepage    = "https://github.com/$Repository"
        license     = "MIT"
        architecture = [ordered]@{
            "64bit" = [ordered]@{
                url  = $portableUrl
                hash = (Get-FileHash -Path $portable.FullName -Algorithm SHA256).Hash.ToLower()
            }
        }
        bin         = @(, @($portable.Name, "vibe-spam"))
        checkver    = [ordered]@{ github = "https://github.com/$Repository" }
        autoupdate  = [ordered]@{
            architecture = [ordered]@{
                "64bit" = [ordered]@{ url = $autoUpdateUrl }
            }
        }
    }
    $manifest | ConvertTo-Json -Depth 8 |
        Set-Content -Path (Join-Path $scoopDir "vibe-spam.json") -Encoding utf8
}

Write-Host ""
Write-Host "Metadata written to $output" -ForegroundColor Green
Write-Host "  - Paste $checksumFile into the release notes."
Write-Host "  - Submit the winget manifests to microsoft/winget-pkgs after the release is public."

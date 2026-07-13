[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$Destination
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$destinationPath = [System.IO.Path]::GetFullPath($Destination)

if ($destinationPath.StartsWith($repoRoot + [System.IO.Path]::DirectorySeparatorChar,
        [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Destination must be outside the development repository."
}

if (Test-Path -LiteralPath $destinationPath) {
    if ((Get-ChildItem -LiteralPath $destinationPath -Force | Select-Object -First 1)) {
        throw "Destination already exists and is not empty: $destinationPath"
    }
} else {
    New-Item -ItemType Directory -Path $destinationPath | Out-Null
}

$archive = Join-Path ([System.IO.Path]::GetTempPath()) ("vibe-spam-public-" + [guid]::NewGuid() + ".zip")
try {
    git -C $repoRoot archive --format=zip --output=$archive HEAD
    if ($LASTEXITCODE -ne 0) { throw "git archive failed." }
    Expand-Archive -LiteralPath $archive -DestinationPath $destinationPath
    # AGENTS.md documents the private development checkout, remote and local
    # maintainer workflow. It is intentionally not part of the public source
    # snapshot; contributor-facing rules live in CONTRIBUTING.md.
    [System.IO.File]::Delete((Join-Path $destinationPath "AGENTS.md"))
} finally {
    for ($attempt = 1; $attempt -le 5 -and (Test-Path -LiteralPath $archive); $attempt++) {
        try {
            [System.IO.File]::Delete($archive)
        } catch {
            if ($attempt -eq 5) { throw }
            Start-Sleep -Milliseconds (150 * $attempt)
        }
    }
}

$forbiddenNames = @(".env", ".env.local", "id_rsa", "id_ed25519")
$forbidden = Get-ChildItem -LiteralPath $destinationPath -Recurse -Force -File |
    Where-Object { $forbiddenNames -contains $_.Name -or $_.Extension -in @(".pem", ".p12", ".pfx", ".key") }
if ($forbidden) {
    $names = ($forbidden.FullName -join [Environment]::NewLine)
    throw "Potential secret files found in exported snapshot:`n$names"
}

git -C $destinationPath init -b main
git -C $destinationPath add --all
git -C $destinationPath commit -m "chore: publish initial source snapshot"
if ($LASTEXITCODE -ne 0) { throw "Initial public snapshot commit failed." }

Write-Host "Public snapshot created at $destinationPath"
Write-Host "Review it before adding a remote or pushing."

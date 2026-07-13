[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidatePattern("^[^/]+/[^/]+$")]
    [string]$Repository
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    throw "GitHub CLI (gh) is required. Install it and run 'gh auth login'."
}

gh auth status
if ($LASTEXITCODE -ne 0) { throw "GitHub CLI is not authenticated." }

$contexts = @(
    "backend (ubuntu-latest, 3.11)",
    "backend (ubuntu-latest, 3.12)",
    "backend (windows-latest, 3.11)",
    "backend (windows-latest, 3.12)",
    "frontend",
    "compose",
    "Analyze (javascript-typescript)",
    "Analyze (python)"
)

$protection = @{
    required_status_checks = @{ strict = $true; contexts = $contexts }
    enforce_admins = $true
    required_pull_request_reviews = @{
        dismiss_stale_reviews = $true
        require_code_owner_reviews = $false
        required_approving_review_count = 1
    }
    restrictions = $null
    required_conversation_resolution = $true
    allow_force_pushes = $false
    allow_deletions = $false
} | ConvertTo-Json -Depth 6 -Compress

$protection | gh api --method PUT "repos/$Repository/branches/main/protection" --input -
if ($LASTEXITCODE -ne 0) { throw "Could not protect main." }

gh api --method PUT -H "Accept: application/vnd.github+json" "repos/$Repository/vulnerability-alerts"
if ($LASTEXITCODE -ne 0) { throw "Could not enable vulnerability alerts." }

gh api --method PUT -H "Accept: application/vnd.github+json" "repos/$Repository/automated-security-fixes"
if ($LASTEXITCODE -ne 0) { throw "Could not enable Dependabot security updates." }

$privateReporting = '{"enabled":true}'
$privateReporting | gh api --method PATCH "repos/$Repository/private-vulnerability-reporting" --input -
if ($LASTEXITCODE -ne 0) { throw "Could not enable private vulnerability reporting." }

Write-Host "Configured branch protection and repository security for $Repository."
Write-Host "Verify secret scanning and push protection in GitHub Settings; availability depends on the repository plan."

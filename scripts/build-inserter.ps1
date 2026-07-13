# Build the native UIAutomation dictation inserter.

$ErrorActionPreference = "Stop"

$ROOT = $PSScriptRoot | Split-Path -Parent
$CSC = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $CSC)) {
    $CSC = "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe"
}
$UIAUTO_CLIENT = "$env:WINDIR\Microsoft.NET\assembly\GAC_MSIL\UIAutomationClient\v4.0_4.0.0.0__31bf3856ad364e35\UIAutomationClient.dll"
$UIAUTO_TYPES = "$env:WINDIR\Microsoft.NET\assembly\GAC_MSIL\UIAutomationTypes\v4.0_4.0.0.0__31bf3856ad364e35\UIAutomationTypes.dll"
$INSERTER_SRC = "$ROOT\frontend\inserter\Inserter.cs"
$INSERTER_DIR = "$ROOT\frontend\inserter-dist"
$INSERTER_EXE = "$INSERTER_DIR\inserter.exe"

if (-not (Test-Path $CSC)) { throw "csc.exe not found; .NET Framework 4 is required" }
if (-not (Test-Path $UIAUTO_CLIENT)) { throw "UIAutomationClient.dll not found in GAC" }
if (-not (Test-Path $UIAUTO_TYPES)) { throw "UIAutomationTypes.dll not found in GAC" }

New-Item -ItemType Directory -Force -Path $INSERTER_DIR | Out-Null
Write-Host "Building inserter helper with csc.exe..." -ForegroundColor Cyan
& $CSC /nologo /target:exe "/reference:$UIAUTO_CLIENT;$UIAUTO_TYPES" "/out:$INSERTER_EXE" $INSERTER_SRC
if ($LASTEXITCODE -ne 0) { throw "csc.exe failed to compile inserter (exit $LASTEXITCODE)" }
Write-Host "inserter.exe built: $INSERTER_EXE" -ForegroundColor Green

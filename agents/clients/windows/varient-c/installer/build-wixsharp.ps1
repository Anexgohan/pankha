# Pankha Agent - WixSharp MSI Installer Build Script

param([switch]$Clean)

$ErrorActionPreference = "Stop"

Write-Host "Building Pankha Agent MSI Installer using WixSharp" -ForegroundColor Cyan

# Check prerequisites
$agentExe = Resolve-Path "..\publish\win-x64\pankha-agent-windows.exe" -ErrorAction SilentlyContinue
if (-not $agentExe) {
    Write-Host "ERROR: Agent executable not found" -ForegroundColor Red
    Write-Host "Please build the agent first: cd .. && .\build.ps1 -Publish" -ForegroundColor Yellow
    exit 1
}

Write-Host "Agent executable found" -ForegroundColor Green

# Clean if requested
if ($Clean) {
    Write-Host "Cleaning..." -ForegroundColor Yellow
    if (Test-Path "bin") { Remove-Item -Path "bin" -Recurse -Force }
    if (Test-Path "obj") { Remove-Item -Path "obj" -Recurse -Force }
    Write-Host "Cleanup complete" -ForegroundColor Green
}

# Restore packages
Write-Host "Restoring NuGet packages..." -ForegroundColor Yellow
dotnet restore Pankha.WixSharpInstaller.csproj
if ($LASTEXITCODE -ne 0) {
    Write-Host "Restore failed" -ForegroundColor Red
    exit $LASTEXITCODE
}
Write-Host "Packages restored" -ForegroundColor Green

# Build
Write-Host "Building..." -ForegroundColor Yellow
dotnet build Pankha.WixSharpInstaller.csproj -c Release
if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed" -ForegroundColor Red
    exit $LASTEXITCODE
}
Write-Host "Build successful" -ForegroundColor Green

# The dotnet build already ran the WixSharp builder as part of the build process
# WixSharp integrates with MSBuild and automatically generates the MSI during build

# Verify output
$msiPath = ".\bin\x64\Release\PankhaAgent.msi"
if (-not (Test-Path $msiPath)) {
    Write-Host "MSI file not found" -ForegroundColor Red
    exit 1
}

$msiSize = (Get-Item $msiPath).Length / 1MB
Write-Host "SUCCESS! MSI created at $msiPath" -ForegroundColor Green
Write-Host "Size: $($msiSize.ToString('F2')) MB" -ForegroundColor Cyan

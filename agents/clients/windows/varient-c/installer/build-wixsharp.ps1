# Pankha Agent - WixSharp MSI Installer Build Script

param([switch]$Clean)

$ErrorActionPreference = "Stop"

# Read build configuration
$ConfigPath = Join-Path $PSScriptRoot "..\build-config.json"
if (-not (Test-Path $ConfigPath)) {
    Write-Host "❌ build-config.json not found at $ConfigPath" -ForegroundColor Red
    exit 1
}
$Config = Get-Content $ConfigPath | ConvertFrom-Json

Write-Host "Building Pankha Agent MSI Installer using WixSharp" -ForegroundColor Cyan
Write-Host "Configuration: $($Config.Product)" -ForegroundColor Gray

# Check prerequisites
$ProjectRoot = Resolve-Path "$PSScriptRoot\.."
$ArtifactsDir = Join-Path $ProjectRoot $Config.Paths.BuildArtifacts
$AgentExePath = Join-Path $ArtifactsDir $Config.Filenames.AgentExe

# Resolve-Path throws if not found, so use Test-Path first?
if (-not (Test-Path $AgentExePath)) {
    Write-Host "ERROR: Agent executable not found at: $AgentExePath" -ForegroundColor Red
    Write-Host "Please build the agent first: cd .. ; .\build.ps1 -Publish" -ForegroundColor Yellow
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
# Verify output
$InstallerOutputDir = Join-Path $ProjectRoot $Config.Paths.InstallerOutput
$msiPath = Join-Path $InstallerOutputDir $Config.Filenames.InstallerMsi

if (-not (Test-Path $msiPath)) {
    Write-Host "MSI file not found at: $msiPath" -ForegroundColor Red
    exit 1
}

$msiSize = (Get-Item $msiPath).Length / 1MB
Write-Host "SUCCESS! MSI created at $msiPath" -ForegroundColor Green
Write-Host "Size: $($msiSize.ToString('F2')) MB" -ForegroundColor Cyan

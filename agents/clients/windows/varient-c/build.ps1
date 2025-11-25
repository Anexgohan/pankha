# Build script for Pankha Windows Agent

param(
    [string]$Configuration = "Release",
    [switch]$Clean,
    [switch]$Test,
    [switch]$Publish
)

Write-Host "=== Pankha Windows Agent Build Script ===" -ForegroundColor Cyan
Write-Host ""

# Clean if requested
if ($Clean) {
    Write-Host "Cleaning previous builds..." -ForegroundColor Yellow
    dotnet clean -c $Configuration
    if (Test-Path "bin") { Remove-Item -Recurse -Force "bin" }
    if (Test-Path "obj") { Remove-Item -Recurse -Force "obj" }
    Write-Host "✅ Clean complete" -ForegroundColor Green
    Write-Host ""
}

# Restore packages
Write-Host "Restoring NuGet packages..." -ForegroundColor Yellow
dotnet restore
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Restore failed" -ForegroundColor Red
    exit 1
}
Write-Host "✅ Restore complete" -ForegroundColor Green
Write-Host ""

# Build
Write-Host "Building ($Configuration)..." -ForegroundColor Yellow
dotnet build -c $Configuration
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Build failed" -ForegroundColor Red
    exit 1
}
Write-Host "✅ Build complete" -ForegroundColor Green
Write-Host ""

# Test if requested
if ($Test) {
    Write-Host "Running hardware discovery test..." -ForegroundColor Yellow
    dotnet run -c $Configuration -- --test
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Test failed" -ForegroundColor Red
        exit 1
    }
    Write-Host "✅ Test complete" -ForegroundColor Green
    Write-Host ""
}

# Publish if requested
if ($Publish) {
    Write-Host "Publishing single-file executable..." -ForegroundColor Yellow

    $OutputDir = "publish\win-x64"

    dotnet publish -c Release -r win-x64 `
        --self-contained true `
        /p:PublishSingleFile=true `
        /p:IncludeNativeLibrariesForSelfExtract=true `
        /p:PublishReadyToRun=true `
        -o $OutputDir

    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Publish failed" -ForegroundColor Red
        exit 1
    }

    # Copy configuration example
    Copy-Item "config.example.json" "$OutputDir\config.example.json"

    Write-Host "✅ Publish complete" -ForegroundColor Green
    Write-Host ""
    Write-Host "Output: $OutputDir\pankha-agent.exe" -ForegroundColor Cyan

    # Show file size
    $ExePath = "$OutputDir\pankha-agent.exe"
    if (Test-Path $ExePath) {
        $Size = (Get-Item $ExePath).Length / 1MB
        Write-Host "Size: $($Size.ToString('F2')) MB" -ForegroundColor Cyan
    }
}

Write-Host ""
Write-Host "=== Build Complete ===" -ForegroundColor Cyan

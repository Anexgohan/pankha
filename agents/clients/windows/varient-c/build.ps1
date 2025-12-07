# Build script for Pankha Windows Agent

param(
    [string]$Configuration = "Release",
    [switch]$Clean,
    [switch]$Test,
    [switch]$Publish,
    [switch]$BuildInstaller,
    [switch]$Menu
)

# Function to check if running as administrator
function Test-Administrator {
    $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($currentUser)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# Function to elevate to administrator
function Start-ElevatedProcess {
    param([string]$Arguments)

    $scriptPath = $MyInvocation.PSCommandPath
    if (-not $scriptPath) {
        $scriptPath = $PSCommandPath
    }

    Write-Host "Requesting administrator privileges..." -ForegroundColor Yellow
    Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`" $Arguments" -Verb RunAs -Wait
    exit
}

# Show interactive menu if no parameters provided
$hasParams = $PSBoundParameters.Count -gt 0 -and -not $Menu
if (-not $hasParams -or $Menu) {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host " Pankha Windows Agent - Build Menu" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  1. Publish Single-File EXE" -ForegroundColor Green
    Write-Host "  2. Standard Build (Release)" -ForegroundColor White
    Write-Host "  3. Clean Build Artifacts" -ForegroundColor Yellow
    Write-Host "  4. Build and Test Hardware" -ForegroundColor Magenta
    Write-Host "  5. Debug Build" -ForegroundColor Gray
    Write-Host "  6. Clean + Publish" -ForegroundColor Cyan
    Write-Host "  7. Build MSI Installer" -ForegroundColor Magenta
    Write-Host "  8. Clean + Build MSI Installer" -ForegroundColor Cyan
    Write-Host "  0. Exit" -ForegroundColor Red
    Write-Host ""
    $choice = Read-Host "Select option"

    switch ($choice) {
        "1" { $Publish = $true }
        "2" { <# Standard build - no flags needed #> }
        "3" { $Clean = $true }
        "4" {
            # Auto-elevate for hardware test
            if (-not (Test-Administrator)) {
                Start-ElevatedProcess "-Test"
            }
            $Test = $true
        }
        "5" { $Configuration = "Debug" }
        "6" { $Clean = $true; $Publish = $true }
        "7" { $Publish = $true; $BuildInstaller = $true }
        "8" { $Clean = $true; $Publish = $true; $BuildInstaller = $true }
        "0" { Write-Host "Exiting..." -ForegroundColor Gray; exit 0 }
        default { Write-Host "Invalid option" -ForegroundColor Red; exit 1 }
    }
    Write-Host ""
}

# Auto-elevate for Test parameter (when run with -Test directly)
if ($Test -and -not (Test-Administrator)) {
    Start-ElevatedProcess "-Test"
}

Write-Host "=== Pankha Windows Agent Build Script ===" -ForegroundColor Cyan
Write-Host ""

# Clean if requested
if ($Clean) {
    Write-Host "Cleaning previous builds..." -ForegroundColor Yellow
    dotnet clean -c $Configuration
    if (Test-Path "bin") { Remove-Item -Recurse -Force "bin" }
    if (Test-Path "obj") { Remove-Item -Recurse -Force "obj" }

    # Also clean installer cache if building MSI
    if ($BuildInstaller -and (Test-Path "installer")) {
        Write-Host "  Cleaning installer cache..." -ForegroundColor Gray
        if (Test-Path "installer\bin") { Remove-Item -Recurse -Force "installer\bin" }
        if (Test-Path "installer\obj") { Remove-Item -Recurse -Force "installer\obj" }
    }

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
    Write-Host "Output: $OutputDir\pankha-agent-windows.exe" -ForegroundColor Cyan

    # Show file size
    $ExePath = "$OutputDir\pankha-agent-windows.exe"
    if (Test-Path $ExePath) {
        $Size = (Get-Item $ExePath).Length / 1MB
        Write-Host "Size: $($Size.ToString('F2')) MB" -ForegroundColor Cyan
    }
}

# Build MSI installer if requested (WixSharp)
if ($BuildInstaller) {
    Write-Host ""
    Write-Host "=== Building WixSharp MSI Installer ===" -ForegroundColor Cyan
    Write-Host ""

    Push-Location installer
    try {
        # Call the WixSharp build script
        $buildArgs = @()
        if ($Clean) {
            $buildArgs += "-Clean"
        }

        Write-Host "Running WixSharp installer builder..." -ForegroundColor Yellow
        & .\build-wixsharp.ps1 @buildArgs

        if ($LASTEXITCODE -ne 0) {
            throw "WixSharp installer build failed"
        }

        Write-Host ""
        Write-Host "✅ MSI Installer build complete!" -ForegroundColor Green
        Write-Host ""

        # Show MSI location
        $MsiPath = "bin\x64\Release\PankhaAgent.msi"
        if (Test-Path $MsiPath) {
            $MsiSize = (Get-Item $MsiPath).Length / 1MB
            Write-Host "========================================" -ForegroundColor Cyan
            Write-Host " MSI Installer Ready!" -ForegroundColor Green
            Write-Host "========================================" -ForegroundColor Cyan
            Write-Host ""
            Write-Host "Location: installer\$MsiPath" -ForegroundColor Cyan
            Write-Host "Size: $($MsiSize.ToString('F2')) MB" -ForegroundColor Cyan
            Write-Host ""
            Write-Host "To install:" -ForegroundColor Yellow
            Write-Host "  msiexec /i `"installer\$MsiPath`" /l*v install.log" -ForegroundColor Gray
            Write-Host "  (or double-click the MSI file)" -ForegroundColor Gray
            Write-Host ""
            Write-Host "To uninstall:" -ForegroundColor Yellow
            Write-Host "  msiexec /x `"installer\$MsiPath`" /l*v uninstall.log" -ForegroundColor Gray
            Write-Host ""
        }
    }
    catch {
        Write-Host "❌ Installer build failed: $_" -ForegroundColor Red
        Pop-Location
        exit 1
    }
    finally {
        Pop-Location
    }
}

Write-Host ""
Write-Host "=== Build Complete ===" -ForegroundColor Cyan

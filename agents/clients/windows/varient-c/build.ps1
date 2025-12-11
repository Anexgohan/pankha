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

# Read build configuration
$ConfigPath = Join-Path $PSScriptRoot "build-config.json"
if (-not (Test-Path $ConfigPath)) {
    Write-Host "❌ build-config.json not found!" -ForegroundColor Red
    exit 1
}
$Config = Get-Content $ConfigPath | ConvertFrom-Json

# Show interactive menu if no parameters provided
$hasParams = $PSBoundParameters.Count -gt 0 -and -not $Menu
if (-not $hasParams -or $Menu) {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host " Pankha Windows Agent - Build Menu" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  1. Build Full Release (Clean + Publish + MSI)" -ForegroundColor Green
    Write-Host "  2. Clean + Publish Agent Only (Single-File EXE)" -ForegroundColor Cyan
    Write-Host "  3. Publish Agent Only (Single-File EXE)" -ForegroundColor Cyan
    Write-Host "  4. Build Only (Quick check for build errors)" -ForegroundColor White
    Write-Host "  5. Run Hardware Test" -ForegroundColor Magenta
    Write-Host "  6. Cleanup" -ForegroundColor Yellow
    Write-Host "  0. Exit" -ForegroundColor Red
    Write-Host ""
    $choice = Read-Host "Select option"

    switch ($choice) {
        "1" { $Clean = $true; $Publish = $true; $BuildInstaller = $true }
        "2" { $Clean = $true; $Publish = $true }
        "3" { $Publish = $true }
        "4" { <# Standard build - no flags needed #> }
        "5" {
            # Auto-elevate for hardware test
            if (-not (Test-Administrator)) {
                Start-ElevatedProcess "-Test"
            }
            $Test = $true
        }
        "6" { $Clean = $true }
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
    if (Test-Path "publish") { Remove-Item -Recurse -Force "publish" }

    # Also clean installer cache if building MSI
    if ($BuildInstaller -and (Test-Path "installer")) {
        Write-Host "  Cleaning installer cache..." -ForegroundColor Gray
        if (Test-Path "installer\bin") { Remove-Item -Recurse -Force "installer\bin" }
        if (Test-Path "installer\obj") { Remove-Item -Recurse -Force "installer\obj" }
    }

    # Clean UI artifacts
    if (Test-Path "Pankha.UI\bin") { Remove-Item -Recurse -Force "Pankha.UI\bin" }
    if (Test-Path "Pankha.UI\obj") { Remove-Item -Recurse -Force "Pankha.UI\obj" }

    Write-Host "✅ Clean complete" -ForegroundColor Green
    Write-Host ""
}

# Restore packages
Write-Host "Restoring NuGet packages..." -ForegroundColor Yellow
dotnet restore
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Restore (Agent) failed" -ForegroundColor Red
    exit 1
}
dotnet restore "Pankha.UI\Pankha.UI.csproj"
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Restore (UI) failed" -ForegroundColor Red
    exit 1
}
Write-Host "✅ Restore complete" -ForegroundColor Green
Write-Host ""

# Resolve Icon Path from Config (for MSBuild injection)
$AppIconPath = $null
if ($Config.Paths.AppIcon_256) {
    $AppIconPath = Join-Path $PSScriptRoot $Config.Paths.AppIcon_256
    if (-not (Test-Path $AppIconPath)) {
         Write-Host "WARNING: Configured icon not found at $AppIconPath" -ForegroundColor Yellow
    }
}

# Build
Write-Host "Building ($Configuration)..." -ForegroundColor Yellow
$BuildParams = @("-c", $Configuration)
if ($AppIconPath) { $BuildParams += "/p:ApplicationIcon=$AppIconPath" }

dotnet build @BuildParams
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Build failed" -ForegroundColor Red
    exit 1
}
Write-Host "✅ Build complete" -ForegroundColor Green
Write-Host ""

# Build UI
Write-Host "Building UI ($Configuration)..." -ForegroundColor Yellow
$UiBuildParams = @("Pankha.UI\Pankha.UI.csproj", "-c", $Configuration)
if ($AppIconPath) { $UiBuildParams += "/p:AppIconPath=$AppIconPath" }
dotnet build @UiBuildParams
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ UI Build failed" -ForegroundColor Red
    exit 1
}
Write-Host "✅ UI Build complete" -ForegroundColor Green
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

    # Resolve relative path from config
    $OutputDir = Join-Path $PSScriptRoot $Config.Paths.BuildArtifacts
    
    # Clean output dir
    if (Test-Path $OutputDir) { Remove-Item -Recurse -Force $OutputDir }

    $PublishArgs = @(
        "-c", "Release",
        "-r", "win-x64",
        "--self-contained", "true",
        "/p:PublishSingleFile=true",
        "/p:IncludeNativeLibrariesForSelfExtract=true",
        "/p:PublishReadyToRun=true",
        "-o", $OutputDir
    )
    if ($AppIconPath) { $PublishArgs += "/p:ApplicationIcon=$AppIconPath" }

    dotnet publish @PublishArgs

    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Publish failed" -ForegroundColor Red
        exit 1
    }

    # Publish UI
    Write-Host "Publishing UI..." -ForegroundColor Yellow
    $UiPublishArgs = @(
        "Pankha.UI\Pankha.UI.csproj",
        "-c", "Release",
        "-r", "win-x64",
        "--self-contained", "true",
        "/p:PublishSingleFile=true",
        "/p:IncludeNativeLibrariesForSelfExtract=true",
        "-o", $OutputDir
    )
    if ($AppIconPath) { 
        $UiPublishArgs += "/p:ApplicationIcon=$AppIconPath"
        $UiPublishArgs += "/p:AppIconPath=$AppIconPath"
    }

    dotnet publish @UiPublishArgs
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ UI Publish failed" -ForegroundColor Red
        exit 1
    }

    # Rename UI Executable
    $DefaultUiName = "Pankha.UI.exe"
    $TargetUiName = $Config.Filenames.AgentUI
    
    if ($TargetUiName -and $TargetUiName -ne $DefaultUiName) {
        $SourceUi = Join-Path $OutputDir $DefaultUiName
        $TargetUi = Join-Path $OutputDir $TargetUiName
        if (Test-Path $SourceUi) {
            Move-Item -Force $SourceUi $TargetUi
            Write-Host "Renamed UI executable to: $TargetUiName" -ForegroundColor Gray
        }
    }

    # Copy configuration example
    Copy-Item "config.example.json" "$OutputDir\config.example.json"

    # Rename Executable if needed (Default is project name pankha-agent-windows.exe)
    # If Config.Filenames.AgentExe differs, we rename it.
    $DefaultExeName = "pankha-agent-windows.exe"
    $TargetExeName = $Config.Filenames.AgentExe
    
    if ($TargetExeName -and $TargetExeName -ne $DefaultExeName) {
        $SourceExe = Join-Path $OutputDir $DefaultExeName
        $TargetExe = Join-Path $OutputDir $TargetExeName
        if (Test-Path $SourceExe) {
            Move-Item -Force $SourceExe $TargetExe
            Write-Host "Renamed executable to: $TargetExeName" -ForegroundColor Gray
        }
    }

    Write-Host "✅ Publish complete" -ForegroundColor Green
    Write-Host ""
    Write-Host "Output: $OutputDir\$TargetExeName" -ForegroundColor Cyan

    # Show file size
    $ExePath = "$OutputDir\$TargetExeName"
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

        # Show MSI location - Resolve from Config
        # Config path is relative to root, but we are inside 'installer' now because of Push-Location? 
        # No, $Config.Paths.InstallerOutput is likely "..\\publish..." relative to root? 
        # Wait, if I am in 'installer', and config says "..\\publish", that resolves to "installer\..\publish" = "publish".
        # If I am in Root, "..\\publish" resolves to "..\publish" (outside root).
        # Let's assume paths in config are relative to PROJECT ROOT (varient-c).
        # So I should resolve them relative to PSScriptRoot.
        
        $MsiOutputDir = Join-Path $PSScriptRoot $Config.Paths.InstallerOutput
        $MsiFileName = $Config.Filenames.InstallerMsi
        $MsiPath = Join-Path $MsiOutputDir $MsiFileName
        
        if (Test-Path $MsiPath) {
            $MsiSize = (Get-Item $MsiPath).Length / 1MB
            Write-Host "========================================" -ForegroundColor Cyan
            Write-Host " MSI Installer Ready!" -ForegroundColor Green
            Write-Host "========================================" -ForegroundColor Cyan
            Write-Host ""
            Write-Host "Location: $MsiPath" -ForegroundColor Cyan
            Write-Host "Size: $($MsiSize.ToString('F2')) MB" -ForegroundColor Cyan
            Write-Host ""
            Write-Host "To install:" -ForegroundColor Yellow
            Write-Host "  msiexec /i `"$MsiPath`" /l*v install.log" -ForegroundColor Gray
            Write-Host "  (or double-click the MSI file)" -ForegroundColor Gray
            Write-Host ""
            Write-Host "To uninstall:" -ForegroundColor Yellow
            Write-Host "  msiexec /x `"$MsiPath`" /l*v uninstall.log" -ForegroundColor Gray
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

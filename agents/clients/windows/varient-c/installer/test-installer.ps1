# Test script for Pankha MSI Installer
# Runs automated tests to verify installer functionality

param(
    [switch]$Install,
    [switch]$Uninstall,
    [switch]$FullTest
)

$ErrorActionPreference = "Continue"

function Test-Administrator {
    $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($currentUser)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Pankha Agent Installer Test Suite" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check admin
if (-not (Test-Administrator)) {
    Write-Host "❌ Administrator privileges required" -ForegroundColor Red
    Write-Host "Please run PowerShell as Administrator" -ForegroundColor Yellow
    exit 1
}

$MsiPath = "bin\Release\en-US\PankhaAgent.msi"

# Test 1: MSI file exists
Write-Host "[1/6] Checking MSI file exists..." -ForegroundColor Yellow
if (Test-Path $MsiPath) {
    $Size = (Get-Item $MsiPath).Length / 1MB
    Write-Host "  ✅ MSI found ($($Size.ToString('F2')) MB)" -ForegroundColor Green
}
else {
    Write-Host "  ❌ MSI not found at: $MsiPath" -ForegroundColor Red
    Write-Host "  Run: .\build-installer.ps1" -ForegroundColor Yellow
    exit 1
}

# Test 2: Check if already installed
Write-Host "[2/6] Checking current installation..." -ForegroundColor Yellow
$Installed = Get-WmiObject -Class Win32_Product -Filter "Name = 'Pankha Windows Agent'" -ErrorAction SilentlyContinue
if ($Installed) {
    Write-Host "  ⚠️  Agent is currently installed (Version: $($Installed.Version))" -ForegroundColor Yellow
}
else {
    Write-Host "  ✅ No previous installation found" -ForegroundColor Green
}

# Test 3: Install if requested
if ($Install -or $FullTest) {
    Write-Host "[3/6] Installing MSI..." -ForegroundColor Yellow

    if ($Installed) {
        Write-Host "  Uninstalling previous version first..." -ForegroundColor Gray
        Start-Process msiexec.exe -ArgumentList "/x `"$MsiPath`" /qn /l*v uninstall-before-test.log" -Wait -NoNewWindow
    }

    $LogFile = "install-test.log"
    Start-Process msiexec.exe -ArgumentList "/i `"$MsiPath`" /qn LAUNCHSETUP=0 /l*v `"$LogFile`"" -Wait -NoNewWindow

    if ($LASTEXITCODE -eq 0 -or (Get-Service -Name "PankhaAgent" -ErrorAction SilentlyContinue)) {
        Write-Host "  ✅ Installation successful" -ForegroundColor Green
    }
    else {
        Write-Host "  ❌ Installation failed (check $LogFile)" -ForegroundColor Red
        exit 1
    }
}
else {
    Write-Host "[3/6] Skipping installation (use -Install to test)" -ForegroundColor Gray
}

# Test 4: Verify service installed
Write-Host "[4/6] Checking Windows Service..." -ForegroundColor Yellow
$Service = Get-Service -Name "PankhaAgent" -ErrorAction SilentlyContinue
if ($Service) {
    Write-Host "  ✅ Service found" -ForegroundColor Green
    Write-Host "    Name: $($Service.Name)" -ForegroundColor Gray
    Write-Host "    Status: $($Service.Status)" -ForegroundColor Gray
    Write-Host "    StartType: $($Service.StartType)" -ForegroundColor Gray
}
else {
    Write-Host "  ⚠️  Service not found (agent may not be installed)" -ForegroundColor Yellow
}

# Test 5: Verify files installed
Write-Host "[5/6] Checking installed files..." -ForegroundColor Yellow
$InstallPath = "C:\Program Files\Pankha"
if (Test-Path $InstallPath) {
    Write-Host "  ✅ Installation directory found" -ForegroundColor Green

    $Exe = Join-Path $InstallPath "pankha-agent-windows.exe"
    if (Test-Path $Exe) {
        Write-Host "    ✅ pankha-agent-windows.exe" -ForegroundColor Green
    }
    else {
        Write-Host "    ❌ pankha-agent-windows.exe missing" -ForegroundColor Red
    }

    $LogsDir = Join-Path $InstallPath "logs"
    if (Test-Path $LogsDir) {
        Write-Host "    ✅ logs\ directory" -ForegroundColor Green
    }
    else {
        Write-Host "    ❌ logs\ directory missing" -ForegroundColor Red
    }
}
else {
    Write-Host "  ⚠️  Installation directory not found" -ForegroundColor Yellow
}

# Test 6: Verify Start Menu shortcuts
Write-Host "[6/6] Checking Start Menu shortcuts..." -ForegroundColor Yellow
$ShortcutsPath = "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\Pankha Agent"
if (Test-Path $ShortcutsPath) {
    Write-Host "  ✅ Start Menu folder found" -ForegroundColor Green

    $Shortcuts = Get-ChildItem $ShortcutsPath -Filter "*.lnk"
    Write-Host "    Found $($Shortcuts.Count) shortcuts:" -ForegroundColor Gray
    foreach ($Shortcut in $Shortcuts) {
        Write-Host "      • $($Shortcut.Name)" -ForegroundColor Gray
    }
}
else {
    Write-Host "  ⚠️  Start Menu shortcuts not found" -ForegroundColor Yellow
}

# Uninstall if requested
if ($Uninstall -or $FullTest) {
    Write-Host ""
    Write-Host "Uninstalling..." -ForegroundColor Yellow
    $LogFile = "uninstall-test.log"
    Start-Process msiexec.exe -ArgumentList "/x `"$MsiPath`" /qn /l*v `"$LogFile`"" -Wait -NoNewWindow

    # Verify uninstall
    Start-Sleep -Seconds 2
    $Service = Get-Service -Name "PankhaAgent" -ErrorAction SilentlyContinue
    if (-not $Service -and -not (Test-Path $InstallPath)) {
        Write-Host "  ✅ Uninstallation successful" -ForegroundColor Green
    }
    else {
        Write-Host "  ⚠️  Some components may remain (check $LogFile)" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Test Summary" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "To test installation:" -ForegroundColor Cyan
Write-Host "  .\test-installer.ps1 -Install" -ForegroundColor Gray
Write-Host ""
Write-Host "To test uninstallation:" -ForegroundColor Cyan
Write-Host "  .\test-installer.ps1 -Uninstall" -ForegroundColor Gray
Write-Host ""
Write-Host "To run full test (install + verify + uninstall):" -ForegroundColor Cyan
Write-Host "  .\test-installer.ps1 -FullTest" -ForegroundColor Gray
Write-Host ""

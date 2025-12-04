# Pankha Agent Complete Cleanup Script
# Run as Administrator to completely remove all traces of Pankha Agent

Write-Host "=== Pankha Agent Complete Cleanup ===" -ForegroundColor Cyan
Write-Host ""

# Check if running as administrator
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "ERROR: This script must be run as Administrator!" -ForegroundColor Red
    Write-Host "Right-click PowerShell and select 'Run as Administrator'" -ForegroundColor Yellow
    pause
    exit 1
}

Write-Host "Step 1: Stopping and removing Windows Service..." -ForegroundColor Yellow
try {
    $service = Get-Service -Name "PankhaAgent" -ErrorAction SilentlyContinue
    if ($service) {
        if ($service.Status -eq 'Running') {
            Write-Host "  - Stopping service..."
            Stop-Service -Name "PankhaAgent" -Force -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 2
        }
        Write-Host "  - Removing service registration..."
        sc.exe delete PankhaAgent | Out-Null
        Write-Host "  ✓ Service removed" -ForegroundColor Green
    } else {
        Write-Host "  - Service not found (OK)" -ForegroundColor Gray
    }
} catch {
    Write-Host "  ! Service cleanup warning: $_" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Step 2: Force-killing any running processes..." -ForegroundColor Yellow
try {
    $process = Get-Process -Name "pankha-agent-windows" -ErrorAction SilentlyContinue
    if ($process) {
        Write-Host "  - Killing pankha-agent-windows.exe..."
        Stop-Process -Name "pankha-agent-windows" -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
        Write-Host "  ✓ Process killed" -ForegroundColor Green
    } else {
        Write-Host "  - No running processes (OK)" -ForegroundColor Gray
    }
} catch {
    Write-Host "  ! Process cleanup warning: $_" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Step 3: Removing installation files..." -ForegroundColor Yellow
$installPath = "C:\Program Files\Pankha"
if (Test-Path $installPath) {
    Write-Host "  - Deleting $installPath..."
    try {
        Remove-Item -Path $installPath -Recurse -Force -ErrorAction Stop
        Write-Host "  ✓ Files removed" -ForegroundColor Green
    } catch {
        Write-Host "  ! Could not remove some files: $_" -ForegroundColor Yellow
        Write-Host "  - Trying to unlock and remove again..."
        Start-Sleep -Seconds 2
        Remove-Item -Path $installPath -Recurse -Force -ErrorAction SilentlyContinue
    }
} else {
    Write-Host "  - Installation directory not found (OK)" -ForegroundColor Gray
}

Write-Host ""
Write-Host "Step 4: Removing Start Menu shortcuts..." -ForegroundColor Yellow
$shortcutPaths = @(
    "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\Pankha Agent",
    "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Pankha Agent"
)
foreach ($path in $shortcutPaths) {
    if (Test-Path $path) {
        Write-Host "  - Deleting $path..."
        Remove-Item -Path $path -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "  ✓ Shortcuts removed" -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "Step 5: Cleaning registry entries..." -ForegroundColor Yellow
$regPaths = @(
    "HKCU:\Software\Pankha",
    "HKLM:\Software\Pankha"
)
foreach ($regPath in $regPaths) {
    if (Test-Path $regPath) {
        Write-Host "  - Removing $regPath..."
        Remove-Item -Path $regPath -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "  ✓ Registry cleaned" -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "Step 6: Finding and removing MSI installer cache..." -ForegroundColor Yellow
try {
    # Find all Pankha Agent installations in registry
    $uninstallPaths = @(
        "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*",
        "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*"
    )

    $found = $false
    foreach ($path in $uninstallPaths) {
        Get-ItemProperty $path -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like "*Pankha*" } | ForEach-Object {
            $found = $true
            $productCode = $_.PSChildName
            Write-Host "  - Found product: $($_.DisplayName) ($productCode)"

            # Attempt to uninstall via msiexec
            Write-Host "  - Attempting to uninstall via msiexec..."
            Start-Process -FilePath "msiexec.exe" -ArgumentList "/x $productCode /qn /norestart" -Wait -NoNewWindow

            # Remove registry entry
            Write-Host "  - Removing registry entry..."
            Remove-Item -Path "$path\$productCode" -Force -ErrorAction SilentlyContinue
        }
    }

    if ($found) {
        Write-Host "  ✓ MSI cache cleaned" -ForegroundColor Green
    } else {
        Write-Host "  - No MSI installations found (OK)" -ForegroundColor Gray
    }
} catch {
    Write-Host "  ! MSI cleanup warning: $_" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=== Cleanup Complete ===" -ForegroundColor Green
Write-Host ""
Write-Host "The system is now clean. You can:" -ForegroundColor Cyan
Write-Host "  1. Install the new MSI: .\PankhaAgent.msi" -ForegroundColor White
Write-Host "  2. Verify cleanup: Get-Service PankhaAgent (should error)" -ForegroundColor White
Write-Host "  3. Verify cleanup: Test-Path 'C:\Program Files\Pankha' (should be False)" -ForegroundColor White
Write-Host ""
pause

# ============================================================
# Pankha Agent - Complete System Cleanup Script
# ============================================================
# Removes all traces of Pankha Agent installation
# Use before testing fresh installer deployment
# ============================================================

#Requires -RunAsAdministrator

param(
    [switch]$Force
)

$ErrorActionPreference = "Continue"  # Continue on errors to clean up as much as possible

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Pankha Agent - System Cleanup" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

if (-not $Force) {
    Write-Host "WARNING: This will completely remove Pankha Agent from your system!" -ForegroundColor Yellow
    Write-Host "This includes:" -ForegroundColor Yellow
    Write-Host "  - Windows Service (PankhaAgent)" -ForegroundColor Gray
    Write-Host "  - Installation directory (C:\Program Files\Pankha)" -ForegroundColor Gray
    Write-Host "  - Start Menu shortcuts" -ForegroundColor Gray
    Write-Host "  - All configuration and log files" -ForegroundColor Gray
    Write-Host ""
    $confirm = Read-Host "Type 'YES' to continue"
    if ($confirm -ne 'YES') {
        Write-Host "Cleanup cancelled" -ForegroundColor Yellow
        exit 0
    }
}

Write-Host ""
Write-Host "Starting cleanup..." -ForegroundColor Green
Write-Host ""

# ============================================================
# STEP 1: Stop and Remove Windows Service
# ============================================================

Write-Host "[1/6] Checking Windows Service..." -ForegroundColor Cyan

$service = Get-Service -Name "PankhaAgent" -ErrorAction SilentlyContinue
if ($service) {
    Write-Host "  Service found: $($service.Status)" -ForegroundColor Yellow

    # Stop service
    if ($service.Status -eq 'Running') {
        Write-Host "  Stopping service..." -ForegroundColor Yellow
        try {
            Stop-Service -Name "PankhaAgent" -Force -ErrorAction Stop
            Start-Sleep -Seconds 2
            Write-Host "  Service stopped" -ForegroundColor Green
        }
        catch {
            Write-Host "  Failed to stop service: $($_.Exception.Message)" -ForegroundColor Red
            Write-Host "  Attempting forceful termination..." -ForegroundColor Yellow
        }
    }

    # Delete service
    Write-Host "  Removing service..." -ForegroundColor Yellow
    try {
        sc.exe delete PankhaAgent | Out-Null
        Write-Host "  Service removed" -ForegroundColor Green
    }
    catch {
        Write-Host "  Failed to remove service: $($_.Exception.Message)" -ForegroundColor Red
    }
}
else {
    Write-Host "  No service found" -ForegroundColor Gray
}

Write-Host ""

# ============================================================
# STEP 2: Kill Running Processes
# ============================================================

Write-Host "[2/6] Checking running processes..." -ForegroundColor Cyan

# Kill all Pankha-related processes
$processNames = @(
    "pankha-agent-windows",
    "pankha-agent",
    "Pankha.WixSharpInstaller"
)

$found = $false
foreach ($procName in $processNames) {
    $processes = Get-Process -Name $procName -ErrorAction SilentlyContinue
    if ($processes) {
        $found = $true
        Write-Host "  Found $($processes.Count) '$procName' process(es)" -ForegroundColor Yellow
        foreach ($proc in $processes) {
            try {
                Write-Host "  Killing '$($proc.ProcessName)' (PID $($proc.Id))..." -ForegroundColor Yellow
                Stop-Process -Id $proc.Id -Force -ErrorAction Stop
                Write-Host "  Process killed" -ForegroundColor Green
            }
            catch {
                Write-Host "  Failed to kill process: $($_.Exception.Message)" -ForegroundColor Red
            }
        }
    }
}

if ($found) {
    Start-Sleep -Seconds 2  # Wait for processes to fully terminate
}
else {
    Write-Host "  No Pankha processes running" -ForegroundColor Gray
}

Write-Host ""

# ============================================================
# STEP 3: Delete Installation Directory
# ============================================================

Write-Host "[3/6] Removing installation directory..." -ForegroundColor Cyan

$installDirs = @(
    "C:\Program Files\Pankha",
    "${env:ProgramFiles}\Pankha",
    "C:\Program Files (x86)\Pankha",
    "${env:ProgramFiles(x86)}\Pankha"
)

$found = $false
foreach ($dir in $installDirs) {
    if (Test-Path $dir) {
        $found = $true
        Write-Host "  Found: $dir" -ForegroundColor Yellow
        try {
            # Remove read-only attributes
            Get-ChildItem -Path $dir -Recurse -Force -ErrorAction SilentlyContinue |
                ForEach-Object { $_.Attributes = 'Normal' }

            # Delete directory
            Remove-Item -Path $dir -Recurse -Force -ErrorAction Stop
            Write-Host "  Deleted: $dir" -ForegroundColor Green
        }
        catch {
            Write-Host "  Failed to delete: $($_.Exception.Message)" -ForegroundColor Red
        }
    }
}

if (-not $found) {
    Write-Host "  No installation directories found" -ForegroundColor Gray
}

Write-Host ""

# ============================================================
# STEP 4: Remove Start Menu Shortcuts
# ============================================================

Write-Host "[4/6] Removing Start Menu shortcuts..." -ForegroundColor Cyan

$shortcutPaths = @(
    "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\Pankha Agent",
    "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Pankha Agent"
)

$found = $false
foreach ($path in $shortcutPaths) {
    if (Test-Path $path) {
        $found = $true
        Write-Host "  Found: $path" -ForegroundColor Yellow
        try {
            Remove-Item -Path $path -Recurse -Force -ErrorAction Stop
            Write-Host "  Deleted: $path" -ForegroundColor Green
        }
        catch {
            Write-Host "  Failed to delete: $($_.Exception.Message)" -ForegroundColor Red
        }
    }
}

if (-not $found) {
    Write-Host "  No Start Menu shortcuts found" -ForegroundColor Gray
}

Write-Host ""

# ============================================================
# STEP 5: Clean Registry (if any entries exist)
# ============================================================

Write-Host "[5/6] Checking registry..." -ForegroundColor Cyan

$regPaths = @(
    "HKLM:\SOFTWARE\Pankha",
    "HKLM:\SOFTWARE\WOW6432Node\Pankha",
    "HKCU:\SOFTWARE\Pankha"
)

$found = $false
foreach ($regPath in $regPaths) {
    if (Test-Path $regPath) {
        $found = $true
        Write-Host "  Found: $regPath" -ForegroundColor Yellow
        try {
            Remove-Item -Path $regPath -Recurse -Force -ErrorAction Stop
            Write-Host "  Deleted: $regPath" -ForegroundColor Green
        }
        catch {
            Write-Host "  Failed to delete: $($_.Exception.Message)" -ForegroundColor Red
        }
    }
}

if (-not $found) {
    Write-Host "  No registry entries found" -ForegroundColor Gray
}

Write-Host ""

# ============================================================
# STEP 6: Verify Cleanup
# ============================================================

Write-Host "[6/6] Verifying cleanup..." -ForegroundColor Cyan

$issues = @()

# Check service
if (Get-Service -Name "PankhaAgent" -ErrorAction SilentlyContinue) {
    $issues += "Service still exists"
}

# Check processes
foreach ($procName in $processNames) {
    if (Get-Process -Name $procName -ErrorAction SilentlyContinue) {
        $issues += "Process still running: $procName"
    }
}

# Check install directory
foreach ($dir in $installDirs) {
    if (Test-Path $dir) {
        $issues += "Installation directory still exists: $dir"
    }
}

# Check shortcuts
foreach ($path in $shortcutPaths) {
    if (Test-Path $path) {
        $issues += "Shortcuts still exist: $path"
    }
}

if ($issues.Count -eq 0) {
    Write-Host "  System is clean!" -ForegroundColor Green
    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Green
    Write-Host "  Cleanup Complete - System Ready for Fresh Install" -ForegroundColor Green
    Write-Host "============================================================" -ForegroundColor Green
    Write-Host ""
}
else {
    Write-Host "  WARNING: Some items could not be removed:" -ForegroundColor Yellow
    foreach ($issue in $issues) {
        Write-Host "    - $issue" -ForegroundColor Red
    }
    Write-Host ""
    Write-Host "  You may need to:" -ForegroundColor Yellow
    Write-Host "    1. Reboot the system" -ForegroundColor Gray
    Write-Host "    2. Run this script again" -ForegroundColor Gray
    Write-Host "    3. Manually remove remaining items" -ForegroundColor Gray
    Write-Host ""
}

Write-Host "Cleanup finished!" -ForegroundColor Cyan
Write-Host ""

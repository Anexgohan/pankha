# Install Pankha Windows Agent as a Windows Service
# Requires Administrator privileges

param(
    [switch]$Uninstall
)

$ErrorActionPreference = "Stop"

$ServiceName = "PankhaAgent"
$ServiceDisplayName = "Pankha Hardware Monitoring Agent"
$ServiceDescription = "Monitors hardware sensors and controls fan speeds for the Pankha system"
$InstallPath = "C:\Program Files\Pankha"
$ExePath = Join-Path $InstallPath "pankha-agent-windows.exe"

# Check if running as administrator
function Test-Administrator {
    $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($currentUser)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-Administrator)) {
    Write-Host "ERROR: This script must be run as Administrator" -ForegroundColor Red
    Write-Host "Please right-click PowerShell and select 'Run as Administrator'" -ForegroundColor Yellow
    exit 1
}

# Uninstall mode
if ($Uninstall) {
    Write-Host ""
    Write-Host "=== Uninstalling Pankha Agent Service ===" -ForegroundColor Cyan
    Write-Host ""

    # Check if service exists
    $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue

    if ($service) {
        # Stop service if running
        if ($service.Status -eq "Running") {
            Write-Host "Stopping service..." -ForegroundColor Yellow
            Stop-Service -Name $ServiceName -Force
            Start-Sleep -Seconds 2
        }

        # Delete service
        Write-Host "Removing service..." -ForegroundColor Yellow
        sc.exe delete $ServiceName

        if ($LASTEXITCODE -eq 0) {
            Write-Host "✅ Service uninstalled successfully" -ForegroundColor Green
        } else {
            Write-Host "❌ Failed to uninstall service" -ForegroundColor Red
            exit 1
        }
    } else {
        Write-Host "Service '$ServiceName' is not installed" -ForegroundColor Yellow
    }

    Write-Host ""
    Write-Host "Note: Files in $InstallPath were NOT removed" -ForegroundColor Gray
    Write-Host "To remove files, delete: $InstallPath" -ForegroundColor Gray
    Write-Host ""
    exit 0
}

# Install mode
Write-Host ""
Write-Host "=== Installing Pankha Agent Service ===" -ForegroundColor Cyan
Write-Host ""

# Check if executable exists
if (-not (Test-Path $ExePath)) {
    Write-Host "❌ ERROR: Executable not found at: $ExePath" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please ensure:" -ForegroundColor Yellow
    Write-Host "  1. The agent has been built (run build.ps1 -Publish)" -ForegroundColor Yellow
    Write-Host "  2. Files are copied to $InstallPath" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "To copy files:" -ForegroundColor Cyan
    Write-Host "  Copy-Item publish\win-x64\* '$InstallPath\' -Recurse -Force" -ForegroundColor Gray
    Write-Host ""
    exit 1
}

# Check if service already exists
$existingService = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue

if ($existingService) {
    Write-Host "⚠️  Service already exists" -ForegroundColor Yellow
    Write-Host ""
    $response = Read-Host "Do you want to reinstall? (y/n)"

    if ($response -ne 'y') {
        Write-Host "Installation cancelled" -ForegroundColor Yellow
        exit 0
    }

    # Stop service if running
    if ($existingService.Status -eq "Running") {
        Write-Host "Stopping existing service..." -ForegroundColor Yellow
        Stop-Service -Name $ServiceName -Force
        Start-Sleep -Seconds 2
    }

    # Delete existing service
    Write-Host "Removing existing service..." -ForegroundColor Yellow
    sc.exe delete $ServiceName
    Start-Sleep -Seconds 1
}

# Create the service
Write-Host "Creating Windows Service..." -ForegroundColor Yellow
Write-Host "  Name: $ServiceName" -ForegroundColor Gray
Write-Host "  Path: $ExePath" -ForegroundColor Gray

sc.exe create $ServiceName binPath= $ExePath start= auto DisplayName= $ServiceDisplayName

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Failed to create service" -ForegroundColor Red
    exit 1
}

# Set service description
sc.exe description $ServiceName $ServiceDescription

# Set service to restart on failure
sc.exe failure $ServiceName reset= 86400 actions= restart/5000/restart/10000/restart/30000

Write-Host "✅ Service created successfully" -ForegroundColor Green
Write-Host ""

# Ask if user wants to start the service now
$startNow = Read-Host "Start the service now? (y/n)"

if ($startNow -eq 'y') {
    Write-Host "Starting service..." -ForegroundColor Yellow
    Start-Service -Name $ServiceName
    Start-Sleep -Seconds 2

    $service = Get-Service -Name $ServiceName
    if ($service.Status -eq "Running") {
        Write-Host "✅ Service started successfully" -ForegroundColor Green
    } else {
        Write-Host "⚠️  Service created but failed to start" -ForegroundColor Yellow
        Write-Host "Status: $($service.Status)" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "Check logs at: $InstallPath\logs\" -ForegroundColor Cyan
    }
} else {
    Write-Host "Service installed but not started" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "To start the service:" -ForegroundColor Cyan
    Write-Host "  pankha-agent-windows.exe --start" -ForegroundColor Gray
    Write-Host "  or" -ForegroundColor Gray
    Write-Host "  Start-Service -Name $ServiceName" -ForegroundColor Gray
}

Write-Host ""
Write-Host "=== Installation Complete ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Service commands:" -ForegroundColor Cyan
Write-Host "  pankha-agent-windows.exe --status        # Check status" -ForegroundColor Gray
Write-Host "  pankha-agent-windows.exe --start         # Start service" -ForegroundColor Gray
Write-Host "  pankha-agent-windows.exe --stop          # Stop service" -ForegroundColor Gray
Write-Host "  pankha-agent-windows.exe --restart       # Restart service" -ForegroundColor Gray
Write-Host "  pankha-agent-windows.exe --logs follow   # View logs" -ForegroundColor Gray
Write-Host ""

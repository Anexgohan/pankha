# Install-PankhaAgent.ps1
# Run as Administrator

$ErrorActionPreference = "Stop"

# Configuration
$ServiceName = "PankhaAgent"
$ServiceDisplayName = "Pankha Fan Control Agent"
$ServiceDescription = "Hardware monitoring and fan control agent for Pankha system."
$InstallDir = "C:\Program Files\PankhaAgent"
$SourceDir = $PSScriptRoot

Write-Host "Installing Pankha Agent..." -ForegroundColor Cyan

# 1. Check Administrator Privileges
$currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error "This script must be run as Administrator."
    exit 1
}

# 2. Stop Existing Service
if (Get-Service $ServiceName -ErrorAction SilentlyContinue) {
    Write-Host "Stopping existing service..."
    Stop-Service $ServiceName -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}

# 3. Publish Application
Write-Host "Building application..."
dotnet publish -c Release -r win-x64 --self-contained -o "$SourceDir\publish"
if ($LASTEXITCODE -ne 0) {
    Write-Error "Build failed."
    exit 1
}

# 4. Copy Files
Write-Host "Copying files to $InstallDir..."
if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir | Out-Null
}
Copy-Item -Path "$SourceDir\publish\*" -Destination $InstallDir -Recurse -Force

# 5. Register Service
if (-not (Get-Service $ServiceName -ErrorAction SilentlyContinue)) {
    Write-Host "Registering service..."
    New-Service -Name $ServiceName `
                -DisplayName $ServiceDisplayName `
                -Description $ServiceDescription `
                -BinaryPathName "$InstallDir\PankhaAgent.exe" `
                -StartupType Automatic
} else {
    Write-Host "Service already registered."
}

# 6. Start Service
Write-Host "Starting service..."
Start-Service $ServiceName

Write-Host "Installation Complete! Agent is running." -ForegroundColor Green

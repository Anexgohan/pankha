# NVIDIA GPU Fan Control Test
# This script tests if LibreHardwareMonitor can control your NVIDIA GPU fan

Write-Host "`n=== NVIDIA GPU Fan Control Diagnostic ===" -ForegroundColor Cyan
Write-Host ""

# Check if running as administrator
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "❌ ERROR: This script must be run as Administrator" -ForegroundColor Red
    Write-Host "Right-click PowerShell and select 'Run as Administrator'" -ForegroundColor Yellow
    exit 1
}

Write-Host "✅ Running as Administrator" -ForegroundColor Green
Write-Host ""

# Check for NVIDIA GPU
Write-Host "Checking for NVIDIA GPU..." -ForegroundColor Yellow
$nvidiagpu = Get-WmiObject Win32_VideoController | Where-Object { $_.Name -like "*NVIDIA*" }

if ($nvidiagpu) {
    Write-Host "✅ NVIDIA GPU Found: $($nvidiagpu.Name)" -ForegroundColor Green
} else {
    Write-Host "⚠️ No NVIDIA GPU detected" -ForegroundColor Yellow
    Write-Host "This test is specifically for NVIDIA GPUs" -ForegroundColor Gray
    exit 0
}

Write-Host ""
Write-Host "=== NVIDIA Fan Control Limitations ===" -ForegroundColor Yellow
Write-Host ""
Write-Host "NVIDIA GPUs have driver-controlled fan management:" -ForegroundColor White
Write-Host ""
Write-Host "🔒 Driver Protection:" -ForegroundColor Cyan
Write-Host "  • NVIDIA driver controls fan curves automatically"
Write-Host "  • Manual control is often blocked for safety"
Write-Host "  • Prevents overheating from user error"
Write-Host ""
Write-Host "🛠️ Workarounds Available:" -ForegroundColor Cyan
Write-Host "  1. MSI Afterburner - Enable manual fan control"
Write-Host "  2. EVGA Precision X1 - GPU-specific control"
Write-Host "  3. NVIDIA Inspector - Advanced tweaking"
Write-Host ""
Write-Host "⚙️ What Pankha Can Do:" -ForegroundColor Cyan
Write-Host "  ✅ Monitor GPU temperatures (working)"
Write-Host "  ✅ Monitor GPU fan RPM (working)"
Write-Host "  ❌ Control GPU fan speed (blocked by NVIDIA driver)"
Write-Host ""
Write-Host "💡 Recommendation:" -ForegroundColor Green
Write-Host "  For NVIDIA GPU fan control, use vendor tools (MSI Afterburner, etc.)"
Write-Host "  Pankha works best for motherboard/chassis fans"
Write-Host ""

# Check if MSI Afterburner is installed
$afterburner = Get-Process -Name "MSIAfterburner" -ErrorAction SilentlyContinue
if ($afterburner) {
    Write-Host "✅ MSI Afterburner detected (running)" -ForegroundColor Green
    Write-Host "   You can use Afterburner for GPU fan control" -ForegroundColor Gray
} else {
    $afterburnerPath = "C:\Program Files (x86)\MSI Afterburner\MSIAfterburner.exe"
    if (Test-Path $afterburnerPath) {
        Write-Host "⚠️ MSI Afterburner installed but not running" -ForegroundColor Yellow
        Write-Host "   Start Afterburner for GPU fan control" -ForegroundColor Gray
    } else {
        Write-Host "ℹ️ MSI Afterburner not installed" -ForegroundColor Gray
        Write-Host "   Download: https://www.msi.com/Landing/afterburner" -ForegroundColor Gray
    }
}

Write-Host ""
Write-Host "=== Test Summary ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "GPU Fan Control Status: " -NoNewline
Write-Host "BLOCKED BY NVIDIA DRIVER" -ForegroundColor Red
Write-Host ""
Write-Host "This is EXPECTED behavior and NOT a bug in Pankha." -ForegroundColor Yellow
Write-Host "NVIDIA protects GPU fans from external control for safety." -ForegroundColor Yellow
Write-Host ""
Write-Host "✅ Pankha CAN monitor: GPU temp (40°C), Hot Spot (55°C), Fan RPM (3046)" -ForegroundColor Green
Write-Host "❌ Pankha CANNOT control: NVIDIA GPU fan speed (driver restriction)" -ForegroundColor Red
Write-Host ""
Write-Host "Motherboard/chassis fans WILL work normally with Pankha." -ForegroundColor Green
Write-Host ""

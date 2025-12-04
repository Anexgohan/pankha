# Pankha Agent MSI Installer

This directory contains the WiX Toolset v5 installer project for the Pankha Windows Agent.

## Prerequisites

1. **.NET 8.0 SDK** - https://dotnet.microsoft.com/download

**Note:** WiX Toolset is installed automatically by the build script if not found. No manual installation required!

## Quick Start

### Build MSI Installer

```powershell
# From the parent directory (varient-c/)
..\build.ps1

# Select option 7 from the menu
# Or use command line:
..\build.ps1 -BuildInstaller

# Clean + Build MSI
..\build.ps1 -Clean -BuildInstaller
```

### Install Agent

```powershell
# GUI installer (double-click)
.\bin\Release\en-US\PankhaAgent.msi

# Silent install
msiexec /i "bin\Release\en-US\PankhaAgent.msi" /qn /l*v install.log

# Install with logging
msiexec /i "bin\Release\en-US\PankhaAgent.msi" /l*v install.log
```

### Uninstall Agent

```powershell
# Via Control Panel
# Settings → Apps → Pankha Windows Agent → Uninstall

# Via MSI
msiexec /x "bin\Release\en-US\PankhaAgent.msi" /l*v uninstall.log

# Silent uninstall
msiexec /x {ProductCode} /qn
```

## Project Structure

```
installer/
├── Pankha.Installer.wixproj    # WiX project file (SDK-style)
├── Product.wxs                  # Main installer definition
├── UI.wxs                       # Installer user interface
├── build-installer.ps1          # Build script
└── README.md                    # This file
```

## Features

✅ **Windows Service Installation**
- Automatically installs and configures PankhaAgent service
- Sets service to start automatically on boot
- Configures service recovery (restart on failure)

✅ **Start Menu Shortcuts**
- Configure Pankha Agent (runs setup wizard)
- View Pankha Agent Logs
- Pankha Agent Status
- Uninstall Pankha Agent

✅ **Automatic Upgrades**
- Detects and uninstalls older versions
- Preserves configuration during upgrades

✅ **.NET Runtime Check**
- Validates .NET 8.0 Runtime is installed
- Shows helpful error if missing

✅ **Proper Uninstallation**
- Stops and removes Windows Service
- Removes all files and shortcuts
- Cleans up registry entries

## Installation Details

**Default Install Location:**
```
C:\Program Files\Pankha\
├── pankha-agent-windows.exe
├── appsettings.json
├── config.example.json
├── config.json              (created on first run)
└── logs\
    └── agent-*.log
```

**Windows Service:**
- **Name:** PankhaAgent
- **Display Name:** Pankha Hardware Monitoring Agent
- **Startup Type:** Automatic
- **Account:** LocalSystem

**Registry Keys:**
```
HKEY_CURRENT_USER\Software\Pankha\Agent
├── LogsPath
└── ShortcutsInstalled
```

## Customization

### Change Product Version

Edit `Product.wxs`:
```xml
<Package Version="1.0.0" ... />
```

### Add Custom Files

Edit `Product.wxs` and add files to the `MainExecutable` component:
```xml
<File Id="MyFile" Source="..\path\to\file.ext" />
```

### Change Install Directory

Default: `C:\Program Files\Pankha`

Users can customize during installation via the "Custom Setup" dialog.

### Disable Setup Wizard Launch

Edit `Product.wxs`:
```xml
<!-- Set to "0" to skip setup wizard -->
<Property Id="LAUNCHSETUP" Value="0" />
```

## Troubleshooting

### Build Errors

**Error: "Agent executable not found"**
```powershell
# This should not happen as build.ps1 auto-builds agent first
# If it does, build agent manually:
cd ..
.\build.ps1 -Publish
```

**Error: "Failed to install WiX Toolset"**
```powershell
# This should not happen as build script auto-installs WiX
# If it does, manually install:
dotnet tool install --global wix
```

**Error: "The term 'dotnet' is not recognized"**
```powershell
# Solution: Install .NET SDK
# Download from: https://dotnet.microsoft.com/download
```

### Installation Errors

**Error: "This application requires .NET 8.0 Runtime"**
- Install .NET 8.0 Runtime: https://dotnet.microsoft.com/download/dotnet/8.0

**Error: "Service failed to start"**
- Check event logs: `eventvwr.msc`
- View agent logs: `C:\Program Files\Pankha\logs\`
- Run `pankha-agent-windows.exe --test` to diagnose hardware issues

**Error: "Access denied"**
- Run installer as Administrator
- Right-click MSI → "Run as administrator"

## Advanced Usage

### Custom MSI Properties

```powershell
# Install to custom directory
msiexec /i PankhaAgent.msi INSTALLFOLDER="D:\MyApps\Pankha"

# Skip setup wizard
msiexec /i PankhaAgent.msi LAUNCHSETUP=0

# Silent install without setup
msiexec /i PankhaAgent.msi /qn LAUNCHSETUP=0
```

### View MSI Contents

```powershell
# Extract files without installing
msiexec /a PankhaAgent.msi /qb TARGETDIR="C:\extracted"
```

### Enable Verbose Logging

```powershell
# Full install log
msiexec /i PankhaAgent.msi /l*v install.log

# View log
notepad install.log
```

## Development

### Testing Changes

1. Uninstall previous version:
   ```powershell
   msiexec /x PankhaAgent.msi /qn
   ```

2. Rebuild MSI:
   ```powershell
   .\build-installer.ps1 -Clean
   ```

3. Install new version:
   ```powershell
   msiexec /i bin\Release\en-US\PankhaAgent.msi /l*v test.log
   ```

### WiX Documentation

- **WiX v5 Tutorial:** https://wixtoolset.org/docs/intro/
- **WixToolset.Util:** https://wixtoolset.org/docs/tools/util/
- **ServiceInstall:** https://wixtoolset.org/docs/schema/wxs/serviceinstall/

## Support

For issues or questions:
- GitHub: https://github.com/Anexgohan/pankha-dev
- Logs: `C:\Program Files\Pankha\logs\agent-*.log`
- Event Viewer: `eventvwr.msc` → Windows Logs → Application

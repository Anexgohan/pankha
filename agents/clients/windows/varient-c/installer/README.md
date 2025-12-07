# Pankha Agent - WixSharp MSI Installer

Professional Windows installer for Pankha Hardware Monitoring Agent, built with **WixSharp** (C# instead of WiX XML).

## What is WixSharp?

WixSharp is a framework for building MSI installers using C# instead of WiX XML. It provides:
- **Type-safe** installer definitions
- **Debuggable** installation logic (set breakpoints!)
- **Cleaner** code vs fighting XML syntax
- **Same output** - generates standard MSI packages

Official Repository: https://github.com/oleg-shilo/wixsharp

## Quick Build

```powershell
# Build the MSI installer
.\build-wixsharp.ps1

# Build with clean (removes previous build artifacts)
.\build-wixsharp.ps1 -Clean

# Build with verbose output
.\build-wixsharp.ps1 -Verbose
```

Output: `bin\x64\Release\PankhaAgent.msi`

## Installation

### GUI Installation
Double-click `PankhaAgent.msi` and follow the wizard.

### Silent Installation
```powershell
msiexec /i PankhaAgent.msi /qn /l*v install.log
```

### Custom Installation Path
```powershell
msiexec /i PankhaAgent.msi INSTALLFOLDER="D:\Custom\Path" /l*v install.log
```

### Install Without Starting Service
```powershell
msiexec /i PankhaAgent.msi STARTSERVICE=0
```

## Uninstallation

### Via Control Panel
1. Settings → Apps → Pankha Windows Agent → Uninstall
2. OR: Start Menu → Pankha Agent → Uninstall Pankha Agent

### Silent Uninstallation
```powershell
msiexec /x PankhaAgent.msi /qn /l*v uninstall.log
```

## Upgrading

To upgrade to a newer version:
1. Simply run the new MSI installer
2. The old version is **automatically removed**
3. Settings and configuration are preserved

**No manual uninstall needed!** The installer uses WiX MajorUpgrade to handle this automatically.

## Features

### ✅ Automatic Service Installation
- Installs "PankhaAgent" Windows Service
- Runs as LocalSystem (required for hardware access)
- Auto-starts on boot
- Configures automatic restart on failure (5-second delay)

### ✅ Complete Uninstall Cleanup
- Stops service gracefully
- Kills any remaining processes
- **Removes ALL files** including:
  - Main executable and DLLs
  - Configuration files (runtime-generated config.json)
  - Log files (all files in logs/ directory)
  - Start Menu shortcuts
  - Install directory itself

**Finally solved!** No more orphaned files after uninstall.

### ✅ Start Menu Shortcuts
- **Configure Pankha Agent** - Opens setup wizard
- **View Pankha Agent Logs** - Live log viewer (tail -f style)
- **Pankha Agent Status** - Shows service status + hardware info
- **Uninstall Pankha Agent** - Quick uninstall shortcut

### ✅ Automatic Upgrades
- UpgradeCode remains constant across versions
- Increment version number in `Program.cs` line 18
- New MSI automatically removes old version before installing

## Project Structure

```
installer/
├── Program.cs                          # WixSharp installer definition (MAIN FILE)
├── Pankha.WixSharpInstaller.csproj    # C# project file
├── build-wixsharp.ps1                  # Build script
├── License.rtf                         # MIT license (shown in installer UI)
├── README.md                           # This file
└── bin/x64/Release/
    └── PankhaAgent.msi                 # Generated MSI installer
```

## How It Works

### Build Process
1. `build-wixsharp.ps1` checks prerequisites (agent executable exists)
2. Restores NuGet packages (WixSharp + WixSharp.bin)
3. Compiles `Program.cs` into `Pankha.WixSharpInstaller.exe`
4. Runs the compiled executable, which:
   - Defines the installer structure in C#
   - Generates WiX XML internally
   - Compiles the XML into an MSI package
5. Output: `PankhaAgent.msi`

### Installation Sequence
1. Copies files to `C:\Program Files\Pankha\`
2. Registers PankhaAgent Windows Service
3. Configures service recovery (restart on failure)
4. Creates Start Menu shortcuts
5. Starts the service (if STARTSERVICE=1)

### Uninstallation Sequence
1. **AfterInstall Event Handler** executes (with elevated privileges)
2. Stops PankhaAgent service (graceful stop)
3. Kills any remaining `pankha-agent-windows.exe` processes
4. Waits 2 seconds for file handles to release
5. Deletes entire install directory recursively (`e.InstallDir.DeleteIfExists()`)
6. Removes Start Menu shortcuts folder
7. Service unregistration (handled by MSI ServiceControl)

**Key Insight**: The `AfterInstall` event runs *after* MSI's standard cleanup, with full elevated privileges, allowing us to forcefully delete everything that MSI might have missed (logs, runtime-generated files, etc.).

## Customizing the Installer

### Change Version Number
Edit `Program.cs` line 18:
```csharp
project.Version = new Version("1.0.6");  // Increment this for upgrades
```

### Change Install Directory Default
Edit `Program.cs` line 37:
```csharp
new Dir(@"%ProgramFiles%\Pankha",  // Change to @"D:\MyApps\Pankha" etc.
```

### Add More Files to Install
Edit `Program.cs` lines 40-45:
```csharp
agentExe,
new File(@"..\publish\win-x64\appsettings.json"),
new File(@"..\publish\win-x64\config.example.json"),
new File(@"..\publish\win-x64\mynewfile.dll"),  // Add new files here
```

### Modify Service Configuration
Edit `Program.cs` lines 23-35 (ServiceInstaller section):
```csharp
agentExe.ServiceInstaller = new ServiceInstaller
{
    Name = "PankhaAgent",
    Account = @"NetworkService",  // Change to run as different account
    DelayedAutoStart = true,      // Enable delayed auto-start
    // ... other properties
};
```

### Add Custom Installation Logic
Add code to the event handlers in `Program.cs`:
```csharp
project.BeforeInstall += (e) => {
    // Runs before installation starts
    // Example: Check prerequisites, validate system requirements
};

project.AfterInstall += (e) => {
    if (e.IsInstalling) {
        // Runs after successful installation
        // Example: Copy additional files, register COM components
    }
    if (e.IsUninstalling) {
        // Runs during uninstallation
        // Current implementation: Cleanup logic (stops service, deletes files)
    }
};
```

## Debugging

### Enable Verbose MSI Logging
```powershell
msiexec /i PankhaAgent.msi /l*v install-verbose.log
```

Log file will show:
- All MSI actions
- Custom action execution
- File copy operations
- Service installation steps
- AfterInstall event handler logs

### Debug the Installer Code
1. Build the installer in Debug mode:
   ```powershell
   dotnet build Pankha.WixSharpInstaller.csproj -c Debug
   ```

2. Run the builder to generate MSI:
   ```powershell
   .\bin\x64\Debug\net8.0\Pankha.WixSharpInstaller.exe
   ```

3. To debug the event handlers:
   - Add breakpoints in `OnBeforeInstall` or `OnAfterInstall`
   - Attach Visual Studio debugger to `msiexec.exe` process during installation
   - (Advanced: requires symbols and PDB files)

## Troubleshooting

### Build Fails: "Agent executable not found"
**Solution**: Build the agent first:
```powershell
cd ..
.\build.ps1 -Publish
cd installer
.\build-wixsharp.ps1
```

### Service Won't Start After Install
**Check**:
1. Review install log: `msiexec /i PankhaAgent.msi /l*v install.log`
2. Check Event Viewer → Windows Logs → Application
3. Check service manually: `services.msc` → PankhaAgent
4. Try starting manually: `.\pankha-agent-windows.exe --foreground`

### Uninstall Leaves Files Behind
**This should NOT happen with WixSharp!** If it does:
1. Check uninstall log: `msiexec /x PankhaAgent.msi /l*v uninstall.log`
2. Search for "[AfterInstall]" in the log to see cleanup execution
3. Look for errors in the cleanup logic
4. If service is running, uninstall can't delete exe - stop it first

### Upgrade Doesn't Remove Old Version
**Check UpgradeCode**: Line 13 in `Program.cs` must be **identical** across all versions:
```csharp
static readonly Guid UpgradeCode = new Guid("A1B2C3D4-E5F6-4A5B-8C9D-0E1F2A3B4C5D");
// ☝️ NEVER change this! Must be constant for automatic upgrades to work
```

## Comparison: WixSharp vs WiX XML

| Aspect | WiX XML (Old) | WixSharp (New) |
|--------|---------------|----------------|
| **Syntax** | XML with custom schema | C# with IntelliSense |
| **Errors** | Cryptic XML validation errors | Compile-time errors |
| **Debugging** | Parse MSI logs only | Set breakpoints, attach debugger |
| **Custom Actions** | Separate C# project + XML glue | Inline C# event handlers |
| **Property Passing** | CustomActionData XML strings | Direct C# variables |
| **Cleanup Logic** | util:RemoveFolderEx + CustomActionData | `e.InstallDir.DeleteIfExists()` |
| **Type Safety** | None (strings everywhere) | Full C# type checking |
| **Learning Curve** | Steep (WiX concepts + XML) | Gentle (just C#) |
| **Uninstall Bug** | ❌ Files left behind | ✅ Complete cleanup |

## Migration Notes (From WiX XML)

We migrated from WiX v6 XML to WixSharp v1.26.0 because:
1. **Uninstall bug unfixable** - util:RemoveFolderEx failed with `Action: Null` on components
2. **CustomActionData hell** - Property passing was error-prone and hard to debug
3. **XML fighting** - Spent days debugging syntax instead of solving problems
4. **No debugging** - Can't set breakpoints in XML, only read logs

**Result**: WixSharp solved the uninstall bug on first build, no debugging needed.

## Version History

### v1.0.5 (Current - WixSharp Migration)
- ✅ **Migrated to WixSharp** from WiX v6 XML
- ✅ **Fixed uninstall bug** - Now removes ALL files (logs, directories, shortcuts)
- ✅ **Automatic upgrades** - Just increment version number
- ✅ **Debuggable installer** - Set breakpoints in C# event handlers
- ✅ **Cleaner codebase** - 350 lines of C# vs 235 lines of XML

### v1.0.4 (Legacy - WiX XML)
- ❌ **Uninstall bug** - Left log files and empty directories
- ❌ **Shortcuts bug** - Double-terminal issue
- ✅ Service installation working
- ✅ Start Menu shortcuts (broken)

## Resources

- **WixSharp GitHub**: https://github.com/oleg-shilo/wixsharp
- **WixSharp Samples**: https://github.com/oleg-shilo/wixsharp/tree/master/Source/src/WixSharp.Samples
- **WixSharp Wiki**: https://github.com/oleg-shilo/wixsharp/wiki
- **Uninstall Cleanup Example**: https://github.com/oleg-shilo/wixsharp/issues/919
- **Service Installation Docs**: https://github.com/oleg-shilo/wixsharp/wiki/Deployment-scenarios

## Credits

Built with:
- **WixSharp v1.26.0** by Oleg Shilo
- **WiX Toolset v4** (generated by WixSharp under the hood)
- **.NET 8.0** (C# 12)

---

**Last Updated**: 2025-12-05
**Installer Version**: 1.0.5
**Technology**: WixSharp (C# instead of WiX XML)

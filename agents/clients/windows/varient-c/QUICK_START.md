# Quick Start Guide - Pankha Windows Agent

## Installation (Development)

### 1. Prerequisites

- Windows 10/11
- .NET 8 SDK: https://dotnet.microsoft.com/download/dotnet/8.0
- Administrator privileges

### 2. Build the Agent

```powershell
# Open PowerShell as Administrator in the project directory
cd "D:\Cache temp\temp\pankha-fan-control\dev\pankha-dev\agents\clients\windows\varient-c"

# Build the project
.\build.ps1
```

### 3. Run Hardware Test

```powershell
# Test hardware discovery
.\build.ps1 -Test

# Or manually:
dotnet run -- --test
```

Expected output:
```
=== Hardware Discovery Test ===

Discovering sensors...
✅ Discovered 15 sensors

📊 Top 10 Sensors:
  • CPU Package - 45.0°C (ok)
  • CPU Core #0 - 43.5°C (ok)
  • GPU Temperature - 52.0°C (ok)
  ...

Discovering fans...
✅ Discovered 5 fans

🌀 Fans:
  • CPU Fan - 1200 RPM (ok, Controllable)
  • Case Fan 1 - 800 RPM (ok, Controllable)
  ...

✅ System Health:
  • CPU Usage: 15.2%
  • Memory Usage: 42.8%
  • Agent Uptime: 2s

=== Test Complete ===
```

### 4. Run Setup Wizard

```powershell
dotnet run -- --setup
```

Follow the prompts to configure:
- Agent name
- Backend server URL
- Update interval
- Fan control enable/disable

Configuration will be saved to `config.json`.

### 5. Run in Foreground

```powershell
# Start the agent
dotnet run -- --foreground

# With debug logging
dotnet run -- --foreground --log-level Debug
```

Press Ctrl+C to stop.

## Building Release Executable

```powershell
# Build single-file executable
.\build.ps1 -Publish

# Output will be in: publish\win-x64\pankha-agent.exe
```

## Troubleshooting

### "Access Denied" Errors

Run PowerShell as Administrator:
```powershell
# Right-click PowerShell → "Run as Administrator"
```

### "LibreHardwareMonitor" Driver Issues

The first run may prompt to install a kernel driver. Click "Yes" to allow.

### No Sensors/Fans Detected

1. Ensure running as Administrator
2. Check motherboard compatibility
3. Enable debug logging: `--log-level Debug`
4. Check logs in `logs/` directory

### Fan Control Not Working

- Some motherboards block software fan control
- Check BIOS settings (disable Q-Fan, Smart Fan, etc.)
- Set fans to PWM mode (not DC mode)
- See hardware compatibility list

## Next Steps

1. ✅ Phase 1 Complete - Sensor/fan discovery working
2. 🚧 Phase 2 - WebSocket communication (in progress)
3. 📅 Phase 3 - Fan control testing
4. 📅 Phase 4 - Windows Service
5. 📅 Phase 5 - MSI Installer

## Getting Help

- GitHub Issues: https://github.com/Anexgohan/pankha-dev/issues
- Check logs: `logs/agent-YYYYMMDD.log`
- Run with debug: `--log-level Debug`

## Development

### Project Structure
```
varient-c/
├── Models/               # Data models
├── Hardware/             # Hardware abstraction
├── Program.cs           # Entry point
├── config.json          # Configuration (created after setup)
├── config.example.json  # Configuration template
└── logs/                # Log files
```

### Adding Features

See the main implementation plan:
`documentation/private/tasks-todo/task_21_agent_windows_claude.md`

### Testing Changes

```powershell
# Quick test
dotnet run -- --test

# Full rebuild and test
.\build.ps1 -Clean -Test
```

# Pankha Windows Agent (C# Implementation)

Production-ready Windows agent for Pankha fan control system using C# and LibreHardwareMonitor.

## Features

- ✅ **Sensor Monitoring**: CPU, GPU, motherboard, NVMe, memory temperatures
- ✅ **Fan Control**: PWM control with safety constraints
- ✅ **Sensor Deduplication**: Intelligent duplicate sensor removal
- ✅ **System Health**: CPU usage, memory usage, uptime tracking
- 🚧 **WebSocket Communication**: Real-time backend integration (in progress)
- 🚧 **Windows Service**: Auto-start on boot (planned)
- 🚧 **MSI Installer**: Easy deployment (planned)

## Status

**Phase 1 - Foundation & Sensor Discovery**: ✅ Complete

- [x] C# project structure
- [x] Configuration system
- [x] IHardwareMonitor interface
- [x] LibreHardwareMonitor adapter
- [x] Sensor discovery
- [x] Fan discovery
- [x] System health monitoring
- [x] Logging with Serilog
- [x] Command-line interface
- [x] Setup wizard

**Phase 2 - WebSocket Communication**: 🚧 In Progress

## Prerequisites

- Windows 10 1607+ or Windows 11
- .NET 8 Runtime (included in single-file build)
- Administrator privileges (required for hardware access)

## Building

```powershell
# Restore dependencies
dotnet restore

# Build in debug mode
dotnet build

# Build release (single-file executable)
dotnet publish -c Release -r win-x64 --self-contained
```

## Testing

### Hardware Discovery Test

```powershell
# Test sensor and fan discovery
dotnet run -- --test

# With custom config
dotnet run -- --config myconfig.json --test
```

### Setup Wizard

```powershell
# Interactive setup
dotnet run -- --setup
```

### Foreground Mode

```powershell
# Run in console (for testing)
dotnet run -- --foreground

# With debug logging
dotnet run -- --foreground --log-level Debug
```

## Configuration

Configuration is stored in `config.json`:

```json
{
  "agent": {
    "name": "Windows Agent - HOSTNAME",
    "agentId": "windows-hostname-abc123",
    "hostname": "HOSTNAME"
  },
  "backend": {
    "url": "ws://192.168.100.237:3000/websocket",
    "reconnectInterval": 5000,
    "maxReconnectAttempts": -1
  },
  "hardware": {
    "updateInterval": 3.0,
    "enableFanControl": true,
    "minFanSpeed": 30,
    "emergencyTemperature": 85.0
  },
  "monitoring": {
    "filterDuplicateSensors": false,
    "duplicateSensorTolerance": 1.0,
    "fanStepPercent": 5,
    "hysteresisTemp": 3.0
  },
  "logging": {
    "logLevel": "Information",
    "logDirectory": "logs",
    "maxLogFiles": 7,
    "maxLogFileSizeMB": 50
  }
}
```

## Command-Line Options

```
--config <path>       Path to configuration file (default: config.json)
--test                Test hardware discovery and exit
--setup               Run interactive setup wizard
--foreground          Run in foreground (non-service mode)
--log-level <level>   Log level (Trace, Debug, Information, Warning, Error, Critical)
--help                Show help
```

## Architecture

```
Pankha.WindowsAgent/
├── Models/               # Data models
│   ├── Sensor.cs        # Temperature sensor
│   ├── Fan.cs           # Fan with PWM control
│   ├── SystemHealth.cs  # System metrics
│   └── Configuration/   # Config classes
├── Hardware/             # Hardware abstraction
│   ├── IHardwareMonitor.cs          # Interface
│   └── LibreHardwareAdapter.cs      # LibreHardware wrapper
└── Program.cs           # Entry point
```

## Dependencies

- **LibreHardwareMonitorLib** (0.9.3) - Hardware monitoring
- **Serilog** (4.1.0) - Logging framework
- **Newtonsoft.Json** (13.0.3) - JSON serialization
- **System.CommandLine** (2.0.0-beta4) - CLI parsing

## Safety Features

1. **Minimum Fan Speed**: Enforced at 30% (configurable 20-50%)
2. **Emergency Temperature**: Triggers 100% fan speed at 85°C
3. **Rate Limiting**: Max 1 fan write per 100ms
4. **Deduplication**: Skips identical consecutive commands
5. **Administrator Required**: Prevents unauthorized access

## Testing Results

### Test System
- **OS**: Windows 11 23H2
- **CPU**: [TBD - Awaiting test]
- **Motherboard**: [TBD - Awaiting test]
- **Sensors Discovered**: [TBD]
- **Fans Discovered**: [TBD]
- **Fan Control**: [TBD]

## Known Issues

- Fan control compatibility varies by motherboard
- Some sensors may appear as duplicates (use deduplication)
- GPU fan control may require vendor SDKs (NVIDIA/AMD)

## Next Steps

1. Implement WebSocket communication with backend
2. Add command handling (setFanSpeed, etc.)
3. Implement Windows Service wrapper
4. Create MSI installer package
5. Hardware compatibility testing

## Contributing

See [CONTRIBUTING.md](../../../../../../CONTRIBUTING.md) (if exists)

## License

See repository root LICENSE file

## Support

For issues, please visit: https://github.com/Anexgohan/pankha-dev/issues

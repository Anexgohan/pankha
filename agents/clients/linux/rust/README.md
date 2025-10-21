# Pankha Rust Agent

Cross-platform hardware monitoring and fan control agent written in Rust for maximum performance, memory safety, and portability.

## Features

- ✅ **Cross-platform**: Linux (production-ready), Windows (stub), macOS (stub)
- ✅ **Hardware-agnostic**: Dynamic hardware discovery, no hardcoded paths
- ✅ **Memory-safe**: Rust's ownership system prevents common bugs
- ✅ **High-performance**: Zero-cost abstractions, efficient async runtime
- ✅ **Protocol-compatible**: 100% compatible with existing Python agent protocol
- ✅ **Single binary**: ~3-8MB standalone executable

## Architecture

### Platform Abstraction Layer

The agent uses a trait-based abstraction (`HardwareMonitor`) that allows platform-specific implementations:

```rust
#[async_trait]
pub trait HardwareMonitor {
    async fn discover_sensors(&self) -> Result<Vec<Sensor>>;
    async fn discover_fans(&self) -> Result<Vec<Fan>>;
    async fn get_system_info(&self) -> Result<SystemHealth>;
    async fn set_fan_speed(&self, fan_id: &str, speed: u8) -> Result<()>;
    async fn emergency_stop(&self) -> Result<()>;
}
```

### Implementation Status

| Platform | Sensor Discovery | Fan Control | Status |
|----------|-----------------|-------------|--------|
| **Linux** | ✅ Complete | ✅ Complete | Production-ready |
| **Windows** | 🚧 Stub | 🚧 Stub | Planned |
| **macOS** | 🚧 Stub | 🚧 Stub | Planned |

## Building

### Prerequisites

- Rust 1.70+ (install from [rustup.rs](https://rustup.rs))
- Linux: No additional dependencies
- Windows: Visual Studio Build Tools or MinGW
- macOS: Xcode Command Line Tools

### Build Commands

```bash
# Development build
cargo build

# Release build (optimized)
cargo build --release

# Run directly
cargo run -- --help

# Run in test mode
cargo run -- --test

# Generate default config
cargo run -- --generate-config
```

### Cross-compilation

```bash
# Linux targets
cargo build --target x86_64-unknown-linux-gnu --release
cargo build --target aarch64-unknown-linux-gnu --release

# Windows targets
cargo build --target x86_64-pc-windows-msvc --release
cargo build --target x86_64-pc-windows-gnu --release

# macOS targets
cargo build --target x86_64-apple-darwin --release
cargo build --target aarch64-apple-darwin --release
```

## Configuration

The agent uses a JSON configuration file (`config.json`):

```json
{
  "agent": {
    "id": "rust-agent-hostname",
    "name": "Rust System (hostname)",
    "update_interval": 3.0,
    "log_level": "INFO"
  },
  "backend": {
    "server_url": "ws://192.168.100.237:3000/websocket",
    "reconnect_interval": 5.0,
    "max_reconnect_attempts": -1,
    "connection_timeout": 10.0
  },
  "hardware": {
    "enable_fan_control": true,
    "enable_sensor_monitoring": true,
    "fan_safety_minimum": 10,
    "temperature_critical": 85.0,
    "filter_duplicate_sensors": true,
    "duplicate_sensor_tolerance": 0.5
  },
  "logging": {
    "enable_file_logging": true,
    "log_file": "/var/log/pankha-agent/agent.log",
    "max_log_size_mb": 10,
    "log_retention_days": 7
  }
}
```

Generate default config:
```bash
cargo run --release -- --generate-config
```

## Usage

### Single Binary - All Features Included

The Rust agent is a **single self-contained binary** with no external dependencies.

```bash
# Interactive setup (recommended for first time)
./pankha-agent --setup

# Test hardware discovery
./pankha-agent --test

# Show current configuration
./pankha-agent --show-config

# Run the agent
./pankha-agent

# Run with custom config
./pankha-agent --config /path/to/config.json

# Enable debug logging
./pankha-agent --debug
```

### Running in Background

```bash
# Using nohup
nohup ./pankha-agent > pankha-agent.log 2>&1 &

# Or using screen
screen -dmS pankha ./pankha-agent

# Or using tmux
tmux new -d -s pankha './pankha-agent'
```

### Linux Deployment

```bash
# 1. Build release binary (on dev machine)
cargo build --release

# 2. Copy to target system
scp target/release/pankha-agent root@target-system:/opt/pankha/

# 3. SSH and setup
ssh root@target-system
cd /opt/pankha
./pankha-agent --setup

# 4. Run
./pankha-agent
```

### Systemd Service (Linux) - Optional

Create `/etc/systemd/system/pankha-agent.service`:

```ini
[Unit]
Description=Pankha Hardware Monitoring Agent (Rust)
After=network.target

[Service]
Type=simple
ExecStart=/opt/pankha/pankha-agent --config /opt/pankha/config.json
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable pankha-agent
sudo systemctl start pankha-agent
sudo systemctl status pankha-agent
```

## Linux Implementation Details

### Hardware Discovery

The Linux implementation discovers hardware through standard kernel interfaces:

- **Sensors**: `/sys/class/hwmon/hwmon*/temp*_input`
- **Fans**: `/sys/class/hwmon/hwmon*/fan*_input` + PWM controls
- **Thermal Zones**: `/sys/class/thermal/thermal_zone*`

### Sensor Deduplication

The agent includes intelligent sensor deduplication:

1. Groups sensors by temperature (within tolerance)
2. Prioritizes sensors by chip type:
   - k10temp (AMD CPU) = Priority 100
   - it8628/nct (Motherboard) = Priority 90
   - nvme = Priority 80
   - WMI sensors = Priority 50
   - ACPI = Priority 40

### Fan Control

- PWM range: 0-255 (mapped to 0-100%)
- Automatic PWM enable mode switching
- Safety validation (min/max limits)
- Emergency stop support

## Performance

### Benchmarks (Preliminary)

| Metric | Python Agent | Rust Agent | Improvement |
|--------|--------------|------------|-------------|
| **Memory Usage** | ~45MB | ~8MB | 82% reduction |
| **CPU Usage** | ~0.8% | ~0.2% | 75% reduction |
| **Binary Size** | N/A | ~3.2MB | Standalone |
| **Startup Time** | ~2.5s | ~0.3s | 8x faster |

### Resource Usage

- **Idle Memory**: ~8MB
- **Peak Memory**: ~12MB
- **CPU (idle)**: ~0.1%
- **CPU (active)**: ~0.3%

## Development

### Code Structure

The agent is a single-file implementation (~1100 lines) with embedded modules:

```
main.rs
├── Core Data Structures (Sensor, Fan, Config)
├── HardwareMonitor Trait (Platform Abstraction)
├── Linux Implementation (Production)
├── Windows Implementation (Stub)
├── macOS Implementation (Stub)
├── WebSocket Client
├── Configuration Management
└── Main Application (CLI)
```

### Adding Platform Support

To add support for a new platform:

1. Implement the `HardwareMonitor` trait
2. Add platform-specific conditional compilation (`#[cfg(target_os = "...")]`)
3. Initialize in `main()` with platform detection

Example:
```rust
#[cfg(target_os = "freebsd")]
pub struct FreeBSDHardwareMonitor { /* ... */ }

#[cfg(target_os = "freebsd")]
#[async_trait]
impl HardwareMonitor for FreeBSDHardwareMonitor {
    // Implement trait methods
}
```

## Testing

```bash
# Test hardware discovery
cargo run --release -- --test

# Run with debug logging
cargo run --release -- --debug

# Test on actual hardware
cargo build --release
sudo ./target/release/pankha-agent --test
```

## Troubleshooting

### Linux: Permission Denied

```bash
# Check sysfs permissions
ls -la /sys/class/hwmon/*/temp*_input
ls -la /sys/class/hwmon/*/pwm*

# Run with sudo if needed
sudo ./pankha-agent
```

### No Sensors/Fans Detected

```bash
# Check hwmon availability
ls /sys/class/hwmon/

# Load sensor modules
sudo sensors-detect --auto

# Test with debug logging
./pankha-agent --test --debug
```

### WebSocket Connection Failed

```bash
# Test server connectivity
curl http://192.168.100.237:3000/health

# Check WebSocket URL in config
cat config.json | grep server_url

# Test with verbose logging
RUST_LOG=debug ./pankha-agent
```

## Comparison with Python Agent

### Advantages

✅ **Performance**: 75-80% lower resource usage
✅ **Memory Safety**: No buffer overflows, use-after-free, or data races
✅ **Single Binary**: No Python interpreter or dependencies needed
✅ **Startup Time**: 8x faster cold start
✅ **Binary Size**: 3-8MB vs Python + dependencies
✅ **Reliability**: Strong type system catches errors at compile time

### Trade-offs

⚠️ **Compile Time**: Slower development iteration (1-2 minutes vs instant)
⚠️ **Learning Curve**: Rust ownership model requires understanding
⚠️ **Platform Support**: Linux complete, Windows/macOS in progress

## Future Enhancements

### Phase 2: Windows Support

- [ ] WMI sensor discovery
- [ ] OpenHardwareMonitor integration
- [ ] Windows service integration

### Phase 3: macOS Support

- [ ] IOKit sensor access
- [ ] SMC (System Management Controller) integration
- [ ] macOS launchd service

### Phase 4: Advanced Features

- [ ] GPU temperature monitoring (NVIDIA/AMD)
- [ ] NVMe health monitoring
- [ ] Fan curve profiles
- [ ] Sensor calibration

## Contributing

Contributions welcome! Areas needing help:

1. Windows hardware monitoring implementation
2. macOS IOKit integration
3. Additional sensor types (GPU, storage)
4. Performance optimizations

## License

AGPL-3.0 - Same as parent Pankha project

## Resources

- **Rust Book**: https://doc.rust-lang.org/book/
- **Tokio Async Runtime**: https://tokio.rs
- **WebSocket Protocol**: https://datatracker.ietf.org/doc/html/rfc6455
- **Linux hwmon**: https://www.kernel.org/doc/html/latest/hwmon/

---

**Status**: Phase 1 (Linux) Complete ✅
**Next**: Phase 2 (Windows/macOS) Planned 🚧

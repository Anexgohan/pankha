# Pankha Mock Agents

Lightweight mock agent system for testing the Pankha backend. Simulates multiple client agents with realistic random sensor and fan data.

## Features

✅ **Lightweight** - Minimal resource usage, can run dozens of agents simultaneously
✅ **Realistic Data** - Generates realistic temperature variations with sine wave patterns
✅ **WebSocket Protocol** - Full compatibility with Pankha backend protocol
✅ **Easy Management** - Simple CLI for starting, stopping, and monitoring agents
✅ **Interactive Mode** - Guided wizard for quick setup
✅ **Process Management** - Built-in daemon management with PID files
✅ **Standard Logging** - Python logging with INFO/DEBUG/WARN/ERROR levels
✅ **Log Rotation** - Automatic 15-minute log rotation to save disk space

## Prerequisites

- **Python 3.7+**
- **websockets library**: `pip3 install websockets`

## Quick Start

### Interactive Mode (Recommended)

```bash
./mock-agents --build
```

Follow the interactive wizard to configure your mock agents.

### Command-Line Mode

Create 5 agents with 5-9 sensors and 3-7 fans each:

```bash
./mock-agents --amount 5 --name client_ --sensors 5,9 --fans 3,7
```

### Start All Agents

```bash
./mock-agents --start
```

### Check Status

```bash
./mock-agents --status
```

### Stop All Agents

```bash
./mock-agents --stop
```

## Usage Examples

### Create Custom Configuration

```bash
# Create 10 agents with custom ranges
./mock-agents --amount 10 --name test_ --sensors 10,20 --fans 5,10 --rpm 500,4000

# Create agents for specific server
./mock-agents --amount 3 --name prod_ --sensors 5,9 --fans 3,5 --server ws://192.168.1.100:3000/websocket
```

### Management Commands

```bash
# Start all configured agents
./mock-agents --start

# Stop all running agents
./mock-agents --stop

# Restart all agents
./mock-agents --restart

# Show detailed status
./mock-agents --status
```

## Command Reference

### Options

| Option | Description |
|--------|-------------|
| `-h`, `--help` | Show help message |
| `-b`, `--build` | Interactive configuration wizard |
| `--amount <N>` | Number of agents to create (1-100) |
| `--name <prefix>` | Agent name prefix (default: `client_`) |
| `--sensors <min,max>` | Sensor count range per agent |
| `--fans <min,max>` | Fan count range per agent |
| `--speed <min,max>` | Fan speed % range (default: 0,100) |
| `--rpm <min,max>` | Fan RPM range (default: 0,3000) |
| `--server <url>` | WebSocket server URL |
| `--start` | Start all agents |
| `--stop` | Stop all agents |
| `--restart` | Restart all agents |
| `--status` | Show agent status |

### Range Format

All ranges use the format `min,max`:
- `5,9` - Random value between 5 and 9 (inclusive)
- `0,3000` - Random value between 0 and 3000

## Architecture

### Directory Structure

```
mock-agents/linux/
├── mock-agents              # Main CLI script
├── mock_agent.py            # Individual agent implementation
├── config/                  # Configuration directory
│   ├── agents.json          # Master agent list
│   └── client_*.json        # Individual agent configs
├── logs/                    # Log directory (15-minute rotation)
│   └── client_*.log         # Individual agent logs
├── pids/                    # PID files for process management
│   └── client_*.pid         # Individual agent PID files
└── README.md                # This file
```

### How It Works

1. **Configuration**: `mock-agents` creates configuration for each agent
2. **Process Management**: Each agent runs as a separate Python process
3. **WebSocket Communication**: Agents connect to backend and send data every 3 seconds
4. **Hardware Simulation**: Realistic temperature variations using sine waves + noise
5. **Fan Control**: Responds to backend commands (setFanSpeed, emergencyStop)

### Data Generation

**Sensors**:
- Temperature variations using sine wave + random noise
- Realistic sensor types (CPU, GPU, Motherboard, NVMe, VRM, Chipset)
- Configurable temperature ranges
- Base temperature + periodic variation + noise

**Fans**:
- RPM calculated from speed percentage
- Gradual speed adjustments (not instant)
- ±5% RPM variation for realism
- Responds to speed change commands

**System Health**:
- Random CPU usage (10-60%)
- Random memory usage (30-70%)
- Actual agent uptime tracking

## Logging

### Log Levels

- **INFO**: Normal operation, important events (startup, connection, commands)
- **DEBUG**: Detailed information (data transmissions, message details)
- **WARN**: Warning conditions (failed attempts, unusual situations)
- **ERROR**: Error conditions (connection failures, command errors)

### Log Rotation

- **Rotation**: Every 15 minutes
- **Retention**: Last 30 minutes (current + 1 backup)
- **Format**: `[YYYY-MM-DD HH:MM:SS] [LEVEL] message`

### Viewing Logs

```bash
# View live logs for specific agent
tail -f logs/client_01.log

# View last 50 lines
tail -50 logs/client_01.log

# Search for errors
grep ERROR logs/client_01.log

# View all agent logs
tail -f logs/*.log
```

## Protocol Compatibility

Mock agents implement the same WebSocket protocol as real Pankha agents:

### Registration Message

```json
{
  "type": "register",
  "data": {
    "agentId": "mock-client_01-abc123",
    "name": "client_01",
    "agent_version": "1.0.0-mock",
    "update_interval": 3000,
    "capabilities": {
      "sensors": [...],
      "fans": [...],
      "fan_control": true
    }
  }
}
```

### Data Message (every 3 seconds)

```json
{
  "type": "data",
  "data": {
    "agentId": "mock-client_01-abc123",
    "timestamp": 1234567890123,
    "sensors": [...],
    "fans": [...],
    "systemHealth": {...}
  }
}
```

### Command Handling

Supports all backend commands:
- `setFanSpeed`: Change fan speed
- `emergencyStop`: Set all fans to 100%
- `ping`: Respond with pong

## Performance

### Resource Usage (per agent)

- **Memory**: ~15-20 MB per agent
- **CPU**: <1% per agent (mostly idle)
- **Network**: ~2-5 KB/s per agent (data transmission)
- **Disk**: ~1-2 MB per agent (logs with rotation)

### Scaling

Successfully tested with:
- ✅ **10 agents**: Negligible system impact
- ✅ **50 agents**: ~750 MB RAM, <5% CPU
- ✅ **100 agents**: ~1.5 GB RAM, ~10% CPU

## Troubleshooting

### Agents Won't Start

**Problem**: `mock-agents --start` shows errors

**Solution**:
```bash
# Check if websockets is installed
pip3 install websockets

# Check Python version (needs 3.7+)
python3 --version

# Check for errors in logs
cat logs/client_01.log
```

### Connection Failures

**Problem**: Agents can't connect to backend

**Solution**:
```bash
# Verify backend is running
curl http://192.168.100.237:3000/health

# Check server URL in config
cat config/agents.json | grep server_url

# Test WebSocket connection
wscat -c ws://192.168.100.237:3000/websocket
```

### Stale PID Files

**Problem**: `--status` shows running but agents aren't actually running

**Solution**:
```bash
# Remove stale PID files
rm pids/*.pid

# Try starting again
./mock-agents --start
```

### Too Many Agents

**Problem**: System is slow with many agents

**Solution**:
```bash
# Stop all agents
./mock-agents --stop

# Reduce agent count
./mock-agents --build  # Create fewer agents

# Or increase update interval (edit config/agents.json)
# Change "update_interval": 3.0 to 5.0 or 10.0
```

## Development

### Modifying Agent Behavior

Edit `mock_agent.py` to change:
- Temperature variation patterns
- Fan control logic
- Hardware discovery simulation
- WebSocket protocol handling

### Adding New Features

The mock agent system is designed to be extensible:
- Add new sensor types in `MockHardware._create_sensors()`
- Modify temperature algorithms in `MockHardware.update_sensors()`
- Add new commands in `MockWebSocketClient.handle_command()`

## Testing Scenarios

### Scenario 1: Load Testing

```bash
# Create 50 agents
./mock-agents --amount 50 --name load_ --sensors 10,20 --fans 5,10
./mock-agents --start

# Monitor backend performance
curl http://192.168.100.237:3000/health
```

### Scenario 2: Edge Cases

```bash
# Many sensors, few fans
./mock-agents --amount 5 --name edge1_ --sensors 50,100 --fans 1,2

# Few sensors, many fans
./mock-agents --amount 5 --name edge2_ --sensors 1,3 --fans 20,30
```

### Scenario 3: Connection Stability

```bash
# Start agents
./mock-agents --start

# Stop backend (agents should attempt reconnection)
# Restart backend (agents should reconnect automatically)
```

## Windows Deployment

To deploy on Linux testing systems:

```bash
# From Windows development machine
scp -r "D:\Cache temp\temp\pankha-fan-control\dev\pankha-dev\agents\clients\mock-agents\linux\*" root@192.168.100.238:/root/anex/proxmox/misc-scripts/pankha-mock-agents/

# SSH to Linux system
ssh root@192.168.100.238
cd /root/anex/proxmox/misc-scripts/pankha-mock-agents/

# Install dependencies
pip3 install websockets

# Run interactive setup
./mock-agents --build

# Start agents
./mock-agents --start
```

## Integration with Pankha Development

### Development Workflow

1. **Local Development**: Edit backend code on Windows
2. **Deploy Backend**: Copy to Linux server and rebuild Docker
3. **Start Mock Agents**: Test with mock agents on separate VM
4. **Verify**: Check dashboard shows all mock agents
5. **Test Features**: Use mock agents to test new features

### CI/CD Integration

Mock agents can be used in automated testing:
```bash
# Start mock agents before tests
./mock-agents --amount 10 --name ci_ --sensors 5,9 --fans 3,5
./mock-agents --start

# Run backend tests
cd /path/to/backend && npm test

# Stop mock agents after tests
./mock-agents --stop
```

## FAQ

**Q: Can I run mock agents on the same machine as the backend?**
A: Yes, but it's better to run them on a separate VM to simulate real network conditions.

**Q: How do I change the server URL after creating agents?**
A: Edit `config/agents.json` and change the `default_server` field, then restart agents.

**Q: Can mock agents coexist with real agents?**
A: Yes! Mock agents use different agent IDs and won't conflict with real agents.

**Q: Why do agent names have random suffixes?**
A: The agent ID includes a UUID to ensure uniqueness when testing multiple configurations.

**Q: Can I create agents with fixed sensor/fan counts?**
A: Yes, use the same min/max value: `--sensors 10,10 --fans 5,5`

## License

Part of the Pankha project. See main project LICENSE for details.

## Contributing

For bug reports and feature requests, please refer to the main Pankha project documentation.

---

**Last Updated**: 2025-01-07
**Version**: 1.0.0
**Maintainer**: Pankha Development Team

# Agent Configuration

Agents are configured through a JSON file that controls how they communicate with the backend and interact with hardware.

## Configuration File Location

The configuration file is created during setup and stored as `config.json` in the agent's directory.

To regenerate the configuration, run:

```bash
./pankha-agent --setup
```

## Configuration Structure

Here's a complete example configuration with explanations:

```json
{
  "agent": {
    "id": "Linux-myserver-a1b2c3d4",
    "name": "myserver",
    "update_interval": 3.0,
    "log_level": "INFO"
  },
  "backend": {
    "server_url": "ws://192.168.1.100:3000/websocket",
    "reconnect_interval": 30.0,
    "max_reconnect_attempts": -1,
    "connection_timeout": 10.0
  },
  "hardware": {
    "enable_fan_control": true,
    "enable_sensor_monitoring": true,
    "fan_safety_minimum": 30,
    "filter_duplicate_sensors": false,
    "duplicate_sensor_tolerance": 2.0,
    "fan_step_percent": 5,
    "hysteresis_temp": 3.0,
    "emergency_temp": 80.0
  },
  "logging": {
    "enable_file_logging": true,
    "log_file": "/var/log/pankha-agent/agent.log",
    "max_log_size_mb": 10,
    "log_retention_days": 7
  }
}
```

## Agent Section

**id**: Unique identifier for this agent (auto-generated during setup)

**name**: Friendly name shown in the dashboard (defaults to hostname)

**update_interval**: How often to send data to the backend (seconds, default: 3.0)

**log_level**: Logging verbosity - `DEBUG`, `INFO`, `WARN`, or `ERROR`

## Backend Section

**server_url**: WebSocket URL of your backend server

Format: `ws://[backend-ip]:[port]/websocket`

Example: `ws://192.168.1.100:3000/websocket`

**reconnect_interval**: Seconds to wait before reconnecting after connection loss (default: 30)

**max_reconnect_attempts**: Number of reconnect attempts (-1 for infinite)

**connection_timeout**: Seconds to wait for connection before timeout (default: 10)

## Hardware Section

**enable_fan_control**: Allow the backend to control fan speeds (default: true)

**enable_sensor_monitoring**: Send temperature data to backend (default: true)

**fan_safety_minimum**: Minimum fan speed percentage (default: 30)

This prevents fans from stopping completely, which could damage hardware.

**filter_duplicate_sensors**: Remove sensors with identical readings (default: false)

**duplicate_sensor_tolerance**: Temperature difference threshold for duplicate detection (default: 2.0)

**fan_step_percent**: Step size for fan speed adjustments (default: 5)

**hysteresis_temp**: Temperature hysteresis to prevent rapid fan speed changes (default: 3.0)

**emergency_temp**: Temperature threshold that triggers maximum fan speed (default: 80.0)

When disconnected from the backend, the agent monitors temperatures locally. If any sensor reaches this threshold, all fans are immediately set to 100%.

## Logging Section

**enable_file_logging**: Write logs to file (default: true)

**log_file**: Path to log file (default: `/var/log/pankha-agent/agent.log`)

**max_log_size_mb**: Maximum log file size before rotation (default: 10)

**log_retention_days**: Days to keep old log files (default: 7)

## Editing Configuration

You can manually edit `config.json` with any text editor. After making changes, restart the agent:

```bash
./pankha-agent --stop
./pankha-agent --start
```

## Validating Configuration

Check if your configuration is valid:

```bash
./pankha-agent --check-config
```

This will report any errors in the configuration file.

## Common Scenarios

**Running multiple agents on one server**

Each agent needs its own directory and configuration. Copy the binary to different directories and run `--setup` in each.

**Connecting to a remote backend**

Update the `server_url` to point to your backend server's IP:

```json
"server_url": "ws://backend.example.com:3000/websocket"
```

**Disabling fan control (monitoring only)**

Set `enable_fan_control` to false:

```json
"enable_fan_control": false
```

The agent will still monitor temperatures but won't accept fan control commands.

**Increasing update frequency**

For faster updates, reduce the `update_interval`:

```json
"update_interval": 1.0
```

Note: This increases network traffic and backend load.

# Linux Agent

The Pankha Linux agent is a lightweight, single-binary application written in Rust. It interacts directly with the Linux kernel's `sysfs` interface to read temperatures and control PWM fans.

## Features
*   **Zero Dependencies**: No Python or Ruby runtime required.
*   **Low Resource Usage**: Typically uses <10MB RAM and <1% CPU.
*   **Hardware Support**: Supports any sensor supported by `lm-sensors`.

## Installation

### 1. Download

Download the binary for your architecture from the [Releases Page](https://github.com/Anexgohan/pankha/releases).

**x86_64 (Intel/AMD)**:
```bash
wget -O pankha-agent-linux_x86_64 https://github.com/Anexgohan/pankha/releases/latest/download/pankha-agent-linux_x86_64
chmod +x pankha-agent-linux_x86_64
```

**ARM64 (Raspberry Pi/SBC)**:
```bash
wget -O pankha-agent-linux_arm64 https://github.com/Anexgohan/pankha/releases/latest/download/pankha-agent-linux_arm64
chmod +x pankha-agent-linux_arm64
```

### 2. Interactive Setup

Run the setup wizard to generate your configuration file and connect to your server.

```bash
./pankha-agent-linux_x86_64 --setup
```

You will be asked for:
1.  **Backend URL**: e.g., `ws://192.168.1.50:3000/websocket`
2.  **Agent Name**: e.g., `media-server`

### 3. Run as a Service (Systemd)

To ensure the agent runs on boot, create a systemd service file.

**File**: `/etc/systemd/system/pankha-agent.service`

```ini
[Unit]
Description=Pankha Fan Control Agent
After=network.target

[Service]
ExecStart=/opt/pankha/pankha-agent-linux_x86_64 --start
WorkingDirectory=/opt/pankha
Restart=always
User=root

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl enable pankha-agent
sudo systemctl start pankha-agent
```

## CLI Commands

| Command | Short | Description |
|---------|-------|-------------|
| `--start` | `-s` | Start the agent daemon in background |
| `--stop` | `-x` | Stop the agent daemon |
| `--restart` | `-r` | Restart the agent daemon |
| `--status` | `-i` | Show agent status and connection info |
| `--config` | `-c` | Show current loaded configuration |
| `--setup` | `-e` | Run interactive setup wizard |
| `--log-show` | `-l` | View logs (live tail) |
| `--log-show N` | `-l N` | View last N log lines |
| `--log-level LEVEL` | | Set log level (TRACE/DEBUG/INFO/WARN/ERROR) |
| `--test` | | Hardware discovery test |
| `--help` | `-h` | Show help |
| `--version` | `-V` | Show version |

### Quick Examples
```bash
./pankha-agent -s        # Start daemon
./pankha-agent -i        # Check status
./pankha-agent -l        # View live logs
./pankha-agent -x        # Stop daemon
```

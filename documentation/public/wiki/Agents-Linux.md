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
wget -O pankha-agent https://github.com/Anexgohan/pankha/releases/latest/download/pankha-agent-linux_x86_64
chmod +x pankha-agent
```

**ARM64 (Raspberry Pi/SBC)**:
```bash
wget -O pankha-agent https://github.com/Anexgohan/pankha/releases/latest/download/pankha-agent-linux_arm64
chmod +x pankha-agent
```

### 2. Interactive Setup

Run the setup wizard to generate your configuration file and connect to your server.

```bash
./pankha-agent --setup
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
ExecStart=/opt/pankha/pankha-agent --start
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

*   `--start`: Run the agent in the foreground (or as daemon).
*   `--status`: Show current connection status and discovered hardware.
*   `--config`: Show the current loaded configuration.
*   `--setup`: Run the interactive configuration wizard.

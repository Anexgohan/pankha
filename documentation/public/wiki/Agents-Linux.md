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

### 2. Recommended: Interactive Setup

The easiest way to get started is by running the interactive setup wizard. This "all-in-one" command handles everything from initial configuration to systemd service installation.

```bash
./pankha-agent --setup
```

The wizard will guide you through:
1.  **Configuration**: Connecting to your server (e.g., `ws://192.168.1.50:3000/websocket`) and naming the agent.
2.  **Auto-Start**: Prompting you to install the agent as a **systemd service** so it starts automatically on boot.

---

### 3. Service Management (Systemd)

If you skipped the service installation during `--setup`, or want to manage it manually, you can use these commands:

**Install & Start on Boot**:
```bash
./pankha-agent --install-service
```
This automatically creates everything needed at `/etc/systemd/system/pankha-agent.service` and starts the daemon.

**Remove Service**:
```bash
./pankha-agent --uninstall-service
```

#### Manual Control
You can always use standard systemd commands for status and logs:
```bash
systemctl status pankha-agent
journalctl -u pankha-agent -f
```

## CLI Commands

| Command                   | Short | Description                                                                 |
| ------------------------- | ----- | --------------------------------------------------------------------------- |
| `--start`                 | `-s`  | Start the agent daemon in background                                        |
| `--stop`                  | `-x`  | Stop the agent daemon                                                       |
| `--restart`               | `-r`  | Restart the agent daemon                                                    |
| `--status`                | `-i`  | Show agent status                                                           |
| `--config`                | `-c`  | Show current configuration                                                  |
| `--setup`                 | `-e`  | Run interactive setup wizard                                                |
| `--install-service`       | `-I`  | Install systemd service for auto-start on boot                              |
| `--uninstall-service`     | `-U`  | Uninstall systemd service                                                   |
| `--log-show [<LOG_SHOW>]` | `-l`  | Show agent logs (tail -f by default, or tail -n <lines> if provided)        |
| `--log-level <LOG_LEVEL>` |       | Set log level (TRACE, DEBUG, INFO, WARN, ERROR). Use with --start/--restart |
| `--check`                 |       | Run health check (verify config, service, directories)                      |
| `--test`                  |       | Test mode (hardware discovery only)                                         |
| `--help`                  | `-h`  | Print help                                                                  |
| `--version`               | `-V`  | Print version                                                               |

### Quick Examples
```bash
./pankha-agent -s        # Start daemon
./pankha-agent -i        # Check status
./pankha-agent -l        # View live logs
./pankha-agent -x        # Stop daemon
```

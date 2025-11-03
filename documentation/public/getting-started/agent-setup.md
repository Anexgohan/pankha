# Agent Setup Guide

Agents run on each system you want to monitor and control. They communicate with the backend server via WebSocket and have direct access to hardware sensors and fans.

## Important Notes

- Currently only Linux agents are supported (Windows coming soon)
- Agents must be manually started after system reboot (systemd service support coming soon)
- Root access is required for hardware control

## Installation

### For Intel/AMD Systems (x86_64)

Download the binary:

```bash
wget https://github.com/Anexgohan/pankha/releases/latest/download/pankha-agent-linux_x86_64
chmod +x pankha-agent-linux_x86_64
```

Or using curl:

```bash
curl -fsSLO https://github.com/Anexgohan/pankha/releases/latest/download/pankha-agent-linux_x86_64
chmod +x pankha-agent-linux_x86_64
```

### For ARM64 Systems (Raspberry Pi, etc.)

Download the binary:

```bash
wget https://github.com/Anexgohan/pankha/releases/latest/download/pankha-agent-linux_arm64
chmod +x pankha-agent-linux_arm64
```

Or using curl:

```bash
curl -fsSLO https://github.com/Anexgohan/pankha/releases/latest/download/pankha-agent-linux_arm64
chmod +x pankha-agent-linux_arm64
```

## First-Time Setup

Before starting the agent, you need to configure it. The setup wizard will walk you through the process:

```bash
./pankha-agent-linux_x86_64 --setup
```

The wizard will ask for:

1. **Backend server URL** - The WebSocket address of your backend (e.g., ws://192.168.1.100:3000/websocket)
2. **Agent name** - A friendly name for this system (defaults to hostname)
3. **Hardware settings** - Fan control options and safety limits

Configuration is saved to `config.json` in the agent's directory.

## Starting the Agent

After setup is complete, start the agent:

```bash
./pankha-agent-linux_x86_64 --start
```

The agent will:
- Discover all temperature sensors
- Detect PWM-controllable fans
- Connect to the backend
- Start sending data every 3 seconds

## Managing the Agent

Check status:

```bash
./pankha-agent-linux_x86_64 --status
```

Stop the agent:

```bash
./pankha-agent-linux_x86_64 --stop
```

View logs:

```bash
./pankha-agent-linux_x86_64 --logs
```

See all available commands:

```bash
./pankha-agent-linux_x86_64 --help
```

## Troubleshooting

**Agent won't start**

Make sure you ran `--setup` first. Check that the backend server is reachable:

```bash
curl http://your-backend-ip:3000/health
```

**No sensors detected**

Verify lm-sensors is working:

```bash
sensors
```

If sensors show up but the agent doesn't detect them, you may need to run the agent as root:

```bash
sudo ./pankha-agent-linux_x86_64 --start
```

**Fan control doesn't work**

Check if your fans support PWM control:

```bash
ls -la /sys/class/hwmon/*/pwm*
```

If no pwm files exist, your fans may not support speed control.

## Verifying Connection

Once the agent is running, check the dashboard at http://your-backend-ip:3000. You should see your system appear in the systems list with real-time temperature and fan data.

If the agent shows as "offline" in the dashboard, check the agent logs for connection errors.

## Multiple Agents

You can run agents on as many systems as you want. Each agent connects to the same backend server and shows up as a separate system in the dashboard.

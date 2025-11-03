# Agent Troubleshooting

Common issues with Pankha agents and their solutions.

## Agent Won't Start

If the agent fails to start or exits immediately:

**Run setup first**:

Make sure you've completed the initial configuration:

```bash
./pankha-agent --setup
```

**Check configuration file**:

Verify `config.json` exists and is valid:

```bash
./pankha-agent --check-config
```

**Check for permission errors**:

The agent needs access to `/sys/class/hwmon/`. Try running as root:

```bash
sudo ./pankha-agent --start
```

## Cannot Connect to Backend

If the agent reports connection errors:

**Test backend connectivity**:

```bash
curl http://your-backend-ip:3000/health
```

If this fails, the backend is unreachable from the agent machine.

**Verify WebSocket URL**:

Check `config.json` has the correct URL format:

```json
"server_url": "ws://192.168.1.100:3000/websocket"
```

Common mistakes:
- Using `http://` instead of `ws://`
- Wrong IP address or port
- Missing `/websocket` path

**Check firewall**:

Make sure the agent can reach the backend port:

```bash
telnet your-backend-ip 3000
```

or

```bash
nc -zv your-backend-ip 3000
```

**View agent logs**:

```bash
./pankha-agent --logs
```

or

```bash
tail -f /var/log/pankha-agent/agent.log
```

## No Sensors Detected

If the agent starts but reports zero sensors:

**Check lm-sensors**:

Verify sensors are visible to the system:

```bash
sensors
```

If sensors aren't showing up, install and configure lm-sensors:

```bash
sudo apt-get install lm-sensors
sudo sensors-detect
```

Follow the prompts and accept all defaults.

**Check hwmon directory**:

```bash
ls -la /sys/class/hwmon/
```

Each `hwmon*` directory should contain sensor files.

**Permission issues**:

Some systems require root access to read sensors:

```bash
sudo ./pankha-agent --start
```

## Fan Control Not Working

If fans are detected but speed control doesn't work:

**Verify PWM support**:

Check for PWM control files:

```bash
ls -la /sys/class/hwmon/*/pwm*
```

If no `pwm*` files exist, your fans may not support speed control.

**Test manual control**:

Try setting fan speed manually:

```bash
echo 128 | sudo tee /sys/class/hwmon/hwmon0/pwm1
```

If this works, the hardware supports PWM. If it doesn't change the fan speed, the fan controller may not support it.

**Check enable files**:

Some systems require enabling PWM mode first:

```bash
cat /sys/class/hwmon/hwmon0/pwm1_enable
```

If it's set to `0` or `1`, try setting it to `1` (manual mode):

```bash
echo 1 | sudo tee /sys/class/hwmon/hwmon0/pwm1_enable
```

## Agent Shows as Offline

If the agent is running but appears offline in the dashboard:

**Check agent status**:

```bash
./pankha-agent --status
```

**Restart the agent**:

```bash
./pankha-agent --stop
./pankha-agent --start
```

**Check system time**:

Time sync issues can cause connection problems:

```bash
date
```

Make sure the system time is correct. Install NTP if needed:

```bash
sudo apt-get install ntp
```

## High CPU Usage

If the agent uses excessive CPU:

**Check update interval**:

A very low update interval increases CPU usage. Edit `config.json`:

```json
"update_interval": 3.0
```

Values below 1.0 are not recommended.

**Check for sensor polling issues**:

Some sensors may be slow to read. View logs for warnings about slow sensors.

## Memory Leaks

If agent memory usage grows over time:

**Restart the agent**:

```bash
./pankha-agent --stop
./pankha-agent --start
```

**Update to latest version**:

Check for new releases that may include memory leak fixes.

## Duplicate Sensors

If you see multiple sensors with identical readings:

**Enable duplicate filtering**:

Edit `config.json`:

```json
"filter_duplicate_sensors": true,
"duplicate_sensor_tolerance": 2.0
```

This removes sensors with readings within 2 degrees of each other.

## Agent Crashes After Backend Restart

Current version requires manual agent restart after backend restarts.

**Workaround**:

Restart the agent after restarting the backend:

```bash
./pankha-agent --stop
./pankha-agent --start
```

Future versions will include automatic reconnection.

## Logs Not Being Written

If log files aren't being created:

**Check log directory exists**:

```bash
sudo mkdir -p /var/log/pankha-agent
sudo chmod 755 /var/log/pankha-agent
```

**Check disk space**:

```bash
df -h /var/log
```

**Verify log configuration**:

In `config.json`:

```json
"enable_file_logging": true,
"log_file": "/var/log/pankha-agent/agent.log"
```

## Getting Debug Information

For detailed troubleshooting:

**Enable debug logging**:

Edit `config.json`:

```json
"log_level": "DEBUG"
```

**Run in foreground**:

For immediate output, run without detaching:

```bash
./pankha-agent --foreground
```

**Collect system information**:

```bash
uname -a
sensors
ls -la /sys/class/hwmon/
./pankha-agent --version
```

Include this information when reporting issues.

## Getting Help

If these solutions don't help:

1. Check [GitHub Issues](https://github.com/Anexgohan/pankha/issues)
2. Gather information:
   - Agent version
   - OS and kernel version
   - Output of `sensors`
   - Agent logs
   - Hardware information
3. Open a new issue with detailed information

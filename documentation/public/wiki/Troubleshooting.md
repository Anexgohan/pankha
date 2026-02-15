# Troubleshooting

## Agent Connectivity

### "Connection Refused"
*   **Cause**: The agent cannot reach the server IP/Port.
*   **Fix**: 
    1.  Ensure the server container is running (`docker compose ps`).
    2.  Check if the server firewall allows port `3143`.
    3.  Verify the `server_url` in `config.json` uses the correct IP (not `localhost` if on a different machine).

### "WebSocket Handshake Failed"
*   **Cause**: Protocol mismatch or proxy issue.
*   **Fix**: Ensure your URL starts with `ws://`. If you are running behind a reverse proxy (like Nginx Proxy Manager), ensure that WebSocket support is enabled.

### Agent Disconnects After Backend Restart
*   **Info**: Agents have automatic reconnection with exponential backoff. They will retry indefinitely until the backend is available again. If you need to force a reconnect:
    ```bash
    # Linux
    ./pankha-agent --restart
    
    # Windows (via Tray Icon)
    Right-click Tray -> Restart Service
    ```

## Server Issues

### Port Already in Use
*   **Error**: "Port 3143 is already allocated"
*   **Fix**:
    1.  Change port in `.env`:
        ```bash
        PANKHA_PORT=7000
        ```
    2.  Restart containers:
        ```bash
        docker compose down && docker compose up -d
        ```
    3.  **Important**: Update all agent `config.json` files to use the new port.

### Database Connection Failed
*   **Cause**: PostgreSQL container not running or misconfigured.
*   **Diagnosis**:
    ```bash
    docker compose ps              # Check containers running
    docker compose logs postgres   # View PostgreSQL logs
    ```
*   **Nuclear option** (⚠️ deletes all data):
    ```bash
    docker compose down -v
    docker compose up -d
    ```

### Dashboard Slow/Unresponsive
*   **Cause**: Database needs maintenance after months of sensor data.
*   **Fix**: Vacuum the database:
    ```bash
    docker compose exec postgres psql -U pankha -d db_pankha -c "VACUUM ANALYZE;"
    ```

## Hardware Issues

### No Sensors/Fans Detected (Linux)
*   **Cause**: Missing kernel modules.
*   **Fix**: Run `sensors-detect` (from `lm-sensors` package) and load the recommended kernel modules. Reboot and retry.

### No Sensors/Fans Detected (Windows)
*   **Cause**: Permission issue or unsupported hardware.
*   **Fix**: 
    1.  Run the "Pankha Fan Control" tray app as Administrator.
    2.  Check `logs/agent.log` for specific "Access Denied" errors.

### Fan Control Not Working (Linux)
*   **Cause**: Hardware doesn't support PWM or requires manual enable.
*   **Diagnosis**:
    1.  Check for PWM control files:
        ```bash
        ls -la /sys/class/hwmon/*/pwm*
        ```
        If no `pwm*` files exist, your fans may not support speed control.
    
    2.  Test manual control (**⚠️ this will change fan speed**):
        ```bash
        # Set to ~50% speed (128 out of 255)
        echo 128 | sudo tee /sys/class/hwmon/hwmon0/pwm1
        ```
        > Monitor temperatures after running. Replace paths with your actual hwmon device.
    
    3.  Some systems require enabling PWM mode first:
        ```bash
        cat /sys/class/hwmon/hwmon0/pwm1_enable
        # Values: 0=disabled, 1=manual, 2=auto(BIOS)
        # To enable manual mode:
        echo 1 | sudo tee /sys/class/hwmon/hwmon0/pwm1_enable
        ```
        > Rebooting restores BIOS defaults.

### Agent Shows "Disconnected" but Backend is Running
*   **Cause**: Network partition or firewall blocking WebSocket.
*   **Fix**: 
    1.  Check backend logs: `docker compose logs app --tail=100`
    2.  Verify agent can reach backend: `curl http://<server-ip>:3143/health`
    3.  Check agent config.json has correct `server_url`
    4.  Restart agent: `./pankha-agent --restart`

## Usage Questions

### Can I control GPU fans?
*   **Linux**: Generally no (unless exposed via standard `sysfs` PWM). NVIDIA drivers often lock manual control.
*   **Windows**: Yes, for most dedicated GPUs supported by LibreHardwareMonitor.

### Why do my fans spin up on boot?
*   **Reason**: Before the agent starts, the BIOS/UEFI controls the fans.
*   **Fix**: Configure a silent curve in your BIOS as a fallback, so the fans stay quiet until the OS/Agent loads and takes over.

## CLI Quick Reference

### Linux Agent
```bash
# Setup & Service
./pankha-agent -e                # Run interactive setup wizard
./pankha-agent -I                # Install systemd service
./pankha-agent -U                # Uninstall systemd service

# Daemon Control
./pankha-agent -s                # Start daemon
./pankha-agent -x                # Stop daemon
./pankha-agent -r                # Restart daemon

# Status & Logs
./pankha-agent -i                # Show status
./pankha-agent -l                # View logs (live)
./pankha-agent --log-level INFO  # Set log level

# Config & Debug
./pankha-agent -c                # Show config
./pankha-agent --check           # Run health check
./pankha-agent --test            # Test mode (hardware discovery)
```

### Windows Agent (run as Administrator)
```cmd
pankha-agent.exe --start         # Start service
pankha-agent.exe --stop          # Stop service
pankha-agent.exe --restart       # Restart service
pankha-agent.exe --status        # Show status
pankha-agent.exe --config-show   # Show config
pankha-agent.exe --logs follow   # View logs (live)
pankha-agent.exe --logs 50       # View last 50 log lines
```

# Troubleshooting

## Agent Connectivity

### "Connection Refused"
*   **Cause**: The agent cannot reach the server IP/Port.
*   **Fix**: 
    1.  Ensure the server container is running (`docker compose ps`).
    2.  Check if the server firewall allows port `3000`.
    3.  Verify the `server_url` in `config.json` uses the correct IP (not `localhost` if on a different machine).

### "WebSocket Handshake Failed"
*   **Cause**: Protocol mismatch or proxy issue.
*   **Fix**: Ensure your URL starts with `ws://`. If you are running behind a reverse proxy (like Nginx Proxy Manager), ensure that WebSocket support is enabled.

### Agent Disconnects After Backend Restart
*   **Cause**: Current version requires manual reconnection after backend restarts.
*   **Workaround**:
    ```bash
    # Linux
    ./pankha-agent -x && ./pankha-agent -s
    
    # Windows (run as Administrator)
    pankha-agent.exe --restart
    ```
*   **Note**: Future versions will include automatic reconnection handling.

## Server Issues

### Port Already in Use
*   **Error**: "Port 3000 is already allocated"
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
    docker compose exec postgres psql -U pankha_user -d db_pankha -c "VACUUM ANALYZE;"
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

### Duplicate Sensors Showing
*   **Cause**: Many motherboards report the same sensor via multiple chips.
*   **Fix**: Enable filtering in `config.json`:
    ```json
    "filter_duplicate_sensors": true,
    "duplicate_sensor_tolerance": 2.0
    ```

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
./pankha-agent -s        # Start daemon
./pankha-agent -x        # Stop daemon
./pankha-agent -r        # Restart daemon
./pankha-agent -i        # Show status
./pankha-agent -c        # Show config
./pankha-agent -l        # View logs (live)
./pankha-agent -l 50     # View last 50 log lines
./pankha-agent -e        # Setup wizard
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

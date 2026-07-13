# Troubleshooting

## Agent Connectivity

### "Connection Refused"
*   **Cause**: The agent cannot reach the server IP/Port.
*   **Fix**:
    1.  Ensure the server container is running (`docker compose ps`).
    2.  Check if the server firewall allows port `3143` (or your `PANKHA_PORT`).
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

### Agent Stays Stopped After Every Reboot
*   **Cause**: The systemd service was never installed - nothing starts the agent at boot.
*   **Fix**: `sudo ./pankha-agent --install-service` (see [Linux Agent](Agents-Linux)). Deployment Center installs it automatically; the setup wizard asks - answer yes.

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
    3.  **Important**: agents connect to this port too - update each agent's server URL (Linux: `sudo ./pankha-agent --setup`; Windows: tray **Configure...**).

### Database Connection Failed
*   **Cause**: PostgreSQL container not running or misconfigured.
*   **Diagnosis**:
    ```bash
    docker compose ps                     # Check containers running
    docker compose logs pankha-postgres   # View PostgreSQL logs
    ```
*   **Last resort** - reset the database (deletes all history, profiles, and settings): stop the stack (`docker compose down`), delete `docker-data/backend/database/postgres_data/`, then `docker compose up -d`. Note that `docker compose down -v` does **not** reset it - the data lives in that folder, not in a Docker volume ([Server Configuration](Server-Configuration)).

### Dashboard Slow/Unresponsive
*   **Cause**: Database needs maintenance after months of sensor data.
*   **Fix**: Vacuum the database (use your `POSTGRES_USER` and `POSTGRES_DB` from `.env`):
    ```bash
    docker compose exec pankha-postgres psql -U <user> -d db_pankha -c "VACUUM ANALYZE;"
    ```
    Also consider lowering **Data Retention** in [Settings](Settings-Page).

## Hardware Issues

### No Sensors/Fans Detected (Linux)
*   **Cause**: Missing kernel modules.
*   **Fix**: Run `sensors-detect` (from `lm-sensors` package) and load the recommended kernel modules. Reboot and retry.

### No Sensors/Fans Detected (Windows)
*   **Cause**: PawnIO driver missing, permission issue, or unsupported hardware.
*   **Fix**:
    1.  Verify the PawnIO driver is installed - see [Windows Agent](Agents-Windows) troubleshooting.
    2.  Check `logs\pankha-agent.log` in the install directory for specific "Access Denied" errors.
    3.  Note that some anti-cheat software blocks hardware access entirely.

### Fan Control Not Working (Linux)
*   **Cause**: Hardware doesn't support PWM or requires manual enable.
*   **Diagnosis**:
    1.  Check for PWM control files:
        ```bash
        ls -la /sys/class/hwmon/*/pwm*
        ```
        If no `pwm*` files exist, your fans may not support speed control.

    2.  Test manual control (**this will change fan speed**):
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
*   **Fix**:
    1.  Check backend logs: `docker compose logs pankha-app --tail=100`
    2.  Verify agent can reach backend: `curl http://<server-ip>:3143/health`
    3.  Check agent config.json has correct `server_url`
    4.  Restart agent: `./pankha-agent --restart`

## Calibration & Fan Health

### What do the fan badges mean?
| Badge | Meaning |
| :--- | :--- |
| **Calibrating** | A calibration run is in progress - manual control is locked until it completes |
| **Stalled** | The fan was commanded to spin but reports 0 RPM - stuck, disconnected, or needing recalibration |
| **Attention** / **Check fan** | The health engine flagged this fan - click the **info** icon on the fan row for the details |

### Calibration failed or seems stuck
*   **Failed**: calibration stops early on purpose if temperatures rise too far during the sweep - that's the safety working. Click the calibrate icon to retry when the system is idler.
*   **Stuck on "Calibrating"**: a run sweeps the fan through its full range including brief stops, so give it a few minutes. The calibrate icon's tooltip always states the current calibration state.
*   A fan that never calibrates may not report its speed at all (no tachometer) - such fans can still be controlled, just not measured. See [Fan Calibration & Health](Fan-Calibration).

### Virtual sensor shows no value
*   **Cause**: its member sensors aren't reporting - usually the agent is offline, or members were hidden/removed since the sensor was built.
*   **Fix**: check the system is online, then open the sensor's edit view (pencil icon) and re-check its members ([Dashboard](Dashboard)).

## IPMI Agents

### Error badge right after deployment
*   **Cause**: usually a BMC profile mismatch - commands meant for another vendor make the BMC answer `Invalid command` (`0xc1`), and sensor discovery fails.
*   **Fix**: no need to touch the server - assign the correct profile from the card's **BMC** section; the agent fetches and hot-reloads it, and the badge clears when telemetry resumes ([IPMI Agent](Agents-IPMI)).

### `Could not open device` / no `/dev/ipmi0`
*   **Fix**: load the kernel IPMI modules: `modprobe ipmi_devintf ipmi_si`. Also confirm `ipmitool` is installed - the install script does not install it.

## Usage Questions

### Can I control GPU fans?
*   **Linux**: **NVIDIA - yes**, via the NVIDIA driver; the GPU appears as an extra sensor and controllable fan automatically. Other GPUs work when they expose standard `sysfs` PWM (common with `amdgpu`).
*   **Windows**: **NVIDIA - yes**, via NvAPI. Other GPUs are monitor-only in most cases.

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

The [IPMI agent](Agents-IPMI) shares this CLI, plus `--profile <path>` and `--dry-run`.

### Windows Agent (run as Administrator)
```cmd
pankha-agent.exe --start         # Start service
pankha-agent.exe --stop          # Stop service
pankha-agent.exe --restart       # Restart service
pankha-agent.exe --status        # Show status
pankha-agent.exe --setup         # Interactive setup wizard
pankha-agent.exe --config-show   # Show config
pankha-agent.exe --logs follow   # View logs (live)
pankha-agent.exe --logs 50       # View last 50 log lines
pankha-agent.exe --test          # Hardware discovery test
```

---

## Next Steps

*   [Settings](Settings-Page): the **Diagnostics** tab exports hardware reports to attach to bug reports.
*   Still stuck? [Open an issue](https://github.com/Anexgohan/pankha/issues) - the Diagnostics tab's **Report + Diagnostics** button pre-fills one for you.

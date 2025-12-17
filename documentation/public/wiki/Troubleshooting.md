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

## Hardware Issues

### No Sensors/Fans Detected (Linux)
*   **Cause**: Missing kernel modules.
*   **Fix**: Run `sensors-detect` (from `lm-sensors` package) and load the recommended kernel modules. Reboot and retry.

### No Sensors/Fans Detected (Windows)
*   **Cause**: Permission issue or unsupported hardware.
*   **Fix**: 
    1.  Run the "Pankha Fan Control" tray app as Administrator.
    2.  Check `logs/agent.log` for specific "Access Denied" errors.

## Usage Questions

### Can I control GPU fans?
*   **Linux**: Generally no (unless exposed via standard `sysfs` PWM). NVIDIA drivers often lock manual control.
*   **Windows**: Yes, for most dedicated GPUs supported by LibreHardwareMonitor.

### Why do my fans spin up on boot?
*   **Reason**: Before the agent starts, the BIOS/UEFI controls the fans.
*   **Fix**: Configure a silent curve in your BIOS as a fallback, so the fans stay quiet until the OS/Agent loads and takes over.


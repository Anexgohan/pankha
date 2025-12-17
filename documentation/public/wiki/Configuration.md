# Configuration

## Server Configuration (.env)

The backend server is configured via environment variables, typically set in your `.env` file or Docker Compose.

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | HTTP/WebSocket Port | `3000` |
| `DATABASE_URL` | Connection string for PostgreSQL | `postgresql://user:pass@host:5432/db` |
| `NODE_ENV` | Environment mode | `production` |
| `LOG_LEVEL` | Server logging verbosity | `info` |

## Agent Configuration (config.json)

Both the Linux and Windows agents use a `config.json` file. 

*   **Linux Location**: Directory where binary is run (or `/etc/pankha-agent/config.json` depending on setup).
*   **Windows Location**: `C:\Program Files\Pankha Fan Control\config.json`.

### Example Config

```json
{
  "agent": {
    "name": "My-Storage-Server",
    "update_interval": 3.0,
    "log_level": "INFO"
  },
  "backend": {
    "server_url": "ws://YOUR_SERVER_IP:3000/websocket",
    "reconnect_interval": 5.0,
    "connection_timeout": 10.0
  },
  "hardware": {
    "enable_fan_control": true,
    "fan_safety_minimum": 20,
    "hysteresis_temp": 2.0,
    "emergency_temp": 85.0
  }
}
```

### Key Parameters

*   **`backend.server_url`**: The WebSocket URL of your central server. Must start with `ws://`.
*   **`hardware.fan_safety_minimum`**: The absolute minimum PWM % the agent will allow. Prevents fans from stalling if the server sends a 0% command.
*   **`hardware.emergency_temp`**: (Passive) The temperature threshold at which the UI will flag a critical alert.
*   **`hysteresis_temp`**: Small temperature fluctuations below this value will be ignored to prevent fans from revving up and down constantly.

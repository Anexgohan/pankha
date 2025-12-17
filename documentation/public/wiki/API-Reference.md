# API Reference

Pankha exposes a REST API for configuration and a WebSocket interface for real-time data. This is useful for integrating with external systems like Home Assistant, Node-RED, or custom scripts.

**Base URL**: `http://<server-ip>:3000`

---

## REST API

### System Management

#### List All Systems
Get a list of all registered agents and their current status.
*   **GET** `/api/systems`
*   **Response**: `[{id, name, status, ...}]`

#### Set Fan Speed (Manual Control)
Force a fan to a specific speed. Note: The autonomous controller may override this if "Manual Mode" is not explicitly enabled/supported by the specific agent logic version.
*   **PUT** `/api/systems/:id/fans/:fanId`
*   **Body**: `{ "speed": 75 }` (0-100)

### Configuration
Update agent behavior settings.

| Endpoint (PUT) | Body | Description |
| :--- | :--- | :--- |
| `/api/systems/:id/hysteresis` | `{ "temp": 5.0 }` | Set temperature hysteresis (0-10°C) |
| `/api/systems/:id/fan-step` | `{ "step": 5 }` | Set smoothing step percentage (1-100%) |
| `/api/systems/:id/agent-rate` | `{ "interval": 1000 }` | Set update interval in milliseconds |

---

## WebSocket API

The WebSocket is used for high-frequency real-time data.
**Endpoint**: `ws://<server-ip>:3000/websocket`

### Events (Server -> Client)

#### `fullState`
Sent immediately upon connection. Contains the complete snapshot of all systems.

#### `systemDelta`
Sent purely when values change (bandwidth optimized).
```json
{
  "type": "systemDelta",
  "data": {
    "agentId": "linux-agent-1",
    "timestamp": "2023-10-27T10:00:00Z",
    "changes": ["sensors", "fans"],
    "sensors": [{ "id": "temp1", "temperature": 45.2 }],
    "fans": [{ "id": "fan1", "rpm": 1200, "speed": 40 }]
  }
}
```

#### `agentRegistered` / `agentOffline`
Lifecycle events sent when agents connect or disconnect.

---

## Integration Examples

### Curl: Set Fan Speed
```bash
curl -X PUT http://localhost:3000/api/systems/1/fans/fan_input_1 \
     -H "Content-Type: application/json" \
     -d '{"speed": 100}'
```

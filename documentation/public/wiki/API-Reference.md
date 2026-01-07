# API Reference

Pankha exposes a REST API for configuration and a WebSocket interface for real-time data. Base URL: `http://<server-ip>:3000`

---

## Health & Status

| Method | Endpoint              | Description                                  |
| ------ | --------------------- | -------------------------------------------- |
| GET    | `/health`             | Backend health check with service statistics |
| GET    | `/api/overview`       | Aggregate stats across all systems           |
| GET    | `/api/websocket/info` | WebSocket connection info and stats          |
| POST   | `/api/emergency-stop` | Set all fans to 100% on all systems          |

---

## Systems

### List & CRUD
| Method | Endpoint                  | Description                          |
| ------ | ------------------------- | ------------------------------------ |
| GET    | `/api/systems`            | List all registered agents           |
| POST   | `/api/systems`            | Add new system                       |
| GET    | `/api/systems/:id`        | Get system details with sensors/fans |
| PUT    | `/api/systems/:id`        | Update system configuration          |
| DELETE | `/api/systems/:id`        | Remove system                        |
| GET    | `/api/systems/:id/status` | Real-time connection status          |

### Controller
| Method | Endpoint                           | Description                    |
| ------ | ---------------------------------- | ------------------------------ |
| GET    | `/api/systems/controller/status`   | Fan profile controller status  |
| PUT    | `/api/systems/controller/interval` | Set controller update interval |

### Sensors
| Method | Endpoint                                               | Description                |
| ------ | ------------------------------------------------------ | -------------------------- |
| GET    | `/api/systems/:id/sensors`                             | Get all sensors for system |
| PUT    | `/api/systems/:id/sensors/:sensorId/label`             | Set custom sensor label    |
| PUT    | `/api/systems/:id/sensors/:sensorId/visibility`        | Show/hide sensor           |
| GET    | `/api/systems/:id/sensor-visibility`                   | Get visibility settings    |
| PUT    | `/api/systems/:id/sensor-groups/:groupName/visibility` | Show/hide sensor group     |

### Fans
| Method | Endpoint                             | Description                |
| ------ | ------------------------------------ | -------------------------- |
| GET    | `/api/systems/:id/fans`              | Get all fans for system    |
| PUT    | `/api/systems/:id/fans/:fanId`       | **Set fan speed** (0-100%) |
| PUT    | `/api/systems/:id/fans/:fanId/label` | Set custom fan label       |

### Agent Settings
| Method | Endpoint                              | Description                          |
| ------ | ------------------------------------- | ------------------------------------ |
| PUT    | `/api/systems/:id/update-interval`    | Set agent polling interval (seconds) |
| PUT    | `/api/systems/:id/fan-step`           | Set fan speed step % (smoothing)     |
| PUT    | `/api/systems/:id/hysteresis`         | Set temperature hysteresis (°C)      |
| PUT    | `/api/systems/:id/emergency-temp`     | Set emergency temperature threshold  |
| PUT    | `/api/systems/:id/failsafe-speed`     | Set failsafe fan speed (0-100%)      |
| PUT    | `/api/systems/:id/enable-fan-control` | Enable/disable fan control           |
| PUT    | `/api/systems/:id/log-level`          | Set agent log level                  |
| PUT    | `/api/systems/:id/name`               | Set agent display name               |

### Profiles & History
| Method | Endpoint                    | Description                    |
| ------ | --------------------------- | ------------------------------ |
| PUT    | `/api/systems/:id/profile`  | Assign profile to system       |
| POST   | `/api/systems/:id/profiles` | Create system-specific profile |
| GET    | `/api/systems/:id/history`  | Get historical sensor/fan data |
| GET    | `/api/systems/:id/charts`   | Get aggregated chart data      |

---

## Fan Profiles

| Method | Endpoint                                  | Description               |
| ------ | ----------------------------------------- | ------------------------- |
| GET    | `/api/fan-profiles`                       | List all profiles         |
| GET    | `/api/fan-profiles/:id`                   | Get profile details       |
| POST   | `/api/fan-profiles`                       | Create new profile        |
| PUT    | `/api/fan-profiles/:id`                   | Update profile            |
| DELETE | `/api/fan-profiles/:id`                   | Delete profile            |
| GET    | `/api/fan-profiles/stats`                 | Profile statistics        |
| POST   | `/api/fan-profiles/assign`                | Assign profile to fan     |
| GET    | `/api/fan-profiles/assignments/:systemId` | Get fan assignments       |
| POST   | `/api/fan-profiles/calculate-speed`       | Calculate speed for temp  |
| GET    | `/api/fan-profiles/export`                | Export profiles to JSON   |
| POST   | `/api/fan-profiles/import`                | Import profiles from JSON |

---

## Fan Configurations

| Method | Endpoint                            | Description                  |
| ------ | ----------------------------------- | ---------------------------- |
| GET    | `/api/fan-configurations/:systemId` | Get fan configurations       |
| POST   | `/api/fan-configurations/sensor`    | Configure fan sensor mapping |

---

## Discovery

| Method | Endpoint                                       | Description              |
| ------ | ---------------------------------------------- | ------------------------ |
| POST   | `/api/discovery/scan`                          | Scan network for agents  |
| GET    | `/api/discovery/hardware`                      | Get discovered hardware  |
| POST   | `/api/discovery/test-fan`                      | Test fan control         |
| GET    | `/api/discovery/systems/:id/sensors/scan`      | Scan for new sensors     |
| PUT    | `/api/discovery/systems/:id/sensors/:sensorId` | Update discovered sensor |
| POST   | `/api/discovery/systems/:id/sensor-mapping`    | Map sensors to labels    |

---

## License

| Method | Endpoint               | Description                                         |
| ------ | ---------------------- | --------------------------------------------------- |
| GET    | `/api/license`         | Get current license info (tier, limits, expiration) |
| POST   | `/api/license`         | Activate license key                                |
| DELETE | `/api/license`         | Remove license (revert to free tier)                |
| GET    | `/api/license/pricing` | Get tier pricing info                               |

---

## WebSocket API

**Endpoint**: `ws://<server-ip>:3000/websocket`

### Events (Server → Client)

| Event                | Description                               |
| -------------------- | ----------------------------------------- |
| `fullState`          | Complete snapshot on connection           |
| `systemDelta`        | Incremental updates (bandwidth optimized) |
| `agentRegistered`    | Agent connected                           |
| `agentOffline`       | Agent disconnected                        |
| `agentError`         | Agent error occurred                      |
| `agentConfigUpdated` | Config change (immediate broadcast)       |

### Example: systemDelta
```json
{
  "type": "systemDelta",
  "data": {
    "agentId": "linux-agent-1",
    "timestamp": "2025-01-01T12:00:00Z",
    "changes": ["sensors", "fans"],
    "sensors": [{ "id": "temp1", "temperature": 45.2 }],
    "fans": [{ "id": "fan1", "rpm": 1200, "speed": 40 }]
  }
}
```

---

## Quick Examples

### Set Fan Speed
```bash
curl -X PUT http://localhost:3000/api/systems/1/fans/fan1 \
  -H "Content-Type: application/json" \
  -d '{"speed": 75}'
```

### Create Fan Profile
```bash
curl -X POST http://localhost:3000/api/fan-profiles \
  -H "Content-Type: application/json" \
  -d '{
    "profile_name": "Silent",
    "curve_points": [
      {"temperature": 30, "fan_speed": 30},
      {"temperature": 50, "fan_speed": 50},
      {"temperature": 70, "fan_speed": 100}
    ]
  }'
```

### Check Health
```bash
curl http://localhost:3000/health
```

---

## Error Responses

```json
{
  "success": false,
  "error": "Error message",
  "message": "Detailed description"
}
```

| Code | Meaning                                    |
| ---- | ------------------------------------------ |
| 200  | Success                                    |
| 201  | Created                                    |
| 400  | Bad request                                |
| 403  | Forbidden (license limit / read-only mode) |
| 404  | Not found                                  |
| 500  | Server error                               |
| 503  | Service unavailable                        |

---

## Notes

- **Authentication**: Not required in current version
- **Rate Limiting**: None enforced; use WebSocket for real-time updates
- **URL Parameters**: Replace `:id`, `:fanId`, etc. with actual values

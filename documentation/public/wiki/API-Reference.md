# API Reference

Pankha exposes a REST API for configuration and a WebSocket interface for real-time data. Base URL: `http://<server-ip>:3143`

Two kinds of identifiers appear in these routes:

*   **Database IDs** (numeric): `:id` for systems, and `:sensorId` / `:fanId` in label, visibility, and ordering routes.
*   **Hardware IDs** (string, e.g. `it8628_fan_1`): `:fanId` in the fan speed and calibration routes. IPMI agents use the zone ID here (e.g. `cpu_zone`).

---

## Health & Status

| Method | Endpoint              | Description                                  |
| ------ | --------------------- | -------------------------------------------- |
| GET    | `/health`             | Backend health check with service statistics |
| GET    | `/api/overview`       | Aggregate stats across all systems           |
| GET    | `/api/websocket/info` | WebSocket connection info and stats          |
| POST   | `/api/emergency-stop` | Force all fans to 100% on all systems        |

---

## Systems

### List & CRUD
| Method | Endpoint                       | Description                                      |
| ------ | ------------------------------ | ------------------------------------------------ |
| GET    | `/api/systems`                 | List all registered agents                       |
| POST   | `/api/systems`                 | Add new system                                   |
| GET    | `/api/systems/limit`           | Get agent limit info (current count, tier limit) |
| GET    | `/api/systems/:id`             | Get system details with sensors/fans             |
| PUT    | `/api/systems/:id`             | Update system configuration                      |
| DELETE | `/api/systems/:id`             | Remove system                                    |
| GET    | `/api/systems/:id/status`      | Real-time connection status                      |
| GET    | `/api/systems/:id/diagnostics` | Get hardware diagnostics from agent              |

### Controller
| Method | Endpoint                           | Description                    |
| ------ | ---------------------------------- | ------------------------------ |
| GET    | `/api/systems/controller/status`   | Fan profile controller status  |
| PUT    | `/api/systems/controller/interval` | Set controller update interval |

### Sensors
| Method | Endpoint                                               | Description                          |
| ------ | ------------------------------------------------------ | ------------------------------------ |
| GET    | `/api/systems/:id/sensors`                             | Get all sensors for system           |
| PUT    | `/api/systems/:id/sensors/:sensorId/label`             | Set custom sensor label              |
| PUT    | `/api/systems/:id/sensors/:sensorId/visibility`        | Show/hide sensor (`{ is_hidden }`)   |
| GET    | `/api/systems/:id/sensor-visibility`                   | Get visibility settings              |
| PUT    | `/api/systems/:id/sensor-groups/:groupName/visibility` | Show/hide sensor group               |
| GET    | `/api/systems/:id/sensor-order`                        | Get custom sensor display order      |
| PUT    | `/api/systems/:id/sensors/order`                       | Reorder sensors within a group       |
| PUT    | `/api/systems/:id/sensor-groups/order`                 | Reorder sensor groups                |

### Fans
| Method | Endpoint                                  | Description                                |
| ------ | ----------------------------------------- | ------------------------------------------ |
| GET    | `/api/systems/:id/fans`                   | Get all fans for system                    |
| PUT    | `/api/systems/:id/fans/:fanId`            | **Set fan speed** (`{ speed: 0-100 }`)     |
| PUT    | `/api/systems/:id/fans/:fanId/label`      | Set custom fan label                       |
| PUT    | `/api/systems/:id/fans/:fanId/visibility` | Show/hide fan (`{ is_hidden }`)            |

Manual speed commands return `409` while the fan is locked by a running calibration.

### Fan Calibration
| Method | Endpoint                                            | Description                                        |
| ------ | --------------------------------------------------- | -------------------------------------------------- |
| GET    | `/api/systems/:id/calibrations`                     | Calibration snapshot for all fans on a system      |
| GET    | `/api/systems/:id/fans/:fanId/calibration`          | Current calibration facts for one fan              |
| GET    | `/api/systems/:id/fans/:fanId/calibration/history`  | Past calibration runs (trend data)                 |
| POST   | `/api/systems/:id/fans/:fanId/calibrate`            | Start a manual calibration run (`409` if offline)  |
| POST   | `/api/systems/:id/fans/:fanId/stalls/clear`         | Clear the fan's unexpected-stop log                |

See [Calibration & Health](Fan-Calibration) for what these measurements mean.

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
| POST   | `/api/systems/:id/update`             | Trigger remote agent self-update     |

### Backend Settings
| Method | Endpoint                     | Description                             |
| ------ | ---------------------------- | --------------------------------------- |
| GET    | `/api/systems/settings`      | Get all backend settings                |
| GET    | `/api/systems/settings/:key` | Get a specific setting by key           |
| PUT    | `/api/systems/settings/:key` | Update a setting (`{ "value": "..." }`) |

Allowed setting keys: `controller_update_interval`, `graph_history_hours`, `data_retention_days`, `accent_color`, `hover_tint_color`, `hardware_prune_days`, `fan_recalibration_days`, `ui_font_primary`, `ui_font_secondary`, `ui_font_scale`, `hub_log_level`

### Profiles & History
| Method | Endpoint                    | Description                                                     |
| ------ | --------------------------- | --------------------------------------------------------------- |
| PUT    | `/api/systems/:id/profile`  | Assign profile to system                                        |
| POST   | `/api/systems/:id/profiles` | Create system-specific profile                                  |
| GET    | `/api/systems/:id/history`  | Historical data (`start_time`, `end_time`, `sensor_ids`, `fan_ids`, `limit`) |
| GET    | `/api/systems/:id/charts`   | Get aggregated chart data                                       |

---

## Fan Profiles

| Method | Endpoint                                  | Description                         |
| ------ | ----------------------------------------- | ----------------------------------- |
| GET    | `/api/fan-profiles`                       | List all profiles                   |
| GET    | `/api/fan-profiles/:id`                   | Get profile details                 |
| POST   | `/api/fan-profiles`                       | Create new profile                  |
| PUT    | `/api/fan-profiles/:id`                   | Update profile                      |
| DELETE | `/api/fan-profiles/:id`                   | Delete profile                      |
| GET    | `/api/fan-profiles/stats`                 | Profile statistics                  |
| POST   | `/api/fan-profiles/assign`                | Assign profile to fan               |
| GET    | `/api/fan-profiles/assignments/:systemId` | Get fan assignments                 |
| POST   | `/api/fan-profiles/calculate-speed`       | Calculate speed for temp            |
| GET    | `/api/fan-profiles/export`                | Export profiles to JSON             |
| POST   | `/api/fan-profiles/import`                | Import profiles from JSON           |
| GET    | `/api/fan-profiles/defaults`              | List available default profiles     |
| POST   | `/api/fan-profiles/load-defaults`         | Load default profiles into database |

---

## Fan Profile Types

User-defined categories for organizing profiles (built-in types like `silent` and `performance` are system types and cannot be changed).

| Method | Endpoint                       | Description                                         |
| ------ | ------------------------------ | --------------------------------------------------- |
| GET    | `/api/fan-profile-types`       | List all types with `is_system` flag and use count  |
| POST   | `/api/fan-profile-types`       | Create a type (`{ name }`, `409` on name collision) |
| PATCH  | `/api/fan-profile-types/:name` | Rename a user-defined type                          |
| DELETE | `/api/fan-profile-types/:name` | Delete an unused user-defined type                  |

---

## Fan Configurations

| Method | Endpoint                            | Description                  |
| ------ | ----------------------------------- | ---------------------------- |
| GET    | `/api/fan-configurations/:systemId` | Get fan configurations       |
| POST   | `/api/fan-configurations/sensor`    | Configure fan sensor mapping |

---

## Virtual Sensors

Combine real sensors into a computed one (see [Dashboard](Dashboard) for the feature itself). A virtual sensor is referenced by other APIs as `__virtual__<id>`.

| Method | Endpoint                        | Description                                                          |
| ------ | ------------------------------- | -------------------------------------------------------------------- |
| GET    | `/api/virtual-sensors/:systemId`| List virtual sensors for a system                                     |
| GET    | `/api/virtual-sensors/:id/usage`| Where this virtual sensor is used (fan assignments)                   |
| POST   | `/api/virtual-sensors`          | Create (`{ system_id, name, operation: max\|avg\|median, sensor_ids }`, minimum 2 sensors) |
| PUT    | `/api/virtual-sensors/order`    | Reorder virtual sensors                                               |
| PUT    | `/api/virtual-sensors/:id`      | Update name, operation, or members                                    |
| DELETE | `/api/virtual-sensors/:id`      | Delete a virtual sensor                                               |

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

## Deploy

| Method | Endpoint                                | Description                                            |
| ------ | --------------------------------------- | ------------------------------------------------------ |
| POST   | `/api/deploy/templates`                 | Generate a deployment token (expires in 24h)           |
| GET    | `/api/deploy/linux`                     | Serve dynamic Linux install script (`?token=<token>`)  |
| GET    | `/api/deploy/ipmi`                      | Serve dynamic IPMI install script (`?token=<token>`)   |
| GET    | `/api/deploy/hub/status`                | Status of locally cached agent binaries                |
| POST   | `/api/deploy/hub/stage`                 | Download a specific agent version to the hub           |
| DELETE | `/api/deploy/hub/clear`                 | Clear all locally cached agent binaries                |
| GET    | `/api/deploy/binaries/:agentType/:arch` | Serve cached binary (`os_linux`/`ipmi_host`, `x86_64`/`aarch64`) |
| GET    | `/api/deploy/binaries/:arch`            | Serve cached OS agent binary (legacy form)             |

### BMC Profiles (IPMI)

Vendor profiles that teach the IPMI agent how to talk to a server's BMC.

| Method | Endpoint                                   | Description                                        |
| ------ | ------------------------------------------ | -------------------------------------------------- |
| GET    | `/api/deploy/profiles`                     | Vendor/model catalog for profile selection         |
| GET    | `/api/deploy/profiles/refresh`             | Re-scan profile files on disk                      |
| GET    | `/api/deploy/profiles/assigned/:agentId`   | Resolved profile assigned to an agent              |
| PUT    | `/api/deploy/profiles/assign/:agentId`     | Assign a profile to an agent                       |
| POST   | `/api/deploy/profiles/custom`              | Save a custom profile from the Profile Builder     |
| GET    | `/api/deploy/profiles/:vendor/:model`      | Get one profile definition                         |

### Profile Builder

| Method | Endpoint                            | Description                                             |
| ------ | ----------------------------------- | ------------------------------------------------------- |
| POST   | `/api/systems/:id/execute-raw-ipmi` | Run a raw IPMI command on an agent (profile testing)    |

---

## Config

| Method | Endpoint                 | Description                             |
| ------ | ------------------------ | --------------------------------------- |
| GET    | `/api/config/deployment` | Get deployment config (hub IP and port) |

---

## License

| Method | Endpoint               | Description                                         |
| ------ | ---------------------- | --------------------------------------------------- |
| GET    | `/api/license`         | Get current license info (tier, limits, expiration) |
| POST   | `/api/license`         | Activate license key                                |
| DELETE | `/api/license`         | Remove license (revert to free tier)                |
| GET    | `/api/license/pricing` | Get tier pricing info                               |
| POST   | `/api/license/sync`    | Force sync with license server (check for renewals) |

---

## WebSocket API

**Endpoint**: `ws://<server-ip>:3143/websocket`

### Messages (Client → Server)

| Message           | Description                                    |
| ----------------- | ---------------------------------------------- |
| `subscribe`       | Subscribe to topics (e.g. `systems:all`)       |
| `unsubscribe`     | Unsubscribe from topics                        |
| `requestFullSync` | Request a complete state snapshot              |
| `getSystemData`   | Request one system's current data              |
| `getOverview`     | Request aggregate stats                        |
| `ping`            | Keep-alive check                               |

### Events (Server → Client)

| Event                 | Description                                            |
| --------------------- | ------------------------------------------------------ |
| `fullState`           | Complete snapshot (on connect / full sync)             |
| `systemDelta`         | Incremental updates (only changed values)              |
| `systemOffline`       | Agent disconnected                                     |
| `agentRegistered`     | Agent connected                                        |
| `agentUnregistered`   | Agent stopped gracefully                               |
| `agentError`          | Agent reported a hardware error                        |
| `agentRecovered`      | Agent recovered from an error state                    |
| `agentConfigUpdated`  | Config change (immediate broadcast)                    |
| `fanCalibrationStatus`| Calibration run lifecycle (running/done/failed)        |
| `fanStalled`          | Stall watchdog: fan read 0 RPM while commanded to spin |
| `fanStallCleared`     | Stall condition cleared                                |
| `commandCompleted`    | A dispatched agent command finished                    |
| `commandFailed`       | A dispatched agent command failed                      |
| `licenseUpdated`      | License changed on the backend (refetch `/api/license`)|

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
curl -X PUT http://localhost:3143/api/systems/1/fans/it8628_fan_1 \
  -H "Content-Type: application/json" \
  -d '{"speed": 75}'
```

### Create a Virtual Sensor
```bash
curl -X POST http://localhost:3143/api/virtual-sensors \
  -H "Content-Type: application/json" \
  -d '{
    "system_id": 1,
    "name": "CPU + NVMe Max",
    "operation": "max",
    "sensor_ids": [12, 15, 18]
  }'
```

### Start a Manual Calibration
```bash
curl -X POST http://localhost:3143/api/systems/1/fans/it8628_fan_1/calibrate
```

### Check Health
```bash
curl http://localhost:3143/health
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

| Code | Meaning                                                        |
| ---- | -------------------------------------------------------------- |
| 200  | Success                                                        |
| 201  | Created                                                        |
| 400  | Bad request                                                    |
| 403  | Forbidden (license limit / read-only mode)                     |
| 404  | Not found                                                      |
| 409  | Conflict (system offline, calibration lock, name collision)    |
| 500  | Server error                                                   |
| 503  | Service unavailable                                            |

---

## Notes

- **URL Parameters**: Replace `:id`, `:fanId`, etc. with actual values (see the identifier note at the top of this page).

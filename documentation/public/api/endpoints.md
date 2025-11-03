# API Documentation

The Pankha backend provides a REST API for monitoring systems and controlling fans. All endpoints return JSON responses.

**Note**:  

    We use the colon `:` prefix (like `:id`) because that's the standard convention used by the backend framework (Express.js). You might also see other documentation use `{id}` or `[id]` - they all mean the same thing: "replace this with your actual value".

## Base URL

```
http://your-backend-ip:3000
```

## Understanding URL Parameters

In this documentation, you'll see endpoints with placeholders like `:id`, `:sensorId`, or `:fanId`. These are **not** literal values - you need to replace them with actual IDs from your system.

**Example:**

Documentation shows: `GET /api/systems/:id/sensors`

Actual request: `GET /api/systems/1/sensors`

Or think of it as: `GET /api/systems/[your-system-id]/sensors`

### How to Find IDs

**System ID**: Get from the list of systems
```bash
curl http://192.168.100.237:3000/api/systems
```
Returns: `[{"id": 1, "name": "server1", ...}, {"id": 2, "name": "proxmox", ...}]`

Use the `id` field (e.g., `1`, `2`) in your requests.

**Sensor ID**: Get from the system's sensors endpoint
```bash
curl http://192.168.100.237:3000/api/systems/1/sensors
```
Returns: `[{"id": 1, "sensor_name": "temp1", ...}, {"id": 2, "sensor_name": "temp2", ...}]`

Use the `id` field from the sensor object.

**Fan ID**: Get from the system's fans endpoint
```bash
curl http://192.168.100.237:3000/api/systems/1/fans
```
Returns: `[{"id": "fan1", "fan_name": "fan1", ...}, {"id": "fan2", "fan_name": "fan2", ...}]`

Use the `id` field (usually a string like "fan1", "fan2").

**Profile ID**: Get from the fan profiles list
```bash
curl http://192.168.100.237:3000/api/fan-profiles
```
Returns: `{"success": true, "data": [{"id": 1, "profile_name": "Silent", ...}]}`

Use the `id` field from the profile object.

### Quick Example Workflow

```bash
# 1. List all systems to find your system ID
curl http://192.168.100.237:3000/api/systems
# Response shows: {"id": 1, "name": "myserver", ...}

# 2. Get sensors for system ID 1
curl http://192.168.100.237:3000/api/systems/1/sensors
# Response shows: {"id": 5, "sensor_name": "temp1", "sensor_label": "CPU", ...}

# 3. Update label for sensor ID 5
curl -X PUT http://192.168.100.237:3000/api/systems/1/sensors/5/label \
  -H "Content-Type: application/json" \
  -d '{"label": "CPU Core 0"}'
```

## Health Check

Check if the backend is running and view service statistics.

**Endpoint**: `GET /health`

**Response**:
```json
{
  "status": "ok",
  "timestamp": "2025-01-03T10:30:00.000Z",
  "service": "pankha-backend",
  "version": "1.0.0",
  "services": {
    "database": "connected",
    "agent_manager": "active",
    "websocket_hub": "active"
  },
  "statistics": {
    "total_agents": 3,
    "agent_statuses": {
      "online": 2,
      "offline": 1
    },
    "websocket_clients": 2,
    "pending_commands": 0
  }
}
```

## System Management

### List All Systems

Get information about all registered agents.

**Endpoint**: `GET /api/systems`

**Response**:
```json
[
  {
    "id": 1,
    "name": "server1",
    "agent_id": "Linux-server1-abc123",
    "status": "online",
    "real_time_status": "connected",
    "last_data_received": "2025-01-03T10:30:00Z",
    "sensor_count": 8,
    "fan_count": 3,
    "current_temperatures": [...],
    "current_fan_speeds": [...]
  }
]
```

### Get System Details

Get detailed information about a specific system including sensors, fans, and profiles.

**Endpoint**: `GET /api/systems/:id`

**Parameters**:
- `id`: System ID (integer)

**Response**:
```json
{
  "id": 1,
  "name": "server1",
  "agent_id": "Linux-server1-abc123",
  "status": "online",
  "sensors": [
    {
      "id": 1,
      "sensor_name": "temp1",
      "sensor_label": "CPU Temperature",
      "current_temp": 45.0
    }
  ],
  "fans": [
    {
      "id": "fan1",
      "fan_name": "fan1",
      "fan_label": "CPU Fan",
      "current_speed_rpm": 1500,
      "current_speed_percent": 60
    }
  ],
  "profiles": [...]
}
```

### Get System Status

Get real-time status and data for a system.

**Endpoint**: `GET /api/systems/:id/status`

**Response**:
```json
{
  "agent_id": "Linux-server1-abc123",
  "status": "connected",
  "last_seen": "2025-01-03T10:30:00Z",
  "last_data_received": "2025-01-03T10:30:00Z",
  "connection_info": {...},
  "real_time_data": {
    "sensors": [...],
    "fans": [...]
  }
}
```

### Get System Sensors

Get current temperature readings for all sensors on a system.

**Endpoint**: `GET /api/systems/:id/sensors`

**Response**:
```json
[
  {
    "id": 1,
    "sensor_name": "temp1",
    "sensor_label": "CPU Temperature",
    "current_temp": 45.0,
    "temp_max": 100.0,
    "temp_crit": 105.0,
    "status": "ok"
  }
]
```

### Get System Fans

Get current fan speeds and status for **all fans** on a system.

**Endpoint**: `GET /api/systems/:id/fans`

**Example**: `GET /api/systems/1/fans`

**Response**: Returns an array of all fans
```json
[
  {
    "id": 1,
    "fan_name": "it8628_fan_1",
    "fan_label": "CPU Fan",
    "current_speed": 60,
    "current_rpm": 1500,
    "max_speed": 100,
    "is_controllable": true,
    "primary_sensor_label": "CPU Temperature",
    "primary_sensor_temp": 45.0
  },
  {
    "id": 2,
    "fan_name": "it8628_fan_2",
    "fan_label": "Top Fan",
    "current_speed": 50,
    "current_rpm": 1018,
    ...
  }
]
```

**Note**: There is no endpoint to get a single fan's details (like `GET /api/systems/1/fans/1`). To get data for a specific fan, retrieve all fans and find the one you need by its `id` field.

### Update Sensor Label

Set a custom display name for a sensor.

**Endpoint**: `PUT /api/systems/:id/sensors/:sensorId/label`

**Body**:
```json
{
  "label": "CPU Core 0"
}
```

### Update Fan Label

Set a custom display name for a fan.

**Endpoint**: `PUT /api/systems/:id/fans/:fanId/label`

**Body**:
```json
{
  "label": "Front Intake Fan"
}
```

## Fan Control

### Set Fan Speed

Control a specific fan's speed.

**Endpoint**: `PUT /api/systems/:id/fans/:fanId`

**Parameters**:
- `id`: System ID
- `fanId`: Fan identifier (string, e.g., "fan1")

**Body**:
```json
{
  "speed": 75,
  "priority": "normal"
}
```

Priority can be: `normal`, `high`, or `urgent`

**Response**:
```json
{
  "message": "Fan speed command sent",
  "agent_id": "Linux-server1-abc123",
  "fan_id": "fan1",
  "requested_speed": 75,
  "priority": "normal",
  "result": {...}
}
```

### Set Agent Update Interval

Change how often the agent sends data.

**Endpoint**: `PUT /api/systems/:id/update-interval`

**Body**:
```json
{
  "interval": 3.0,
  "priority": "normal"
}
```

Interval is in seconds (0.5 to 30).

### Emergency Stop

Set all fans on all systems to maximum speed.

**Endpoint**: `POST /api/emergency-stop`

**Response**:
```json
{
  "message": "Emergency stop triggered for all systems",
  "timestamp": "2025-01-03T10:30:00.000Z"
}
```

## Overview Statistics

Get aggregate statistics across all systems.

**Endpoint**: `GET /api/overview`

**Response**:
```json
{
  "total_systems": 3,
  "systems_by_status": {
    "online": 2,
    "offline": 1
  },
  "total_sensors": 15,
  "total_fans": 8,
  "avg_temperature": 42.5,
  "max_temperature": 65.0,
  "websocket_stats": {...},
  "command_queue_status": {...},
  "timestamp": "2025-01-03T10:30:00.000Z"
}
```

## Fan Profiles

### List Profiles

Get all fan profiles, optionally filtered by system.

**Endpoint**: `GET /api/fan-profiles?system_id=1&include_global=true`

**Query Parameters**:
- `system_id` (optional): Filter by system ID
- `include_global` (optional): Include global profiles (default: true)

**Response**:
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "profile_name": "Silent",
      "description": "Low noise profile",
      "curve_points": [
        {"temperature": 30, "fan_speed": 30},
        {"temperature": 50, "fan_speed": 50},
        {"temperature": 70, "fan_speed": 100}
      ],
      "system_id": null
    }
  ],
  "count": 1
}
```

### Get Profile

Get details of a specific profile.

**Endpoint**: `GET /api/fan-profiles/:id`

### Create Profile

Create a new fan profile.

**Endpoint**: `POST /api/fan-profiles`

**Body**:
```json
{
  "profile_name": "Custom Profile",
  "description": "My custom fan curve",
  "curve_points": [
    {"temperature": 30, "fan_speed": 30},
    {"temperature": 60, "fan_speed": 70},
    {"temperature": 80, "fan_speed": 100}
  ],
  "system_id": 1
}
```

Set `system_id` to null to create a global profile.

**Response**:
```json
{
  "success": true,
  "data": {...},
  "message": "Fan profile created successfully"
}
```

### Update Profile

Modify an existing profile.

**Endpoint**: `PUT /api/fan-profiles/:id`

**Body**: Same structure as create

### Delete Profile

Remove a fan profile.

**Endpoint**: `DELETE /api/fan-profiles/:id`

**Response**:
```json
{
  "success": true,
  "message": "Fan profile deleted successfully"
}
```

### Assign Profile to Fan

Link a profile to a specific fan.

**Endpoint**: `POST /api/fan-profiles/assign`

**Body**:
```json
{
  "fan_id": "fan1",
  "profile_id": 1,
  "sensor_id": 1
}
```

**Response**:
```json
{
  "success": true,
  "data": {...},
  "message": "Profile assigned to fan successfully"
}
```

### Get Fan Assignments

Get active profile assignments for a system.

**Endpoint**: `GET /api/fan-profiles/assignments/:systemId`

**Response**:
```json
{
  "success": true,
  "data": [
    {
      "fan_id": "fan1",
      "profile_id": 1,
      "profile_name": "Silent",
      "sensor_id": 1,
      "sensor_label": "CPU Temperature"
    }
  ],
  "count": 1
}
```

### Export Profiles

Export fan profiles to JSON format.

**Endpoint**: `GET /api/fan-profiles/export?profile_ids=1,2&include_system_profiles=true`

**Query Parameters**:
- `profile_ids` (optional): Comma-separated list of profile IDs to export
- `include_system_profiles` (optional): Include system-specific profiles

Returns a JSON file download.

### Import Profiles

Import fan profiles from JSON format.

**Endpoint**: `POST /api/fan-profiles/import`

**Body**:
```json
{
  "profiles": [...],
  "resolve_conflicts": "rename"
}
```

`resolve_conflicts` can be: `skip`, `rename`, or `overwrite`

## Historical Data

### Get History

Get historical sensor and fan data for a system.

**Endpoint**: `GET /api/systems/:id/history?start_time=2025-01-01T00:00:00Z&end_time=2025-01-02T00:00:00Z&limit=1000`

**Query Parameters**:
- `start_time` (optional): ISO 8601 timestamp
- `end_time` (optional): ISO 8601 timestamp
- `sensor_ids` (optional): Comma-separated sensor IDs
- `fan_ids` (optional): Comma-separated fan IDs
- `limit` (optional): Maximum number of data points (default: 1000)

### Get Chart Data

Get aggregated data suitable for displaying charts.

**Endpoint**: `GET /api/systems/:id/charts?hours=24`

**Query Parameters**:
- `hours` (optional): Time range in hours (default: 24)

## WebSocket API

For real-time updates, connect to the WebSocket endpoint:

```
ws://your-backend-ip:3000
```

Agents connect to this endpoint for bidirectional communication. The frontend can also connect for real-time updates.

Get WebSocket connection info:

**Endpoint**: `GET /api/websocket/info`

**Response**:
```json
{
  "websocket_endpoint": "ws://localhost:3000",
  "connected_clients": [...],
  "statistics": {
    "total_connections": 3,
    "messages_sent": 1500,
    "messages_received": 1200
  }
}
```

## Error Responses

All endpoints return standard error responses:

```json
{
  "success": false,
  "error": "Error message",
  "message": "Detailed error description"
}
```

Common HTTP status codes:
- `200`: Success
- `201`: Created
- `400`: Bad request (invalid parameters)
- `404`: Resource not found
- `409`: Conflict (duplicate resource)
- `500`: Internal server error
- `503`: Service unavailable

## Authentication

The current version does not require authentication. Future versions will support API keys and user authentication.

## Rate Limiting

Currently no rate limiting is enforced. For real-time updates, use the WebSocket connection instead of polling HTTP endpoints.

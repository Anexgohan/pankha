# PostgreSQL Database Guide

## Overview

Pankha uses PostgreSQL as its primary database for storing system configurations, sensor data, fan control settings, and historical monitoring data. This guide covers the complete database architecture, data flow, and operational details.

## Architecture

### Database Stack

- **Database**: PostgreSQL 17 (Alpine Linux container)
- **Driver**: `pg` (node-postgres) library
- **Connection Pool**: 20 max connections, 30s idle timeout
- **Schema Location**: `backend/src/database/schema.sql`
- **Auto-initialization**: Schema loaded on first container startup

### Container Configuration

```yaml
services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: pankha
      POSTGRES_PASSWORD: pankha
      POSTGRES_DB: db_pankha
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./backend/src/database/schema.sql:/docker-entrypoint-initdb.d/01-schema.sql:ro
```

## Database Schema

### Core Tables

#### 1. systems
Stores registered agent systems with their capabilities.

```sql
CREATE TABLE systems (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  agent_id VARCHAR(255) UNIQUE NOT NULL,
  ip_address VARCHAR(45),
  api_endpoint VARCHAR(500),
  websocket_endpoint VARCHAR(500),
  auth_token VARCHAR(500),
  agent_version VARCHAR(50),
  status VARCHAR(50) DEFAULT 'offline',
  capabilities JSONB,
  config_data JSONB,
  last_seen TIMESTAMP,
  last_data_received TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Key Fields:**
- `agent_id`: Unique identifier from agent (e.g., "linux-agent-pve-shadow")
- `capabilities`: JSON object with hardware details (sensors, fans)
- `status`: 'online', 'offline', 'error'
- `last_data_received`: Timestamp of last WebSocket data packet

#### 2. sensors
Stores temperature sensor definitions and current readings.

```sql
CREATE TABLE sensors (
  id SERIAL PRIMARY KEY,
  system_id INTEGER NOT NULL,
  sensor_name VARCHAR(255) NOT NULL,
  sensor_label VARCHAR(255),
  sensor_type VARCHAR(100),
  sensor_chip VARCHAR(255) NOT NULL,
  hwmon_path VARCHAR(500),
  temp_input_path VARCHAR(500),
  temp_max NUMERIC(8,2),
  temp_crit NUMERIC(8,2),
  current_temp NUMERIC(8,2),
  detection_regex VARCHAR(500),
  is_available BOOLEAN DEFAULT true,
  is_primary BOOLEAN DEFAULT false,
  user_selected BOOLEAN DEFAULT false,
  last_reading TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (system_id) REFERENCES systems(id) ON DELETE CASCADE
);
```

**Key Fields:**
- `sensor_name`: Unique sensor identifier (e.g., "k10temp_1", "nvme_2")
- `sensor_type`: Categorization (cpu, gpu, motherboard, nvme, acpi, other)
- `sensor_chip`: Hardware chip name (e.g., "k10temp", "it8628")
- `current_temp`: Latest temperature reading in Celsius
- `temp_max`, `temp_crit`: Hardware-defined temperature limits

**Precision Note:** Changed from NUMERIC(5,2) to NUMERIC(8,2) to handle:
- Large invalid values from faulty sensors (e.g., 65261.85°C)
- Future expansion for non-Celsius units

#### 3. fans
Stores fan control definitions and current speeds/RPM.

```sql
CREATE TABLE fans (
  id SERIAL PRIMARY KEY,
  system_id INTEGER NOT NULL,
  fan_name VARCHAR(255) NOT NULL,
  fan_label VARCHAR(255),
  fan_id INTEGER,
  pwm_path VARCHAR(500),
  pwm_enable_path VARCHAR(500),
  rpm_path VARCHAR(500),
  primary_sensor_id INTEGER,
  secondary_sensor_id INTEGER,
  sensor_logic VARCHAR(50) DEFAULT 'max',
  min_speed INTEGER DEFAULT 0,
  max_speed INTEGER DEFAULT 100,
  current_speed INTEGER,
  current_rpm INTEGER,
  target_speed INTEGER,
  is_controllable BOOLEAN DEFAULT true,
  enabled BOOLEAN DEFAULT true,
  last_command TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (system_id) REFERENCES systems(id) ON DELETE CASCADE,
  FOREIGN KEY (primary_sensor_id) REFERENCES sensors(id) ON DELETE SET NULL,
  FOREIGN KEY (secondary_sensor_id) REFERENCES sensors(id) ON DELETE SET NULL
);
```

**Key Fields:**
- `fan_name`: Unique fan identifier (e.g., "it8628_fan_1")
- `current_speed`: Current fan speed percentage (0-100)
- `current_rpm`: Actual RPM reading from hardware
- `target_speed`: Requested speed (may differ from current during ramp-up)
- `primary_sensor_id`, `secondary_sensor_id`: Linked temperature sensors
- `sensor_logic`: How to combine multiple sensors ('max', 'avg', 'primary_only')

#### 4. monitoring_data
Time-series storage for historical sensor and fan data.

```sql
CREATE TABLE monitoring_data (
  id SERIAL PRIMARY KEY,
  system_id INTEGER NOT NULL,
  sensor_id INTEGER,
  fan_id INTEGER,
  temperature NUMERIC(8,2),
  fan_speed INTEGER,
  fan_rpm INTEGER,
  timestamp TIMESTAMP NOT NULL,
  FOREIGN KEY (system_id) REFERENCES systems(id) ON DELETE CASCADE,
  FOREIGN KEY (sensor_id) REFERENCES sensors(id) ON DELETE SET NULL,
  FOREIGN KEY (fan_id) REFERENCES fans(id) ON DELETE SET NULL
);

CREATE INDEX idx_monitoring_data_timestamp ON monitoring_data(timestamp);
CREATE INDEX idx_monitoring_data_system_id ON monitoring_data(system_id);
CREATE INDEX idx_monitoring_data_sensor_id ON monitoring_data(sensor_id);
CREATE INDEX idx_monitoring_data_fan_id ON monitoring_data(fan_id);
```

**Data Retention:**
- Default: 30 days of historical data
- Cleanup: Automatic daily cleanup of old records
- Storage Rate: ~1 record per sensor/fan every 3 seconds

#### 5. fan_profiles
User-defined fan control profiles and curves.

```sql
CREATE TABLE fan_profiles (
  id SERIAL PRIMARY KEY,
  system_id INTEGER,
  profile_name VARCHAR(255) NOT NULL,
  description TEXT,
  profile_type VARCHAR(50) DEFAULT 'custom',
  is_global BOOLEAN DEFAULT false,
  profile_data JSONB,
  created_by VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (system_id) REFERENCES systems(id) ON DELETE CASCADE
);
```

**Profile Types:**
- `custom`: User-defined curves
- `silent`: Low-noise preset
- `balanced`: Performance/noise balance
- `performance`: Maximum cooling

## Data Flow

### 1. Agent Registration

**Sequence:**
```
Agent Startup → WebSocket Connect → Registration Message → Database Insert
```

**Code Flow:**
```typescript
// AgentManager.ts
public async registerAgent(agentConfig: AgentConfig): Promise<void> {
  await this.db.run(
    `INSERT INTO systems (
      name, agent_id, ip_address, api_endpoint, websocket_endpoint,
      auth_token, agent_version, status, capabilities, last_seen
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'online', $8, CURRENT_TIMESTAMP)
    ON CONFLICT (agent_id) DO UPDATE SET
      status = 'online',
      last_seen = CURRENT_TIMESTAMP`,
    [name, agentId, ipAddress, apiEndpoint, wsEndpoint, authToken, version, JSON.stringify(capabilities)]
  );
}
```

**Database Result:**
- New system record created or existing updated
- Status set to 'online'
- Capabilities stored as JSONB (sensors, fans, hardware info)

### 2. Real-time Data Transmission

**Agent sends data every 3 seconds:**
```json
{
  "type": "data",
  "data": {
    "agentId": "linux-agent-pve-shadow",
    "timestamp": "2025-10-02T03:18:33.661Z",
    "sensors": [
      {
        "id": "k10temp_1",
        "temperature": 60.6,
        "type": "cpu",
        "max_temp": 85,
        "crit_temp": 95
      }
    ],
    "fans": [
      {
        "id": "it8628_fan_1",
        "speed": 40,
        "rpm": 700,
        "targetSpeed": 40,
        "status": "ok"
      }
    ],
    "systemHealth": {
      "cpuUsage": 25.3,
      "memoryUsage": 86.5,
      "agentUptime": 723467.41
    }
  }
}
```

**Backend Processing:**
```
WebSocketHub receives message
  → AgentCommunication.handleAgentMessage()
    → AgentManager.updateAgentStatus()
      → UPDATE systems SET status='online', last_data_received=NOW()
    → DataAggregator.updateSystemData()
      → ensureSensorsExist()    [Create sensor records if missing]
      → ensureFansExist()        [Create fan records if missing]
      → storeHistoricalData()    [INSERT into monitoring_data]
      → updateSensorReadings()   [UPDATE sensors SET current_temp]
      → updateFanReadings()      [UPDATE fans SET current_speed, current_rpm]
```

### 3. Sensor/Fan Record Creation

**First-time sensor detection:**
```typescript
// DataAggregator.ts - ensureSensorsExist()
for (const sensor of sensors) {
  const existing = await db.get(
    'SELECT id FROM sensors WHERE system_id = $1 AND sensor_name = $2',
    [systemId, sensor.id]
  );

  if (!existing) {
    await db.run(
      `INSERT INTO sensors (
        system_id, sensor_name, sensor_label, sensor_type, sensor_chip,
        temp_max, temp_crit, is_available
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, true)`,
      [systemId, sensor.id, sensor.id, sensor.type || 'unknown', 'unknown',
       sensor.max_temp || null, sensor.crit_temp || null]
    );
  }
}
```

**Result:**
- Sensors created on first data packet
- Subsequent packets update existing records
- No manual configuration required

### 4. Historical Data Storage

**Every 3 seconds per agent:**
```typescript
// DataAggregator.ts - storeHistoricalData()
for (const sensor of dataPacket.sensors) {
  const sensorRecord = await db.get(
    'SELECT id FROM sensors WHERE system_id = $1 AND sensor_name = $2',
    [systemId, sensor.id]
  );

  if (sensorRecord) {
    await db.run(
      'INSERT INTO monitoring_data (system_id, sensor_id, temperature, timestamp) VALUES ($1, $2, $3, $4)',
      [systemId, sensorRecord.id, sensor.temperature, timestamp.toISOString()]
    );
  }
}

for (const fan of dataPacket.fans) {
  const fanRecord = await db.get(
    'SELECT id FROM fans WHERE system_id = $1 AND fan_name = $2',
    [systemId, fan.id]
  );

  if (fanRecord) {
    await db.run(
      'INSERT INTO monitoring_data (system_id, fan_id, fan_speed, fan_rpm, timestamp) VALUES ($1, $2, $3, $4, $5)',
      [systemId, fanRecord.id, fan.speed, fan.rpm, timestamp.toISOString()]
    );
  }
}
```

**Storage Rate (per system):**
- 14 sensors × 20 records/minute = 280 sensor records/minute
- 5 fans × 20 records/minute = 100 fan records/minute
- Total: ~380 records/minute per agent

### 5. Current Reading Updates

**Latest values stored in sensors/fans tables:**
```typescript
// Update sensors
await db.run(
  'UPDATE sensors SET current_temp = $1, last_reading = CURRENT_TIMESTAMP WHERE system_id = $2 AND sensor_name = $3',
  [sensor.temperature, systemId, sensor.id]
);

// Update fans
await db.run(
  'UPDATE fans SET current_speed = $1, current_rpm = $2, last_command = CURRENT_TIMESTAMP WHERE system_id = $3 AND fan_name = $4',
  [fan.speed, fan.rpm, systemId, fan.id]
);
```

**Query Performance:**
- Fast access to current state (no time-series scan)
- Dashboard uses current values from sensors/fans tables
- Historical data queried separately when needed

## Database Connection

### Connection Pool Configuration

```typescript
// backend/src/database/database.ts
export class Database {
  private pool: Pool;

  private constructor() {
    const databaseUrl = process.env.DATABASE_URL;

    this.pool = new Pool({
      connectionString: databaseUrl,
      max: 20,                    // Max connections
      idleTimeoutMillis: 30000,   // 30s idle timeout
      connectionTimeoutMillis: 2000, // 2s connection timeout
    });

    this.pool.on('error', (err) => {
      console.error('Unexpected error on idle PostgreSQL client', err);
    });
  }
}
```

### Environment Configuration

**Development:**
```env
DATABASE_URL=postgresql://pankha:pankha@postgres:5432/db_pankha
```

**Production:**
```env
DATABASE_URL=postgresql://pankha:pankha@postgres:5432/db_pankha
# Or external database:
# DATABASE_URL=postgresql://user:pass@external-host:5432/db_pankha
```

### Query Methods

```typescript
// Single row query
const system = await db.get('SELECT * FROM systems WHERE agent_id = $1', [agentId]);

// Multiple rows query
const sensors = await db.all('SELECT * FROM sensors WHERE system_id = $1', [systemId]);

// Insert/Update/Delete
const result = await db.run('INSERT INTO sensors (...) VALUES ($1, $2)', [val1, val2]);
// result.rowCount - number of affected rows
// result.rows[0] - first row if RETURNING clause used

// Transaction
await db.transaction(async (client) => {
  await client.query('INSERT INTO sensors ...');
  await client.query('UPDATE fans ...');
});
```

## Migration from SQLite

### Key Differences

| Feature | SQLite | PostgreSQL |
|---------|--------|------------|
| Auto-increment | `INTEGER PRIMARY KEY AUTOINCREMENT` | `SERIAL PRIMARY KEY` |
| JSON storage | `TEXT` (requires JSON.parse) | `JSONB` (native JSON) |
| Timestamps | `DATETIME` | `TIMESTAMP` |
| Placeholders | `?` (positional) | `$1, $2, $3` (numbered) |
| Result properties | `result.lastID`, `result.changes` | `result.rows[0].id`, `result.rowCount` |
| Triggers | `NEW.updated_at = CURRENT_TIMESTAMP` | Function + trigger |
| INSERT conflict | `INSERT OR IGNORE` | `INSERT ... ON CONFLICT DO NOTHING` |

### Migration Checklist

- [x] Replace sqlite3 with pg dependency
- [x] Convert schema syntax (AUTOINCREMENT → SERIAL, TEXT → JSONB, DATETIME → TIMESTAMP)
- [x] Update query placeholders (? → $1, $2, $3)
- [x] Fix result property access (lastID → rows[0].id, changes → rowCount)
- [x] Convert SQLite-specific SQL (OR IGNORE, triggers)
- [x] Remove JSON.parse() calls for JSONB columns
- [x] Test all database operations
- [x] Verify data persistence

## Performance Optimization

### Indexes

```sql
-- Time-series query optimization
CREATE INDEX idx_monitoring_data_timestamp ON monitoring_data(timestamp);
CREATE INDEX idx_monitoring_data_system_id ON monitoring_data(system_id);

-- Sensor/fan lookups
CREATE INDEX idx_sensors_system_id ON sensors(system_id);
CREATE INDEX idx_sensors_type ON sensors(sensor_type);
CREATE INDEX idx_fans_system_id ON fans(system_id);

-- System queries
CREATE INDEX idx_systems_agent_id ON systems(agent_id);
CREATE INDEX idx_systems_status ON systems(status);
```

### Data Retention

**Automatic cleanup (runs daily):**
```typescript
// DataAggregator.ts
private async cleanupOldData(): Promise<void> {
  const cutoffDate = new Date(Date.now() - this.dataRetentionDays * 24 * 60 * 60 * 1000);

  const result = await this.db.run(
    'DELETE FROM monitoring_data WHERE timestamp < $1',
    [cutoffDate.toISOString()]
  );

  if (result.rowCount && result.rowCount > 0) {
    console.log(`Cleaned up ${result.rowCount} old monitoring records`);
  }
}
```

**Configuration:**
- Default: 30 days retention
- Runs: Every 24 hours
- Scope: monitoring_data table only (not sensors/fans/systems)

### Query Optimization Tips

1. **Use indexes for time-range queries:**
   ```sql
   SELECT * FROM monitoring_data
   WHERE timestamp BETWEEN '2025-10-01' AND '2025-10-02'
   AND system_id = 1;
   ```

2. **Avoid SELECT * for large result sets:**
   ```sql
   -- Good
   SELECT temperature, timestamp FROM monitoring_data WHERE sensor_id = 1;

   -- Bad (returns all columns)
   SELECT * FROM monitoring_data WHERE sensor_id = 1;
   ```

3. **Use LIMIT for recent data:**
   ```sql
   SELECT * FROM monitoring_data
   WHERE sensor_id = 1
   ORDER BY timestamp DESC
   LIMIT 100;
   ```

## Troubleshooting

### Check Database Connection

```bash
# From host
docker exec pankha-dev-postgres-1 psql -U pankha -d db_pankha -c "SELECT version();"

# List tables
docker exec pankha-dev-postgres-1 psql -U pankha -d db_pankha -c "\dt"

# Check table structure
docker exec pankha-dev-postgres-1 psql -U pankha -d db_pankha -c "\d sensors"
```

### Verify Data Storage

```bash
# Count records
docker exec pankha-dev-postgres-1 psql -U pankha -d db_pankha -c "
  SELECT
    (SELECT COUNT(*) FROM systems) as systems,
    (SELECT COUNT(*) FROM sensors) as sensors,
    (SELECT COUNT(*) FROM fans) as fans,
    (SELECT COUNT(*) FROM monitoring_data) as monitoring_data;
"

# Check latest data
docker exec pankha-dev-postgres-1 psql -U pankha -d db_pankha -c "
  SELECT sensor_name, current_temp, last_reading
  FROM sensors
  WHERE current_temp IS NOT NULL
  ORDER BY last_reading DESC
  LIMIT 5;
"

# Check monitoring data rate
docker exec pankha-dev-postgres-1 psql -U pankha -d db_pankha -c "
  SELECT COUNT(*), MAX(timestamp) as latest, MIN(timestamp) as earliest
  FROM monitoring_data;
"
```

### Common Issues

#### 1. No data being saved

**Symptoms:**
- monitoring_data table empty
- sensors/fans have NULL current values

**Check:**
```bash
# Verify agent is connected
curl http://localhost:3000/api/systems | jq '.[].status'

# Check backend logs
docker logs pankha-dev-app-1 | grep -E "Persisted data|Error"
```

**Fix:**
- Ensure agent is sending data (check WebSocket connection)
- Verify DataAggregator is calling persistence methods
- Check for SQL errors in logs

#### 2. Numeric field overflow

**Error:**
```
ERROR: numeric field overflow
DETAIL: A field with precision 5, scale 2 must round to an absolute value less than 10^3.
```

**Cause:** Temperature value too large for NUMERIC(5,2)

**Fix:**
```sql
ALTER TABLE sensors
  ALTER COLUMN temp_max TYPE NUMERIC(8,2),
  ALTER COLUMN temp_crit TYPE NUMERIC(8,2),
  ALTER COLUMN current_temp TYPE NUMERIC(8,2);

ALTER TABLE monitoring_data
  ALTER COLUMN temperature TYPE NUMERIC(8,2);
```

#### 3. Column does not exist

**Error:**
```
ERROR: column "fan_chip" does not exist
```

**Cause:** INSERT statement references non-existent column

**Fix:** Check schema and update INSERT statement to match actual columns

#### 4. Connection pool exhausted

**Symptoms:**
- Timeouts on database queries
- "sorry, too many clients already" errors

**Fix:**
```typescript
// Increase pool size in database.ts
this.pool = new Pool({
  connectionString: databaseUrl,
  max: 40,  // Increased from 20
});
```

### Backup and Restore

**Backup database:**
```bash
docker exec pankha-dev-postgres-1 pg_dump -U pankha db_pankha > backup_$(date +%Y%m%d).sql
```

**Restore database:**
```bash
cat backup_20251002.sql | docker exec -i pankha-dev-postgres-1 psql -U pankha db_pankha
```

**Backup specific table:**
```bash
docker exec pankha-dev-postgres-1 pg_dump -U pankha -t monitoring_data db_pankha > monitoring_data_backup.sql
```

## Best Practices

### 1. Always use parameterized queries

```typescript
// Good
await db.run('SELECT * FROM sensors WHERE id = $1', [sensorId]);

// Bad (SQL injection risk)
await db.run(`SELECT * FROM sensors WHERE id = ${sensorId}`);
```

### 2. Handle JSONB properly

```typescript
// PostgreSQL returns JSONB as objects (no parsing needed)
const system = await db.get('SELECT capabilities FROM systems WHERE id = $1', [1]);
const sensors = system.capabilities.sensors; // Direct access

// SQLite required parsing
// const sensors = JSON.parse(system.capabilities).sensors; // OLD - not needed
```

### 3. Use transactions for related operations

```typescript
await db.transaction(async (client) => {
  await client.query('INSERT INTO sensors ...');
  await client.query('INSERT INTO fans ...');
  // Both succeed or both rollback
});
```

### 4. Close connections properly

```typescript
// Pool handles connections automatically
// No manual connection close needed for normal queries

// For transactions, connections auto-release
await db.transaction(async (client) => {
  // Connection automatically released after block
});
```

## Monitoring

### Database Size

```sql
SELECT pg_size_pretty(pg_database_size('db_pankha'));
```

### Table Sizes

```sql
SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

### Active Connections

```sql
SELECT
  count(*) as total_connections,
  count(*) FILTER (WHERE state = 'active') as active_connections,
  count(*) FILTER (WHERE state = 'idle') as idle_connections
FROM pg_stat_activity
WHERE datname = 'db_pankha';
```

### Slow Queries

```sql
SELECT
  query,
  calls,
  total_exec_time,
  mean_exec_time,
  max_exec_time
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 10;
```

## Summary

PostgreSQL provides a robust, scalable database solution for Pankha with:

- **Native JSON support** (JSONB) for efficient capability storage
- **Time-series optimization** with proper indexing
- **Concurrent connections** supporting multiple agents
- **Automatic data cleanup** maintaining reasonable storage
- **Standard tooling** for backup, monitoring, and administration

The migration from SQLite ensures production-ready performance and reliability for multi-agent deployments.

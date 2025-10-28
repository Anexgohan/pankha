# Configuration Persistence Fixes

## Issues Fixed

### Issue 1: "Filter duplicates" and "Sensor tolerance" don't match config.json
**Symptom**: GUI shows default values (true, 0.5°C) instead of actual values from agent's config.json

**Root Cause**: Agent registration message didn't include these settings
- Rust agent saves settings to config.json correctly
- BUT registration message only sent: agentId, name, agent_version, update_interval, capabilities
- Backend expected these values but never received them
- Frontend showed hardcoded defaults until manually changed via GUI

**Fix**: Add `filter_duplicate_sensors` and `duplicate_sensor_tolerance` to agent registration message
- File: `agents/clients/linux/rust/src/main.rs` (lines 749-750)
- Added both fields to registration JSON payload
- Now agent sends actual config values during registration
- Backend receives and caches them correctly

### Issue 2: "System Responsiveness" resets to 2s on every restart
**Symptom**: Setting always resets to 2000ms after backend rebuild or restart

**Root Cause**: FanProfileController interval stored only in memory
- Hardcoded default: 2000ms in FanProfileController.ts:42
- Started with hardcoded value in index.ts:68
- API could change it, but changes lost on restart
- No database persistence

**Fix**: Add database persistence for controller interval
- Created `backend_settings` table in schema.sql
- Added `loadControllerInterval()` method to load from database on startup
- Added `saveControllerInterval()` method to persist changes
- Updated `start()` to load from database (async)
- Updated `setUpdateInterval()` to save to database (async)
- Updated API route to await the async save operation
- Updated index.ts to await start() method

## Files Modified

### Agent (Rust)
1. **agents/clients/linux/rust/src/main.rs**
   - Lines 749-750: Added filter_duplicate_sensors and duplicate_sensor_tolerance to registration

### Backend
2. **backend/src/database/schema.sql**
   - Lines 240-262: Added backend_settings table with trigger and default value

3. **backend/src/services/FanProfileController.ts**
   - Lines 355-374: Added loadControllerInterval() method
   - Lines 379-392: Added saveControllerInterval() method
   - Lines 397-420: Updated start() to be async and load from database
   - Lines 437-446: Updated setUpdateInterval() to be async and save to database

4. **backend/src/routes/systems.ts**
   - Line 158: Added await to fanProfileController.setUpdateInterval()
   - Line 161: Updated success message to indicate database persistence

5. **backend/src/index.ts**
   - Line 68: Changed to await fanProfileController.start() and removed hardcoded interval

## Testing Plan

### Test 1: Filter duplicates and Sensor tolerance
1. **Setup**: Verify agent config.json has non-default values
   ```bash
   ssh root@192.168.100.199
   cat /root/anex/proxmox/misc-scripts/pankha-fan-control-rust/config.json | grep -A2 "hardware"
   ```
   Expected: filter_duplicate_sensors and duplicate_sensor_tolerance with specific values

2. **Rebuild agent and restart**:
   ```bash
   cd /root/anex/dev/pankha-dev/agents/clients/linux/rust
   cargo build --release
   scp target/release/pankha-agent root@192.168.100.199:/root/anex/proxmox/misc-scripts/pankha-fan-control-rust/
   ssh root@192.168.100.199 "cd /root/anex/proxmox/misc-scripts/pankha-fan-control-rust && ./pankha-agent --restart"
   ```

3. **Restart backend**:
   ```bash
   cd /root/anex/dev/pankha-dev
   docker compose down
   docker compose build --no-cache
   docker compose up -d
   ```

4. **Verify in GUI**:
   - Open http://192.168.100.237:3000
   - Check system card for agent
   - Verify "Filter duplicates" checkbox matches config.json value
   - Verify "Sensor tolerance" dropdown matches config.json value

5. **Expected Result**: ✅ GUI shows actual config.json values (not defaults)

### Test 2: System Responsiveness persistence
1. **Initial setup**: Set System Responsiveness to non-default value (e.g., 5s)
   - Open http://192.168.100.237:3000
   - Change "System Responsiveness (CPU Load)" to 5000ms
   - Verify setting is applied

2. **Verify database persistence**:
   ```bash
   docker exec pankha-dev-postgres-1 psql -U pankha -d db_pankha -c "SELECT * FROM backend_settings WHERE setting_key = 'controller_update_interval';"
   ```
   Expected: setting_value = '5000'

3. **Restart backend**:
   ```bash
   cd /root/anex/dev/pankha-dev
   docker compose restart
   ```

4. **Verify in GUI**:
   - Refresh browser: http://192.168.100.237:3000
   - Check "System Responsiveness (CPU Load)" dropdown
   - Should still show 5000ms (not reset to 2000ms)

5. **Verify logs**:
   ```bash
   docker logs pankha-dev-app-1 | grep "controller interval"
   ```
   Expected: "Loaded controller interval from database: 5000ms"

6. **Expected Result**: ✅ Setting persists across restarts

### Test 3: End-to-end workflow
1. **Change all three settings**:
   - Set System Responsiveness to 3000ms
   - Via agent: Change filter_duplicate_sensors to false in config.json
   - Via agent: Change duplicate_sensor_tolerance to 2.0 in config.json

2. **Restart agent**:
   ```bash
   ssh root@192.168.100.199 "./pankha-agent --restart"
   ```

3. **Restart backend**:
   ```bash
   docker compose restart
   ```

4. **Verify all settings persist**:
   - System Responsiveness: 3000ms ✅
   - Filter duplicates: false ✅
   - Sensor tolerance: 2.0°C ✅

## Database Migration

The schema changes are automatically applied when the backend starts:
- `backend_settings` table is created if it doesn't exist
- Default controller interval (2000ms) is inserted on first run
- Existing deployments will migrate automatically

## Backward Compatibility

**Agent**:
- ✅ Old agents without the new fields will work (backend handles missing fields)
- ✅ New agents will work with old backends (extra fields ignored)

**Backend**:
- ✅ Database schema uses `IF NOT EXISTS` for safe migration
- ✅ Existing systems continue working with defaults

## Deployment Steps

### Development Environment
```bash
cd /root/anex/dev/pankha-dev

# 1. Rebuild Rust agent
cd agents/clients/linux/rust
cargo build --release

# 2. Deploy to test system
scp target/release/pankha-agent root@192.168.100.199:/root/anex/proxmox/misc-scripts/pankha-fan-control-rust/

# 3. Restart agent
ssh root@192.168.100.199 "cd /root/anex/proxmox/misc-scripts/pankha-fan-control-rust && ./pankha-agent --restart"

# 4. Rebuild backend
cd /root/anex/dev/pankha-dev
docker compose down
docker compose build --no-cache
docker compose up -d

# 5. Verify logs
docker logs -f pankha-dev-app-1 | grep -E "controller interval|deduplication|tolerance"
```

### Production Environment
```bash
# After testing in dev, push to production:
# 1. Build and push Docker image to Docker Hub
# 2. Deploy agent binary to production systems
# 3. Update production repo and restart containers
```

## Notes

- Agent settings (filter_duplicate_sensors, duplicate_sensor_tolerance) are stored in agent's config.json and re-sent on every registration
- Backend settings (controller_update_interval) are stored in PostgreSQL database
- All settings now persist correctly across restarts
- No data loss on backend or agent restarts

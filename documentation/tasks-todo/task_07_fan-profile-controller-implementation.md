# Task 07: Fan Profile Controller Implementation

## Status
**NOT STARTED** - Missing Critical Feature

## Priority
**HIGH** - Fan profiles are assigned but not automatically applied

## Current State
- ✅ Fan profiles can be created with temperature curves
- ✅ Fan profiles can be assigned to fans with sensors
- ❌ **No service automatically applies profiles to control fan speeds**

## Problem
When a user assigns a fan profile to a fan via the dashboard:
1. The assignment is saved to `fan_profile_assignments` table
2. Nothing happens - fan speed remains unchanged
3. User expects automatic temperature-based speed control

## Required Implementation

### New Backend Service: `FanProfileController`

**Location:** `/backend/src/services/FanProfileController.ts`

**Purpose:** Continuously monitor temperatures and apply fan profile curves to control fan speeds

#### Core Loop Logic (Adapted from existing systemd script)

Based on `/root/anex/proxmox/misc-scripts/fan-control/fan_control.py`:

```typescript
class FanProfileController {
  private updateInterval: number = 2000; // User-configurable via "Fan Update Rate" setting
  private isRunning: boolean = false;
  private intervalTimer: NodeJS.Timeout | null = null;

  /**
   * Main control loop - runs every updateInterval milliseconds
   */
  private async controlLoop(): Promise<void> {
    try {
      // 1. Get all active fan profile assignments from database
      const assignments = await this.getActiveFanAssignments();

      // 2. For each assignment:
      for (const assignment of assignments) {
        // 2a. Get current sensor temperature
        const temperature = await this.getSensorTemperature(
          assignment.system_id,
          assignment.sensor_id
        );

        if (temperature === null) continue;

        // 2b. Get fan profile curve points
        const curvePoints = await this.getProfileCurvePoints(assignment.profile_id);

        // 2c. Calculate target fan speed from curve
        const targetSpeed = this.calculateFanSpeed(temperature, curvePoints);

        // 2d. Apply min/max constraints from fan configuration
        const constrainedSpeed = this.applySpeedConstraints(
          targetSpeed,
          assignment.fan_min_speed,
          assignment.fan_max_speed
        );

        // 2e. Send fan speed command to agent
        await this.sendFanSpeedCommand(
          assignment.system_id,
          assignment.fan_id,
          constrainedSpeed
        );

        // 2f. Log the action for debugging
        console.log(
          `Fan ${assignment.fan_name}: ${temperature}°C -> ${constrainedSpeed}% ` +
          `(profile: ${assignment.profile_name})`
        );
      }
    } catch (error) {
      console.error('Fan profile controller loop error:', error);
    }
  }

  /**
   * Calculate fan speed from temperature using curve interpolation
   * Algorithm from old fan_control.py:get_fan_speed()
   */
  private calculateFanSpeed(
    temperature: number,
    curvePoints: CurvePoint[]
  ): number {
    // Sort points by temperature (ascending)
    const sorted = curvePoints.sort((a, b) => a.temperature - b.temperature);

    // Edge cases
    if (temperature <= sorted[0].temperature) {
      return sorted[0].fan_speed;
    }
    if (temperature >= sorted[sorted.length - 1].temperature) {
      return sorted[sorted.length - 1].fan_speed;
    }

    // Find the two points to interpolate between
    for (let i = 0; i < sorted.length - 1; i++) {
      const lower = sorted[i];
      const upper = sorted[i + 1];

      if (temperature >= lower.temperature && temperature < upper.temperature) {
        // Linear interpolation
        const tempRange = upper.temperature - lower.temperature;
        const speedRange = upper.fan_speed - lower.fan_speed;
        const tempOffset = temperature - lower.temperature;

        return Math.round(
          lower.fan_speed + (tempOffset / tempRange) * speedRange
        );
      }
    }

    return sorted[0].fan_speed; // Fallback
  }

  /**
   * Start the controller with user-configured update rate
   */
  public start(updateIntervalMs: number = 2000): void {
    if (this.isRunning) {
      console.warn('Fan profile controller already running');
      return;
    }

    this.updateInterval = updateIntervalMs;
    this.isRunning = true;

    console.log(`🌀 Starting fan profile controller (update rate: ${updateIntervalMs}ms)`);

    // Run immediately, then repeat
    this.controlLoop();
    this.intervalTimer = setInterval(
      () => this.controlLoop(),
      this.updateInterval
    );
  }

  /**
   * Stop the controller
   */
  public stop(): void {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
    this.isRunning = false;
    console.log('🛑 Fan profile controller stopped');
  }

  /**
   * Update the control loop frequency (called when user changes "Fan Update Rate")
   */
  public setUpdateInterval(intervalMs: number): void {
    if (intervalMs < 500 || intervalMs > 60000) {
      throw new Error('Update interval must be between 500ms and 60000ms');
    }

    this.updateInterval = intervalMs;

    if (this.isRunning) {
      // Restart with new interval
      this.stop();
      this.start(intervalMs);
    }
  }
}
```

### Database Queries Needed

```typescript
/**
 * Get all active fan profile assignments with related data
 */
private async getActiveFanAssignments(): Promise<FanAssignment[]> {
  return await this.db.all(`
    SELECT
      fpa.id as assignment_id,
      fpa.fan_id,
      fpa.profile_id,
      fpa.sensor_id,
      f.system_id,
      f.fan_name,
      f.min_speed as fan_min_speed,
      f.max_speed as fan_max_speed,
      fp.profile_name,
      s.sensor_name
    FROM fan_profile_assignments fpa
    JOIN fans f ON fpa.fan_id = f.id
    JOIN fan_profiles fp ON fpa.profile_id = fp.id
    LEFT JOIN sensors s ON fpa.sensor_id = s.id
    WHERE fpa.is_active = TRUE
      AND f.enabled = TRUE
      AND f.is_controllable = TRUE
  `);
}

/**
 * Get current temperature from sensor
 */
private async getSensorTemperature(
  systemId: number,
  sensorId?: number
): Promise<number | null> {
  if (!sensorId) return null;

  // Get latest aggregated data from DataAggregator
  const systemData = this.dataAggregator.getSystemData(agentId);
  const sensor = systemData?.sensors.find(s => s.dbId === sensorId);

  return sensor?.temperature || null;
}

/**
 * Get fan profile curve points
 */
private async getProfileCurvePoints(profileId: number): Promise<CurvePoint[]> {
  return await this.db.all(`
    SELECT temperature, fan_speed
    FROM fan_curve_points
    WHERE profile_id = $1
    ORDER BY point_order ASC
  `, [profileId]);
}
```

### Integration Points

#### 1. **Server Initialization** (`backend/src/server.ts`)
```typescript
import { FanProfileController } from './services/FanProfileController';

// After initializing other services
const fanProfileController = FanProfileController.getInstance();
fanProfileController.start(2000); // Default 2 second update rate
```

#### 2. **Dashboard Setting: "Fan Update Rate"**

Add new dashboard control (similar to "Agent Rate"):

**Frontend Component:**
```typescript
<div className="info-item info-item-vertical">
  <span className="label">Fan Update:</span>
  <select
    className="fan-update-select"
    value={fanUpdateInterval}
    onChange={(e) => handleFanUpdateIntervalChange(parseFloat(e.target.value))}
    disabled={loading === 'fan-update-interval'}
  >
    <option value={500}>0.5s</option>
    <option value={1000}>1s</option>
    <option value={2000}>2s (default)</option>
    <option value={3000}>3s</option>
    <option value={5000}>5s</option>
    <option value={10000}>10s</option>
  </select>
</div>
```

**Backend API Endpoint:**
```typescript
router.put('/api/systems/:id/fan-update-interval', async (req, res) => {
  const { interval } = req.body;

  // Update in database
  await db.run(
    'UPDATE systems SET fan_update_interval = $1 WHERE id = $2',
    [interval, req.params.id]
  );

  // Apply to running controller
  fanProfileController.setUpdateInterval(interval);

  res.json({ success: true });
});
```

#### 3. **Error Handling & Safety**

**Fallback on Error:**
```typescript
private async controlLoop(): Promise<void> {
  try {
    // ... control logic ...
  } catch (error) {
    console.error('Fan controller error:', error);

    // Safety: If critical error, restore fans to safe speed
    if (this.consecutiveErrors > 3) {
      await this.setAllFansToSafeSpeed(75); // 75% as safe default
      this.stop();
      console.error('🚨 Fan controller stopped after repeated errors');
    }
  }
}
```

**Temperature Sensor Unavailable:**
```typescript
if (temperature === null) {
  // Keep fan at last known good speed, don't change
  console.warn(`Sensor ${assignment.sensor_name} unavailable, maintaining current speed`);
  continue;
}
```

### Database Schema Additions

**Add `fan_update_interval` to systems table:**
```sql
ALTER TABLE systems
ADD COLUMN fan_update_interval INTEGER DEFAULT 2000;
```

**Add index for faster queries:**
```sql
CREATE INDEX idx_fan_profile_assignments_active
ON fan_profile_assignments(is_active)
WHERE is_active = TRUE;
```

## Testing Plan

1. **Unit Tests:**
   - `calculateFanSpeed()` with various curve shapes
   - Edge cases: temperature below/above curve range
   - Linear interpolation accuracy

2. **Integration Tests:**
   - Assign profile to fan
   - Verify speed changes when temperature changes
   - Verify constraints are respected (min/max speed)

3. **Manual Testing:**
   - Dashboard: Assign profile to fan
   - Watch real-time fan speed respond to temperature
   - Change "Fan Update Rate" setting
   - Verify smooth transitions

## Success Criteria

- ✅ Assigning a fan profile automatically controls fan speed
- ✅ Fan speed updates based on temperature changes
- ✅ User can configure update frequency via "Fan Update Rate"
- ✅ System handles errors gracefully (sensor offline, etc.)
- ✅ Performance: minimal CPU overhead even with many fans

## References

- **Existing Implementation:** `/root/anex/proxmox/misc-scripts/fan-control/fan_control.py`
  - Main loop: `run()` method (lines ~290-310)
  - Fan update: `update_fans()` method (lines ~245-275)
  - Speed calculation: `get_fan_speed()` method (lines ~200-230)
  - PWM control: `set_fan_speed()` method (lines ~180-195)

- **Related Code:**
  - `backend/src/services/FanProfileManager.ts` - Profile CRUD operations
  - `backend/src/services/CommandDispatcher.ts` - Sending commands to agents
  - `backend/src/services/DataAggregator.ts` - Getting current sensor temperatures

## Estimated Effort
**4-6 hours** - Medium complexity task requiring new service, database updates, and dashboard integration.

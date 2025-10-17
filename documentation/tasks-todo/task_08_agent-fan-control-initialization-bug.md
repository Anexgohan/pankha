# Task 08: Agent Fan Control Initialization Bug

## Status
**CRITICAL BUG** - Fan Profile Controller is working, but agent cannot execute commands

## Priority
**HIGH** - Blocks fan profile automation feature

## Problem Description

The Pankha agent accepts `setFanSpeed` commands via WebSocket and logs them, but does NOT actually write PWM values to hardware.

### Symptoms

1. **Backend logs show successful command flow:**
   ```
   🌀 Fan it8628_fan_1: 52.8°C -> 100% (profile: Full_Fans)
   📤 Command sent to agent linux-agent-pve-shadow: setFanSpeed
   ✅ Command completed: setFanSpeed
   ```

2. **Agent logs show command receipt:**
   ```
   2025-10-07 10:23:15,606 - INFO - [BackendClient] Set it8628_fan_2 to 100%
   2025-10-07 10:23:15,779 - INFO - [BackendClient] Set it8628_fan_1 to 100%
   ```

3. **But agent returns error:**
   ```
   "Fan it8628_fan_1 not found. Available fans: []"
   ```

4. **Hardware PWM values are NOT updated:**
   - Expected: PWM = 255 (100%)
   - Actual: PWM = 153 (60%)
   - Command logged but not executed

### Root Cause

The agent's **FanControl module is not initialized** when `enable_fan_control` is set to `true`.

**Timeline:**
1. Agent was initially deployed with `enable_fan_control: false`
2. Config was updated to `enable_fan_control: true`
3. Agent was restarted
4. Agent did NOT initialize FanControl module on restart
5. Agent accepts commands but has no hardware interface to execute them

**Evidence:**
- Agent initialization logs show NO mention of:
  - "FanControl initialized"
  - "Discovered X fans"
  - PWM path discovery
- Agent responds with "Available fans: []" - the fan list is empty
- PWM files are never written despite commands being received

## Required Fix

### Location: Pankha Agent Code

**File:** `/root/anex/proxmox/misc-scripts/pankha-fan-control/pankha-agent/` (exact filename TBD)

**What needs to happen:**

1. **Check if FanControl is conditionally initialized:**
   ```python
   # Current (broken) behavior - SPECULATION
   if config['hardware']['enable_fan_control']:
       self.fan_control = FanControl()
       self.fan_control.discover_fans()
   ```

2. **Verify the BackendClient command handler:**
   ```python
   # Currently accepting commands without checking if FanControl exists
   def handle_set_fan_speed(self, fan_id, speed):
       self.logger.info(f"Set {fan_id} to {speed}%")
       # BUG: No actual call to self.fan_control.set_fan_speed()!
   ```

3. **Expected behavior:**
   - If `enable_fan_control` is `true`, initialize FanControl module
   - Discover fans and PWM paths
   - When `setFanSpeed` command received, call `fan_control.set_fan_speed()`
   - Write PWM value to `/sys/class/hwmon/hwmon*/pwm*`

### Investigation Steps

1. **Find the agent's main initialization code:**
   ```bash
   ssh root@192.168.100.199 "find /root/anex/proxmox/misc-scripts/pankha-fan-control/pankha-agent -name '*.py' -type f"
   ```

2. **Search for FanControl class:**
   ```bash
   grep -rn "class FanControl" /root/anex/proxmox/misc-scripts/pankha-fan-control/pankha-agent/
   ```

3. **Search for setFanSpeed command handler:**
   ```bash
   grep -rn "setFanSpeed\|Set.*to.*%" /root/anex/proxmox/misc-scripts/pankha-fan-control/pankha-agent/
   ```

4. **Check if FanControl is instantiated:**
   ```bash
   grep -rn "FanControl()" /root/anex/proxmox/misc-scripts/pankha-fan-control/pankha-agent/
   ```

### Expected Code Changes

**1. Ensure FanControl initialization on startup:**

```python
# In agent initialization
class PankhaAgent:
    def __init__(self, config):
        self.config = config
        self.sensor_discovery = SensorDiscovery()

        # Initialize FanControl if enabled
        if config['hardware']['enable_fan_control']:
            self.fan_control = FanControl()
            discovered = self.fan_control.discover_fans()
            logger.info(f"FanControl initialized: {len(discovered)} fans discovered")
        else:
            self.fan_control = None
            logger.info("FanControl disabled in config")
```

**2. Fix command handler to actually control fans:**

```python
# In BackendClient or command handler
async def handle_set_fan_speed_command(self, command_data):
    fan_id = command_data['fanId']
    speed = command_data['speed']

    # Log the command (this currently works)
    self.logger.info(f"Set {fan_id} to {speed}%")

    # MISSING: Actually execute the command!
    if not self.agent.fan_control:
        return {
            "status": "error",
            "message": "Fan control is not enabled on this agent",
            "timestamp": datetime.utcnow().isoformat() + "Z"
        }

    # Execute the fan speed change
    result = self.agent.fan_control.set_fan_speed(fan_id, speed)
    return result
```

**3. Add error checking:**

```python
# Don't accept fan control commands if FanControl isn't initialized
if command_type == 'setFanSpeed':
    if not hasattr(self, 'fan_control') or self.fan_control is None:
        return {
            "status": "error",
            "message": "Fan control not initialized. Check enable_fan_control setting.",
            "timestamp": datetime.utcnow().isoformat() + "Z"
        }
    # ... proceed with command
```

## Testing Plan

**After fix is implemented:**

1. **Verify FanControl initialization:**
   ```bash
   # Restart agent and check logs
   ./pankha-agent.sh restart
   tail -f /var/log/pankha-agent/agent.log | grep -i "fancontrol\|discovered"
   ```

   Expected output:
   ```
   INFO - FanControl initialized: 5 fans discovered
   INFO - Discovered fans: it8628_fan_1, it8628_fan_2, it8628_fan_3, it8628_fan_4, it8628_fan_5
   ```

2. **Test manual fan speed command:**
   ```bash
   # From backend, send a test command
   # Check PWM value before
   cat /sys/class/hwmon/hwmon3/pwm1

   # Send command (via dashboard or API)
   # Check PWM value after
   cat /sys/class/hwmon/hwmon3/pwm1
   ```

   Expected: PWM value should change

3. **Test fan profile automation:**
   - Assign fan profile with sensor via dashboard
   - Wait 2-5 seconds
   - Check agent logs for "Set {fan} to {speed}%"
   - Verify PWM files are updated
   - Verify fan RPMs change accordingly

4. **Test with fan control disabled:**
   - Set `enable_fan_control: false` in config
   - Restart agent
   - Attempt to send setFanSpeed command
   - Expected: Agent returns error "Fan control not enabled"

## Workaround (Temporary)

Until the agent is fixed, use the old systemd fan control service:

```bash
# Re-enable the old fan control
systemctl start fan-control.service
systemctl enable fan-control.service

# Verify it's controlling fans
systemctl status fan-control.service
```

**Note:** This will control fans independently of the Pankha backend. The old service reads its own config file and applies its own curves.

## Success Criteria

- ✅ Agent logs "FanControl initialized: X fans discovered" on startup when `enable_fan_control: true`
- ✅ Agent executes setFanSpeed commands and writes to PWM hardware
- ✅ PWM values change when commands are sent
- ✅ Fan RPMs respond to speed changes
- ✅ Fan Profile Controller successfully controls fan speeds via agent
- ✅ Agent returns proper error when fan control is disabled

## Related Files

**Remote Agent:**
- Config: `/root/anex/proxmox/misc-scripts/pankha-fan-control/pankha-agent/config/config.json`
- Logs: `/var/log/pankha-agent/agent.log`
- Script: `/root/anex/proxmox/misc-scripts/pankha-fan-control/pankha-agent.sh`

**Backend:**
- FanProfileController: `backend/src/services/FanProfileController.ts` ✅ Working correctly
- CommandDispatcher: `backend/src/services/CommandDispatcher.ts` ✅ Working correctly

**Hardware:**
- PWM files: `/sys/class/hwmon/hwmon3/pwm{1-5}`
- Fan RPM: `/sys/class/hwmon/hwmon3/fan{1-5}_input`

## Estimated Effort

**2-3 hours** - Requires investigation and modification of agent Python code

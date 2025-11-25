# Testing Guide - Pankha Windows Agent

**Version**: 1.0.0
**Last Updated**: 2025-01-24
**Status**: Ready for Testing

---

## 🎯 Testing Overview

This guide provides step-by-step instructions for testing the Windows agent at different levels:

1. **Build Verification** - Ensure project compiles
2. **Hardware Discovery** - Test sensor/fan detection (no backend needed)
3. **WebSocket Connection** - Test backend communication
4. **Integration Testing** - Full end-to-end with frontend
5. **Fan Control** - Hardware fan control (CRITICAL - requires care)

---

## ✅ Test 1: Build Verification

**Purpose**: Verify the project builds successfully
**Requirements**: .NET 8 SDK
**Risk Level**: 🟢 None

### Steps

```powershell
# Navigate to project
cd "D:\Cache temp\temp\pankha-fan-control\dev\pankha-dev\agents\clients\windows\varient-c"

# Restore dependencies
dotnet restore

# Build project
dotnet build
```

### Expected Output

```
Build succeeded.
    2 Warning(s)
    0 Error(s)
Time Elapsed 00:00:02.11
```

### Success Criteria
- ✅ Build completes without errors
- ✅ Warnings are acceptable (package version resolution)
- ✅ Output DLL exists: `bin/Debug/net8.0-windows/win-x64/pankha-agent.dll`

### Troubleshooting
- **Error: .NET SDK not found** → Install .NET 8 SDK from https://dot.net
- **Error: Package restore failed** → Check internet connection, retry

---

## ✅ Test 2: Hardware Discovery

**Purpose**: Verify sensor and fan discovery works
**Requirements**: Windows 10/11, Administrator privileges
**Risk Level**: 🟢 Safe (Read-only)

### Steps

```powershell
# Run hardware discovery test
dotnet run -- --test
```

### Expected Output

```
=== Hardware Discovery Test ===

Discovering sensors...
✅ Discovered 15 sensors

📊 Top 10 Sensors:
  • CPU Package - 45.0°C (ok)
  • CPU Core #0 - 43.5°C (ok)
  • CPU Core #1 - 44.0°C (ok)
  • GPU Temperature - 52.0°C (ok)
  • Motherboard - 38.0°C (ok)
  ... and 5 more

Discovering fans...
✅ Discovered 5 fans

🌀 Fans:
  • CPU Fan - 1200 RPM (ok, Controllable)
  • Case Fan 1 - 800 RPM (ok, Controllable)
  • Case Fan 2 - 850 RPM (ok, Controllable)
  • GPU Fan - 1500 RPM (ok, Read-only)
  ... and 1 more

✅ System Health:
  • CPU Usage: 15.2%
  • Memory Usage: 42.8%
  • Agent Uptime: 2s

=== Test Complete ===
```

### Success Criteria
- ✅ Discovers at least 1 sensor
- ✅ Shows temperature values
- ✅ Identifies controllable vs read-only fans
- ✅ System health shows valid percentages

### Troubleshooting
- **No sensors discovered**:
  - Ensure running as Administrator (Right-click PowerShell → "Run as Administrator")
  - LibreHardwareMonitor may prompt to install driver - click Yes
  - Some laptops have restricted sensor access

- **Access denied errors**:
  - Must run as Administrator
  - Check Windows UAC settings

- **LibreHardwareMonitor driver prompt**:
  - Click "Yes" to install driver
  - Driver is required for hardware access
  - Signed driver, safe to install

### Interpretation

**Sensor Count**:
- Desktop: Expect 10-30 sensors (CPU, motherboard, GPU, drives)
- Laptop: Expect 5-15 sensors (more restricted)

**Fan Controllability**:
- **Controllable**: Has PWM control, can be adjusted
- **Read-only**: Can only monitor RPM, cannot control
- Desktop motherboards typically have 3-6 controllable fans
- Laptops may have 0 controllable fans (BIOS-managed)

---

## ✅ Test 3: WebSocket Connection (Backend Required)

**Purpose**: Verify agent connects to backend and transmits data
**Requirements**: Backend running at `ws://192.168.100.237:3000/websocket`
**Risk Level**: 🟢 Safe (No fan control yet)

### Prerequisites

**Start Backend**:
```bash
# On Linux server (192.168.100.237)
cd /root/anex/dev/pankha-dev
docker compose up -d

# Verify backend is running
curl http://192.168.100.237:3000/health
```

### Steps

```powershell
# Run agent in foreground mode
dotnet run -- --foreground
```

### Expected Output

```
2025-01-24 12:00:00 [INF] Pankha Windows Agent starting...
2025-01-24 12:00:00 [INF] Version: 1.0.0.0
2025-01-24 12:00:00 [INF] OS: Microsoft Windows NT 10.0.22631.0
2025-01-24 12:00:00 [INF] .NET Runtime: 8.0.1
2025-01-24 12:00:00 [INF] Loading configuration from config.json
2025-01-24 12:00:00 [INF] Agent ID: windows-mypc-abc123
2025-01-24 12:00:00 [INF] Backend: ws://192.168.100.237:3000/websocket
2025-01-24 12:00:01 [INF] Connecting to ws://192.168.100.237:3000/websocket
2025-01-24 12:00:01 [INF] ✅ Connected to backend
2025-01-24 12:00:01 [INF] Sending registration message...
2025-01-24 12:00:01 [INF] ✅ Registration sent
2025-01-24 12:00:01 [DBG] Received message: registered
2025-01-24 12:00:01 [INF] ✅ Registration confirmed by backend
2025-01-24 12:00:04 [DBG] 📊 Data sent: 15 sensors, 5 fans
2025-01-24 12:00:07 [DBG] 📊 Data sent: 15 sensors, 5 fans
2025-01-24 12:00:10 [DBG] 📊 Data sent: 15 sensors, 5 fans
...
```

### Success Criteria
- ✅ Connects to backend within 5 seconds
- ✅ Registration confirmed
- ✅ Data sent every 3 seconds
- ✅ No error messages

### Troubleshooting

**Cannot connect**:
- Verify backend is running: `curl http://192.168.100.237:3000/health`
- Check firewall allows port 3000
- Verify URL in `config.json` matches backend
- Try: `ping 192.168.100.237` to test network

**Connection timeout**:
- Backend may be overwhelmed - check logs
- Network latency too high
- Firewall blocking WebSocket upgrade

**Registration fails**:
- Check backend logs for errors
- Verify JSON format in logs
- Agent may need restart

### Backend Verification

Check backend logs:
```bash
docker logs pankha-dev-app-1 -f
```

Expected in backend:
```
[INFO] WebSocket client connected from ::ffff:192.168.1.100
[INFO] Agent registered: windows-mypc-abc123
[INFO] Received data from windows-mypc-abc123: 15 sensors, 5 fans
```

---

## ✅ Test 4: Frontend Integration

**Purpose**: Verify Windows agent appears in dashboard
**Requirements**: Backend + Frontend running
**Risk Level**: 🟢 Safe

### Prerequisites

```bash
# On Linux server (192.168.100.237)
cd /root/anex/dev/pankha-dev

# Ensure both backend and frontend are running
docker compose up -d
npm run dev
```

### Steps

1. **Start Windows agent**:
   ```powershell
   dotnet run -- --foreground
   ```

2. **Open frontend dashboard**:
   - URL: `http://192.168.100.237:5173/`
   - Or: `http://localhost:5173/` if frontend dev server local

3. **Verify agent card appears**:
   - Look for card titled "Windows Agent - MYPC" (or your hostname)
   - Status badge should show "ONLINE" 🟢

### Expected Result

**Dashboard shows**:
- ✅ Windows agent card visible
- ✅ Status: "ONLINE" with green badge
- ✅ Sensors listed with temperatures
- ✅ Fans listed with RPM values
- ✅ Values update every 3 seconds
- ✅ Last seen timestamp updates

### Success Criteria
- ✅ Agent card renders correctly
- ✅ Real-time updates visible (watch temperature/RPM change)
- ✅ No JavaScript errors in browser console

### Troubleshooting

**Agent not appearing**:
- Wait 10 seconds - may take time to register
- Refresh page (Ctrl + F5 for hard refresh)
- Check backend logs - agent may not be registered
- Verify agent shows "Registration confirmed" in logs

**Data not updating**:
- Check WebSocket connection in browser DevTools → Network → WS
- Backend may have disconnected agent
- Restart agent

**Sensors show but no values**:
- Data transmission may be failing
- Check agent logs for send errors
- Backend may not be broadcasting

---

## ⚠️ Test 5: Fan Control (CRITICAL - Hardware Risk)

**Purpose**: Verify fan speed control works safely
**Requirements**: Windows machine with controllable fans
**Risk Level**: 🟡 CAUTION - Can affect hardware cooling

### ⚠️ SAFETY WARNINGS

**READ BEFORE TESTING FAN CONTROL:**

1. **Use Non-Critical Hardware**:
   - DO NOT test on production systems
   - Use old/spare hardware if possible
   - Have BIOS fan control as fallback

2. **Monitor Temperatures**:
   - Keep HWiNFO64 or similar open
   - Watch CPU/GPU temperatures continuously
   - Stop if any temp >75°C

3. **Emergency Procedures**:
   - **Ctrl+C**: Stops agent (fans revert to BIOS)
   - **BIOS**: Reboot to BIOS to restore fan control
   - **Physical**: Power off if temps critical

4. **Test Environment**:
   - Room temperature <25°C preferred
   - Low system load (idle system)
   - Good airflow around case

### Prerequisites

**BIOS Configuration** (CRITICAL):
- Set fans to "PWM Mode" (NOT "DC Mode")
- Disable "Q-Fan", "Smart Fan", or vendor fan control
- Set fans to "Manual" or "Full Speed" mode
- Save and reboot

**Verification**:
```powershell
# Verify fans are detected as controllable
dotnet run -- --test

# Look for: "Controllable" next to fan names
# If all fans say "Read-only", check BIOS settings
```

### Test Procedure

**Step 1: Baseline** (Read-only, safe)
```powershell
# Run agent (no commands yet)
dotnet run -- --foreground

# In another terminal, watch fans:
dotnet run -- --test
# Note initial RPM values
```

**Step 2: Single Fan Test** (Low risk)

Use frontend dashboard or API:
```bash
# Set ONE fan to 50% via API
curl -X POST http://192.168.100.237:3000/api/systems/{systemId}/fans/{fanId} \
  -H "Content-Type: application/json" \
  -d '{"speed": 50}'
```

**Monitor**:
- Agent logs should show: `[INF] Setting fan {fanId} to 50%`
- RPM should decrease (run `--test` again to check)
- Temperature should remain stable

**Step 3: Increase Speed** (Verify control works both ways)
```bash
# Set same fan to 75%
curl ... -d '{"speed": 75}'
```

**Monitor**:
- RPM should increase
- Temperature should decrease (better cooling)

**Step 4: Emergency Stop Test**
```bash
# Trigger emergency stop
curl -X POST http://192.168.100.237:3000/api/emergency-stop
```

**Expected**:
- All fans jump to 100%
- Agent logs: `[WRN] EMERGENCY STOP activated`
- Immediate temperature drop

### Success Criteria
- ✅ Fan speed changes when commanded
- ✅ Minimum speed enforced (cannot go below 30%)
- ✅ Emergency stop sets all fans to 100%
- ✅ Temperatures remain safe (<70°C)
- ✅ Fans revert to BIOS control when agent stops

### Troubleshooting

**Fans don't respond**:
- Check BIOS settings (PWM mode, manual control)
- Some motherboards block software control
- Try different fan headers
- Check LibreHardwareMonitor compatibility

**Minimum speed not enforced**:
- Bug in safety code - STOP TESTING
- Report issue immediately

**Temperatures rising**:
- Stop test immediately (Ctrl+C)
- Fans may have stopped - check physically
- Reboot to BIOS

**Fans stay at set speed after agent stops**:
- Expected behavior on some boards
- Reboot to restore BIOS control
- Or manually set in BIOS

### Hardware Compatibility Notes

**Known Working**:
- ASUS: Z690, X570 chipsets (IT86xx chips)
- MSI: Z690, X570 chipsets (NCT67xx chips)
- Gigabyte: Most boards with IT86xx chips

**Limited/No Support**:
- Some laptops (BIOS-locked)
- Proprietary fan controllers (Dell, HP OEM)
- GPU fans (usually driver-controlled)

---

## 🧪 Test 6: Reconnection & Stability

**Purpose**: Verify agent handles network issues gracefully
**Requirements**: Backend running
**Risk Level**: 🟢 Safe

### Test Scenarios

**Scenario 1: Backend Restart**
```bash
# Stop backend
docker compose down

# Observe agent logs:
# [WRN] WebSocket disconnected
# [INF] Reconnecting in 5000ms (attempt 1)
# [ERR] Failed to connect to backend
# [INF] Reconnecting in 7000ms (attempt 2)

# Restart backend
docker compose up -d

# Observe agent logs:
# [INF] ✅ Connected to backend
# [INF] ✅ Registration confirmed by backend
```

**Scenario 2: Network Interruption**
```powershell
# While agent running, disconnect network cable
# Or: Disable network adapter temporarily

# Observe same reconnection behavior

# Restore network

# Agent should reconnect automatically
```

**Scenario 3: Long-term Stability**
```powershell
# Run agent for 24 hours
dotnet run -- --foreground

# Monitor:
# - Memory usage (should stay <50MB)
# - CPU usage (should stay <2%)
# - No errors in logs
# - Continuous data transmission
```

### Success Criteria
- ✅ Reconnects automatically after disconnect
- ✅ Exponential backoff prevents server hammering
- ✅ No memory leaks over 24 hours
- ✅ No crash or hang

---

## 📊 Test Results Template

### Environment

```
Date: __________
OS: Windows __ (build ____)
.NET Version: ____
CPU: ____
Motherboard: ____ (chipset: ____)
RAM: ____ GB
Backend Version: ____
```

### Results

| Test | Status | Notes |
|------|--------|-------|
| Build Verification | ☐ Pass / ☐ Fail | |
| Hardware Discovery | ☐ Pass / ☐ Fail | Sensors: ___ Fans: ___ |
| WebSocket Connection | ☐ Pass / ☐ Fail | |
| Frontend Integration | ☐ Pass / ☐ Fail | |
| Fan Control | ☐ Pass / ☐ Fail / ☐ Skip | |
| Reconnection | ☐ Pass / ☐ Fail | |

### Hardware Compatibility

| Component | Detected | Controllable | Notes |
|-----------|----------|--------------|-------|
| CPU Temp | ☐ Yes / ☐ No | N/A | |
| MB Sensors | ☐ Yes / ☐ No | N/A | Chip: ____ |
| Fan 1 | ☐ Yes / ☐ No | ☐ Yes / ☐ No | |
| Fan 2 | ☐ Yes / ☐ No | ☐ Yes / ☐ No | |
| Fan 3 | ☐ Yes / ☐ No | ☐ Yes / ☐ No | |

---

## 🐛 Known Issues & Limitations

1. **Log Level Dynamic Update**:
   - `setLogLevel` command saves config but doesn't update Serilog in real-time
   - Workaround: Restart agent to apply new log level

2. **Laptop Compatibility**:
   - Many laptops restrict fan control via BIOS
   - May only get sensor monitoring (no fan control)
   - Dell/HP OEM systems particularly restricted

3. **GPU Fans**:
   - Usually controlled by GPU driver, not motherboard
   - May appear as "Read-only"
   - NVIDIA/AMD vendor tools retain control

4. **First Run Driver Prompt**:
   - LibreHardwareMonitor prompts to install kernel driver
   - This is normal and required
   - Driver is signed and safe

---

## 📝 Reporting Issues

If you encounter issues during testing:

1. **Collect logs**:
   ```powershell
   # Logs are in: logs/agent-YYYYMMDD.log
   # Include last 100 lines in bug report
   ```

2. **System info**:
   ```powershell
   dotnet --version
   dotnet --info
   # Include in report
   ```

3. **Hardware details**:
   - Motherboard make/model
   - CPU make/model
   - Sensors detected vs expected
   - Fans detected vs actual

4. **Report to**:
   - GitHub: https://github.com/Anexgohan/pankha-dev/issues
   - Include: Environment, Test Results, Logs, Hardware Details

---

## ✅ Test Completion Checklist

Before marking testing complete:

- [ ] Build verification passed
- [ ] Hardware discovery shows expected sensors/fans
- [ ] WebSocket connection established
- [ ] Frontend dashboard shows Windows agent
- [ ] Real-time data updates visible
- [ ] Fan control tested (if hardware supports)
- [ ] Reconnection tested
- [ ] 24-hour stability test passed
- [ ] Results documented
- [ ] Issues reported (if any)

---

**Last Updated**: 2025-01-24
**Next Update**: After first hardware test
**Maintained By**: Development Team


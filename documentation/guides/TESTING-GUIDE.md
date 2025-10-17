# Pankha System Testing Guide

This guide shows how to test the complete Pankha fan control system using real Linux client agents.

## Testing Overview

The testing setup includes:
- **Backend Server**: Core API and WebSocket services with PostgreSQL
- **Real Linux Agents**: Hardware monitoring agents on actual systems
- **Frontend Dashboard**: Real-time monitoring interface
- **Integration Tests**: End-to-end system validation

## Quick Start Testing

### 1. Test Backend Only
```bash
# Start the backend server with PostgreSQL
docker compose up -d

# Test the API endpoints
curl http://192.168.100.237:3000/health
curl http://192.168.100.237:3000/api/overview
```

### 2. Test with Real Linux Agent
```bash
# On the backend server: Start backend
docker compose up -d

# On the client system (192.168.100.199): Start real agent
ssh root@192.168.100.199
cd /root/anex/proxmox/misc-scripts/pankha-fan-control
./pankha-agent.sh start
```

### 3. Test with Frontend
```bash
# Backend: Already running
docker compose up -d

# Client agent: Already running on 192.168.100.199
# Access frontend: http://192.168.100.237:3000
```

## Real Agent Testing

The Linux client agent provides:

### Hardware Components
- **25+ Temperature Sensors**: Real hardware monitoring
  - CPU Temperature (k10temp - AMD Ryzen 9 3900X)
  - Motherboard Temperature (it8628 chipset)
  - NVMe SSD Temperature (nvme sensors)
  - Thermal zones (ACPI thermal management)

- **5 Controllable Fans**: Real PWM fan control
  - it8628 Fan 1-5 with PWM control (0-255 range)
  - Real RPM monitoring and control
  - Hardware-based PWM enable/disable

### Real Hardware Behavior
- **Dynamic Temperature Changes**: Actual CPU/system load affects sensor readings
- **Real Fan Response**: PWM commands control actual hardware fans
- **Hardware Limits**: Real temperature thresholds and fan safety limits
- **System Integration**: Real hardware monitoring with full sensor discovery

### Agent Management
```bash
# SSH to client system
ssh root@192.168.100.199
cd /root/anex/proxmox/misc-scripts/pankha-fan-control

# Agent lifecycle management
./pankha-agent.sh start      # Start the real agent
./pankha-agent.sh status     # Check agent status
./pankha-agent.sh logs       # View real-time logs
./pankha-agent.sh stop       # Stop the agent
./pankha-agent.sh config     # Edit configuration
```

## Testing Scenarios

### 1. Basic Connectivity Test
```bash
# On client system
./pankha-agent.sh test-connection
```
**Expected Results:**
- Server connectivity verified
- WebSocket connection established  
- Real hardware discovery completed
- Agent registration successful

### 2. Real-time Data Test
```bash
# Start agent and monitor logs
./pankha-agent.sh start
./pankha-agent.sh logs

# Check backend registration
curl http://192.168.100.237:3000/api/systems
```
**Expected Results:**
- Agent registered with real hardware capabilities
- 25+ sensors reporting actual temperatures
- 5 fans reporting actual RPM values
- WebSocket data transmission every 3 seconds

### 3. Fan Control Test
```bash
# Use dashboard to:
# 1. Move fan speed sliders
# 2. Watch actual RPM values change
# 3. Observe real hardware fan response
```
**Expected Results:**
- Fan speeds change on actual hardware
- RPM readings reflect real fan speeds
- Hardware responds to PWM commands

### 4. Temperature Monitoring Test
```bash
# Monitor real temperature changes
# Generate CPU load: stress --cpu 12 --timeout 60s
# Watch temperature sensors respond to actual load
```
**Expected Results:**
- CPU temperature increases with actual load
- Sensor readings reflect real thermal conditions
- Multiple sensor types report independently

## API Testing

### Health Check
```bash
curl http://192.168.100.237:3000/health
```
Expected: All services "connected" and WebSocket clients > 0

### System Overview  
```bash
curl http://192.168.100.237:3000/api/overview
```
Expected: Real sensor/fan counts, actual temperature data

### List Systems
```bash
curl http://192.168.100.237:3000/api/systems
```
Expected: Real agent with 25+ sensors, 5+ fans, live data

### Fan Control
```bash
curl -X PUT http://192.168.100.237:3000/api/systems/1/fans/it8628_fan_1 \
     -H "Content-Type: application/json" \
     -d '{"speed": 75, "priority": "normal"}'
```
Expected: Real hardware fan speed change

## WebSocket Testing

### Connection Verification
- **Backend Logs**: Check for WebSocket connections
- **Agent Logs**: Verify WebSocket registration success
- **Dashboard**: Real-time data updates every 3 seconds

```bash
# Monitor WebSocket activity
docker logs pankha-dev-app-1 --tail 20
ssh root@192.168.100.199 "tail -f /var/log/pankha-agent/agent.log"
```

### Expected WebSocket Messages
- `✅ WebSocket connected`
- `✅ Agent registered successfully via WebSocket`
- Continuous sensor data transmission
- Real-time fan control commands

## Performance Testing

### Real Hardware Characteristics
- **Memory Usage**: <50MB per agent
- **CPU Usage**: <1% during normal operation
- **Network Traffic**: ~1KB/s per agent (3-second intervals)
- **Response Times**: 
  - Fan control: <500ms hardware response
  - Temperature updates: 3-second intervals
  - WebSocket latency: <50ms

### Load Testing
```bash
# Monitor system resources
htop  # Watch CPU/memory usage
ss -tuln | grep :3000  # Check connections
curl -s http://192.168.100.237:3000/health | jq '.statistics'
```

## Troubleshooting Real Agents

### Common Issues

1. **Agent Won't Start**
   ```bash
   # Check configuration
   ./pankha-agent.sh config
   
   # Test hardware access
   ./pankha-agent.sh test-connection
   
   # Check permissions
   ls -la /sys/class/hwmon/
   ```

2. **WebSocket Connection Failed**
   ```bash
   # Check server reachability
   curl http://192.168.100.237:3000/health
   
   # Verify WebSocket port (3000)
   telnet 192.168.100.237 3000
   
   # Check agent configuration
   cat pankha-agent/config/config.json
   ```

3. **No Sensor Data**
   ```bash
   # Check hardware sensors
   sensors
   ls /sys/class/hwmon/*/temp*_input
   
   # Verify agent hardware discovery
   ./pankha-agent.sh logs | grep "sensor"
   ```

4. **Fan Control Not Working**
   ```bash
   # Check PWM availability
   ls /sys/class/hwmon/*/pwm*
   
   # Test manual PWM control
   echo 128 | sudo tee /sys/class/hwmon/hwmon3/pwm1
   
   # Check agent fan discovery
   ./pankha-agent.sh logs | grep "fan"
   ```

## Production Testing Checklist

Before full deployment:

- [ ] Real agent connects and maintains WebSocket connection
- [ ] All hardware sensors detected and reporting
- [ ] Fan control commands work on actual hardware
- [ ] Temperature thresholds respected
- [ ] WebSocket reconnection after network interruptions
- [ ] Database stores real sensor data correctly
- [ ] Frontend displays live hardware data
- [ ] Emergency stop functions on real hardware
- [ ] Agent survives system reboots (if configured as service)
- [ ] Performance targets met under continuous operation

## Hardware-Specific Testing

### AMD Ryzen 9 3900X System (192.168.100.199)
- **CPU Sensors**: k10temp (Tctl, Tccd1, Tccd2)
- **Chipset**: it8628 motherboard sensors
- **NVMe**: Temperature monitoring
- **Fans**: 5x PWM-controlled fans
- **Thermal Zones**: ACPI thermal management

### Expected Hardware Discovery
- **25+ Temperature Sensors**: Various chips and thermal zones
- **5 PWM Fans**: Full speed control (0-100%)
- **Real RPM Monitoring**: Actual fan speed feedback
- **Hardware Limits**: Real temperature and fan safety thresholds

---

**Note**: This testing approach uses real hardware systems, providing authentic performance characteristics and actual hardware response validation. All testing is done with production Linux client agents communicating via WebSocket protocol.
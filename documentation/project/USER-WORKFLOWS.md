# User Interaction Workflows

## Overview

This document describes how users interact with the Pankha system through the web frontend to monitor and control cooling across multiple systems. It covers common workflows, user interface components, and step-by-step procedures for typical tasks.

## User Interface Components

### 1. **System Dashboard**
- **Purpose**: Overview of all connected systems
- **Location**: Home page (http://192.168.100.237:3000)
- **Features**:
  - Live system status indicators
  - Temperature and fan speed summaries
  - System health alerts
  - Quick access to individual system controls

### 2. **System Detail View**
- **Purpose**: Detailed monitoring of individual systems
- **Access**: Click on system card from dashboard
- **Features**:
  - Real-time temperature graphs
  - Individual fan controls
  - Sensor status indicators
  - Manual fan speed adjustment

### 3. **Fan Profile Manager**
- **Purpose**: Create and manage fan speed profiles
- **Access**: Navigation menu → Fan Profiles
- **Features**:
  - Fan curve editor with graphical interface
  - Profile templates (Silent, Balanced, Performance)
  - Profile assignment to systems
  - Temperature-based automatic control

### 4. **Emergency Controls**
- **Purpose**: System safety and emergency override
- **Access**: Emergency button (always visible)
- **Features**:
  - Global emergency stop
  - Override all fan controls
  - System alerts and notifications

## Common User Workflows

### Workflow 1: Monitor System Status

**Scenario**: User wants to check overall system health and temperatures

```
User Access → Dashboard → System Overview → Individual System Details
```

**Steps:**
1. **Open Pankha Dashboard**
   - Navigate to http://192.168.100.237:3000
   - Dashboard loads showing all connected systems

2. **Review System Overview**
   - Check system status indicators:
     - 🟢 Green: System healthy, temperatures normal
     - 🟡 Yellow: Warning, elevated temperatures
     - 🔴 Red: Critical, immediate attention needed
   - View summary statistics:
     - Total systems online/offline
     - Average temperatures across all systems
     - Highest temperature reading

3. **Examine Individual Systems**
   - Click on system card for detailed view
   - Review real-time data:
     - Current temperatures for all sensors
     - Fan speeds and RPM readings
     - System uptime and last data received

**Visual Flow:**
```
┌─────────────────────┐    ┌─────────────────────┐    ┌─────────────────────┐
│    Dashboard        │    │   System Card       │    │  System Details     │
│                     │    │                     │    │                     │
│ ┌─────────────────┐ │    │ Mock-System-01      │    │ ┌─────────────────┐ │
│ │ Systems: 3      │ │ ─→ │ Status: 🟢 Online   │ ─→ │ │ CPU: 45.2°C     │ │
│ │ Online: 3       │ │    │ Temp: 42.1°C       │    │ │ GPU: 42.1°C     │ │
│ │ Avg Temp: 41°C  │ │    │ Fans: 3 Active     │    │ │ CPU Fan: 850rpm │ │
│ └─────────────────┘ │    │                     │    │ └─────────────────┘ │
└─────────────────────┘    └─────────────────────┘    └─────────────────────┘
```

### Workflow 2: Adjust Fan Speeds Manually

**Scenario**: User notices high temperatures and wants to increase fan speeds immediately

```
User → System Details → Fan Controls → Speed Adjustment → Apply Changes
```

**Steps:**
1. **Navigate to System**
   - From dashboard, click on system showing high temperatures
   - Open system detail view

2. **Access Fan Controls**
   - Scroll to fan control section
   - View current fan speeds and RPM readings

3. **Adjust Fan Speed**
   - Use slider controls to adjust individual fans:
     - CPU Fan: Drag slider from 35% to 60%
     - Case Fans: Increase from 30% to 50%
   - Changes apply in real-time

4. **Monitor Results**
   - Watch temperature readings update (may take 1-2 minutes)
   - Verify fan RPM increases accordingly
   - Check system status changes from warning to normal

**Interface Example:**
```
┌─────────────────────────────────────────────────────────────┐
│                    System: Mock-System-01                   │
├─────────────────────────────────────────────────────────────┤
│ Temperatures:                                               │
│ CPU: 48.5°C  [████████████████████████████████████████]     │
│ GPU: 45.2°C  [█████████████████████████████████████████]    │
│                                                             │
│ Fan Controls:                                               │
│ CPU Fan:     [●────────────────────────────] 60%  (1250rpm) │
│ Case Fan 1:  [●──────────────────────] 50%        (680rpm)  │
│ Case Fan 2:  [●──────────────────────] 50%        (675rpm)  │
│                                                             │
│ [Apply Changes] [Reset to Profile] [Emergency Stop]         │
└─────────────────────────────────────────────────────────────┘
```

### Workflow 3: Create and Apply Fan Profile

**Scenario**: User wants to create a custom fan curve for quiet operation during normal use

```
User → Fan Profiles → Create New → Define Curve → Save → Apply to System
```

**Steps:**
1. **Access Fan Profile Manager**
   - Navigate to Fan Profiles section
   - View existing profiles (Silent, Balanced, Performance)

2. **Create New Profile**
   - Click "Create New Profile"
   - Enter profile details:
     - Name: "Quiet Office"
     - Description: "Low noise for office work"
     - System compatibility: Select target systems

3. **Define Fan Curve**
   - Use graphical editor to set temperature/speed points:
     - 30°C → 20% fan speed (minimum for safety)
     - 45°C → 30% fan speed
     - 60°C → 50% fan speed
     - 75°C → 80% fan speed
     - 85°C → 100% fan speed (emergency)

4. **Save and Apply Profile**
   - Save profile to database
   - Apply to selected systems immediately
   - Monitor system response to new curve

**Fan Curve Editor:**
```
Fan Speed (%)
     100 ┤                                                    ●
         │                                                ╭───╯
      80 ┤                                           ╭────╯
         │                                      ╭────╯
      60 ┤                                 ╭────╯
         │                            ╭────╯
      40 ┤                       ╭────╯
         │                  ╭────╯
      20 ┤             ╭────╯
         │        ╭────╯
       0 └────────┴────┴────┴────┴────┴────┴────┴────┴────┴
         30   35   40   45   50   55   60   65   70   75   80
                              Temperature (°C)

Profile: Quiet Office
● Drag points to adjust curve
[Save Profile] [Test on System] [Cancel]
```

### Workflow 4: Respond to Temperature Alert

**Scenario**: System triggers high temperature alert, user needs to take immediate action

```
Alert Notification → Dashboard → Identify Problem → Emergency Response → Monitor Resolution
```

**Steps:**
1. **Receive Alert**
   - Browser notification or dashboard alert appears
   - Alert shows: "System Mock-System-01: CPU temperature 87°C (Critical)"

2. **Assess Situation**
   - Click on alert to go to affected system
   - Review temperature trends and current readings
   - Check fan status and operation

3. **Take Emergency Action**
   - **Option A - Immediate**: Click "Emergency Stop" to maximize all fans
   - **Option B - Controlled**: Manually increase fan speeds to 100%
   - **Option C - Profile**: Apply "Performance" profile for aggressive cooling

4. **Monitor Resolution**
   - Watch temperature readings decrease
   - Verify all fans are operating at increased speeds
   - Wait for system to return to safe operating temperatures
   - Document incident if recurring issue

**Alert Interface:**
```
┌─────────────────────────────────────────────────────────────┐
│ 🚨 CRITICAL TEMPERATURE ALERT                              │
├─────────────────────────────────────────────────────────────┤
│ System: Mock-System-01                                      │
│ Sensor: CPU Temperature                                     │
│ Current: 87°C (Critical threshold: 85°C)                   │
│ Time: 2025-08-04 15:30:22                                  │
│                                                             │
│ Recommended Actions:                                        │
│ [🚨 Emergency Stop] [⚡ Max Fans] [📊 Performance Profile]  │
│                                                             │
│ [Acknowledge Alert] [View System Details]                  │
└─────────────────────────────────────────────────────────────┘
```

### Workflow 5: Schedule Automated Profiles

**Scenario**: User wants different cooling profiles for day/night or workload-based scenarios

```
User → Profile Scheduler → Create Rules → Set Conditions → Save Automation
```

**Steps:**
1. **Access Profile Scheduler**
   - Navigate to Advanced Settings → Profile Automation
   - View existing scheduled profiles

2. **Create Automation Rule**
   - Rule Name: "Night Quiet Mode"
   - Trigger Conditions:
     - Time: 10:00 PM - 7:00 AM
     - Temperature: Below 50°C
     - System Load: Below 30%

3. **Define Actions**
   - Apply Profile: "Silent"
   - Target Systems: All office workstations
   - Override Duration: Until next scheduled change

4. **Set Fallback Rules**
   - If temperature exceeds 60°C: Switch to "Balanced"
   - If temperature exceeds 75°C: Switch to "Performance"
   - Emergency override: Always available

**Automation Interface:**
```
┌─────────────────────────────────────────────────────────────┐
│                 Profile Automation Rules                    │
├─────────────────────────────────────────────────────────────┤
│ Rule: Night Quiet Mode                     [Edit] [Delete]  │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Triggers:                                               │ │
│ │ • Time: 22:00 - 07:00 daily                            │ │
│ │ • Max Temperature: < 50°C                               │ │
│ │ • System Load: < 30%                                    │ │
│ │                                                         │ │
│ │ Actions:                                                │ │
│ │ • Apply Profile: "Silent"                               │ │
│ │ • Target: All Systems                                   │ │
│ │                                                         │ │
│ │ Fallbacks:                                              │ │
│ │ • > 60°C: Switch to "Balanced"                          │ │
│ │ • > 75°C: Switch to "Performance"                       │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ [Create New Rule] [Import Rules] [Export Rules]            │
└─────────────────────────────────────────────────────────────┘
```

## Advanced User Features

### Multi-System Management

**Bulk Operations:**
- Apply profile to multiple systems simultaneously
- Group systems by location or type
- Bulk emergency stop for entire server racks

**System Groups:**
```
Office Workstations (3 systems)
├── Workstation-01 (Online)
├── Workstation-02 (Online)  
└── Workstation-03 (Offline)

Server Room (5 systems)
├── Server-01 (Online)
├── Server-02 (Online)
├── Server-03 (Warning)
├── Server-04 (Online)
└── Server-05 (Critical)

Actions: [Apply Profile] [Emergency Stop] [Export Data]
```

### Historical Data Analysis

**Performance Monitoring:**
- Temperature trends over time
- Fan efficiency analysis
- System performance correlation
- Energy usage optimization

**Data Export:**
- CSV export for external analysis
- API access for automation
- Real-time data streaming

### User Permissions

**Role-Based Access:**
- **Admin**: Full system control, profile management
- **Operator**: Monitor systems, apply existing profiles
- **Viewer**: Read-only access to dashboards

**System-Level Permissions:**
- Restrict access to specific systems
- Emergency override capabilities
- Audit logging for all actions

## Mobile Responsiveness

### Mobile Interface Adaptations

**Dashboard View:**
- Simplified system cards
- Swipe navigation between systems
- Touch-friendly controls

**Emergency Access:**
- Large emergency stop button
- Quick profile switching
- Push notifications for alerts

## Troubleshooting User Issues

### Common User Problems

**1. Frontend Not Loading or Showing Old Data**
- **Symptom**: Dashboard shows old information or fails to load after system updates
- **Cause**: Browser cache serving outdated JavaScript/CSS files
- **Solution**: 
  - Hard refresh: Press `Ctrl+Shift+R` (Windows/Linux) or `Cmd+Shift+R` (Mac)
  - Alternative: Open new incognito/private browser tab
  - Check browser console for new asset filenames (e.g., `index-[hash].js`)

**2. System Not Responding**
- Check system connection status
- Verify agent is running on target machine
- Test network connectivity

**2. Fan Control Not Working**
- Verify hardware compatibility
- Check agent permissions
- Test manual fan control

**3. Temperature Readings Incorrect**
- Validate sensor configuration
- Check sensor calibration
- Compare with hardware monitoring tools

**4. Profile Not Applying**
- Verify profile compatibility with system
- Check for conflicting manual overrides
- Review agent logs for errors

### User Support Features

**Built-in Help:**
- Contextual help tooltips
- Step-by-step wizards
- Video tutorials (planned)

**Diagnostic Tools:**
- System connectivity test
- Hardware validation
- Configuration checker

**Support Information:**
- System logs download
- Configuration export
- Contact information for technical support

---

*This workflow documentation enables users to effectively monitor and control their cooling systems through the Pankha web interface, from basic monitoring to advanced automation scenarios.*
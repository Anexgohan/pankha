# Task 03: Dashboard Features and User Experience Enhancements

## Overview

Enhance the Pankha dashboard with user-configurable features that improve performance, usability, and user control over the monitoring experience. Focus on separating data collection frequency from data display frequency and adding essential dashboard customization options.

## Primary Feature: Configurable Data Refresh Rates

### Problem Statement
Currently, the frontend dashboard displays data as soon as it receives it from agents (every 500ms). This approach:
- Cannot be customized by users based on their needs
- May cause performance issues on slower devices
- Drains battery on mobile devices unnecessarily
- Provides no user control over visual update frequency
- Creates unnecessary visual noise for long-term monitoring

### Solution: Dashboard Refresh Rate Settings

Implement user-configurable refresh rates that are **independent** of agent data transmission frequency.

**Architecture Separation:**
- **Data Collection Layer**: Agents send data every 500ms → Backend stores latest data
- **Data Display Layer**: Frontend polls/subscribes at user-configurable intervals
- **User Control**: Dashboard settings allow customization of display refresh rate

## Feature Specifications

### A. Refresh Rate Options

**Preset Options:**
- **Real-time**: 500ms (matches agent frequency)
- **Fast**: 1 second  
- **Normal**: 3 seconds (default)
- **Balanced**: 5 seconds
- **Slow**: 10 seconds
- **Manual**: Updates only when user clicks refresh button
- **Paused**: No automatic updates (for detailed analysis)

**Custom Option:**
- User-defined interval (1-60 seconds)
- Input validation and reasonable limits

### B. Settings Interface Design

**Location Options:**
1. **Settings Panel/Modal**: Dedicated settings page with all dashboard preferences
2. **Header Controls**: Quick access refresh rate dropdown in main header
3. **System Card Controls**: Per-system refresh rate settings
4. **Global + Local**: Global default with per-view overrides

**Recommended Approach**: Global setting with quick access controls

**UI Components:**
```
Dashboard Settings Panel:
┌─────────────────────────────────────────────┐
│ 🎛️  Dashboard Settings                      │
├─────────────────────────────────────────────┤
│                                             │
│ Data Refresh Rate:                          │
│ ○ Real-time (500ms)    ○ Fast (1s)         │ 
│ ● Normal (3s)          ○ Balanced (5s)     │
│ ○ Slow (10s)           ○ Manual            │
│ ○ Custom: [___] seconds                    │
│                                             │
│ ☐ Show refresh indicator                   │
│ ☐ Pause updates when tab inactive          │
│                                             │
│ [Save Settings] [Reset to Defaults]        │
└─────────────────────────────────────────────┘
```

### C. Technical Implementation

#### Frontend Architecture Integration Points

**1. State Management (React Context/Redux)**
```typescript
// contexts/DashboardSettingsContext.tsx
interface DashboardSettings {
  refreshRate: number; // milliseconds
  isPaused: boolean;
  showRefreshIndicator: boolean;
  pauseOnInactive: boolean;
}

const defaultSettings: DashboardSettings = {
  refreshRate: 3000, // 3 seconds default
  isPaused: false,
  showRefreshIndicator: true,
  pauseOnInactive: true
};
```

**2. Data Fetching Layer Modifications**
```typescript
// services/api.ts - Enhanced polling logic
export class PankhaApiClient {
  private refreshRate: number = 3000;
  private refreshTimer?: NodeJS.Timeout;
  
  setRefreshRate(rate: number) {
    this.refreshRate = rate;
    this.restartPolling();
  }
  
  private startPolling() {
    this.refreshTimer = setInterval(() => {
      this.fetchLatestData();
    }, this.refreshRate);
  }
}
```

**3. WebSocket Integration**
```typescript
// services/websocket.ts - Configurable subscription rate
export class WebSocketClient {
  private subscriptionRate: number = 3000;
  
  // Option 1: Client-side throttling
  private throttleUpdates(data: SystemData) {
    // Buffer and emit at configured rate
  }
  
  // Option 2: Server-side subscription rate
  setSubscriptionRate(rate: number) {
    this.send({
      type: 'configure',
      refreshRate: rate
    });
  }
}
```

**4. Component Integration Points**
- **Dashboard.tsx**: Main dashboard component with settings integration
- **SystemCard.tsx**: Individual system cards respecting refresh rate
- **HeaderControls.tsx**: Quick refresh rate controls
- **SettingsModal.tsx**: Full settings panel

### D. Performance Optimizations

**Tab Visibility Optimization:**
```typescript
// Pause updates when tab is inactive
const useVisibilityAwareUpdates = () => {
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden && settings.pauseOnInactive) {
        pauseUpdates();
      } else {
        resumeUpdates();
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);
};
```

## Implementation Plan

### Phase 1: Core Infrastructure (2-3 days)
- [ ] Create DashboardSettingsContext with TypeScript interfaces
- [ ] Implement settings persistence (localStorage + backend sync)
- [ ] Create configurable polling mechanism in API client
- [ ] Add settings modal/panel UI component
- [ ] Basic refresh rate selection (preset options only)

### Phase 2: Advanced Features (2-3 days)
- [ ] Add custom refresh rate input with validation
- [ ] Implement battery-aware refresh rate adjustment
- [ ] Add tab visibility detection and pause/resume logic
- [ ] Create refresh indicator component
- [ ] Add per-component refresh rate overrides

### Phase 3: UX Polish (1-2 days)
- [ ] Add smooth transitions between refresh rates
- [ ] Implement loading states and refresh indicators
- [ ] Add tooltips and help text for settings
- [ ] Create preset templates for different use cases
- [ ] Add accessibility features for settings

### Phase 4: Testing & Optimization (1-2 days)
- [ ] Performance testing with different refresh rates
- [ ] Battery usage testing on mobile devices
- [ ] Memory leak detection with long-running sessions
- [ ] Cross-browser compatibility testing
- [ ] User acceptance testing

## Technical Architecture Details

### Settings Storage Strategy
```typescript
// Multi-tier settings storage
interface SettingsStorage {
  // 1. Runtime state (React Context)
  runtime: DashboardSettings;
  
  // 2. Browser persistence (localStorage)
  local: StoredSettings;
  
  // 3. User profile (backend database)
  profile?: UserDashboardPreferences;
}

// Fallback hierarchy: profile -> local -> defaults
```

### Data Flow Architecture
```
Agent (500ms) → Backend → WebSocket/API
                    ↓
              Latest Data Storage
                    ↓
Frontend Polling (User Config Rate) → UI Update
```

### Component Hierarchy
```
App
├── DashboardSettingsProvider
├── Header
│   ├── RefreshRateSelector (quick access)
│   └── SettingsButton
├── Dashboard
│   ├── SystemGrid (respects global refresh rate)
│   └── OverviewStats (respects global refresh rate)
└── SettingsModal
    ├── RefreshRateSection
    ├── PerformanceSection
    └── NotificationSection
```

## User Experience Considerations

### Use Cases
1. **Developer/Monitoring**: Real-time (500ms-1s) for immediate feedback
2. **General Use**: Normal (3-5s) for balanced performance and responsiveness  
3. **Long-term Monitoring**: Slow (10s+) for trending analysis
4. **Mobile Users**: Balanced (5s+) with battery-aware adjustments
5. **Presentation Mode**: Manual refresh for stable displays
6. **Troubleshooting**: Real-time for immediate issue diagnosis

### Accessibility
- Keyboard navigation for all settings
- Screen reader compatibility
- High contrast mode support
- Reduced motion options for sensitive users
- Clear labeling and help text

### Mobile Considerations
- Touch-friendly controls
- Battery usage optimization
- Network-aware refresh rates
- Portrait/landscape adaptations

## Success Metrics

### Performance Metrics
- **Memory Usage**: <50MB JavaScript heap regardless of refresh rate
- **CPU Usage**: <5% CPU usage on mobile devices
- **Battery Impact**: <10% additional battery drain on slowest refresh rate
- **Network Traffic**: Linear scaling with refresh rate selection

### User Experience Metrics
- **Settings Discoverability**: >80% of users find refresh rate settings
- **Default Appropriateness**: <20% of users change from 3s default
- **Performance Satisfaction**: >90% report improved performance on slower devices
- **Mobile Usability**: >85% mobile users report good battery life

## Future Enhancements

### Advanced Features
- **Adaptive Refresh Rates**: AI-driven adjustment based on data volatility
- **Conditional Updates**: Only update when values change significantly
- **Group Refresh Controls**: Different rates for different system groups
- **Time-based Profiles**: Automatic refresh rate changes based on time of day
- **Network-aware Settings**: Adjust refresh rates based on connection quality

### Integration Features
- **Notification-driven Updates**: Immediate updates for alerts/emergencies
- **Focus-driven Refresh**: Higher rates for actively viewed components
- **Historical Playback**: Time-lapse view of historical data
- **Export Controls**: Different refresh rates for data export scenarios

## Risk Mitigation

### Technical Risks
- **Memory Leaks**: Comprehensive testing with long-running sessions
- **State Synchronization**: Careful management of settings across components
- **Performance Regression**: Baseline testing and monitoring

### User Experience Risks
- **Settings Complexity**: Progressive disclosure and sensible defaults
- **Performance Confusion**: Clear explanation of refresh rate impact
- **Mobile Battery Drain**: Conservative defaults and clear battery impact indicators

## Detailed Implementation Plan Based on Current Architecture

### Current Frontend Architecture Analysis

Based on examination of the existing codebase:

**Key Files Identified:**
- `App.tsx` - Main app with ThemeProvider
- `Dashboard.tsx` - **PRIMARY TARGET** - Contains hardcoded `setInterval(refreshData, 3000)`
- `services/api.ts` - API client functions
- `contexts/ThemeContext.tsx` - **PATTERN TO FOLLOW** for settings context
- `components/ThemeToggle.tsx` - Settings control pattern

**Critical Finding**: Dashboard.tsx line 52-57 contains the hardcoded 3-second refresh:
```typescript
const refreshInterval = setInterval(() => {
  refreshData(false);
  setLastUpdate(new Date());
}, 3000); // 3 seconds polling - THIS NEEDS TO BE CONFIGURABLE
```

### Specific Implementation Locations

#### 1. Create DashboardSettingsContext (NEW FILE)
**Location**: `/frontend/src/contexts/DashboardSettingsContext.tsx`  
**Pattern**: Follow ThemeContext.tsx structure exactly
```typescript
// Similar to ThemeContext but for dashboard settings
interface DashboardSettingsContextType {
  refreshRate: number;
  setRefreshRate: (rate: number) => void;
  isPaused: boolean;
  setPaused: (paused: boolean) => void;
  // ... other settings
}
```

#### 2. Modify App.tsx (MODIFICATION)
**Location**: `/frontend/src/App.tsx`  
**Change**: Add DashboardSettingsProvider wrapper
```typescript
// Add new provider alongside ThemeProvider
<ThemeProvider>
  <DashboardSettingsProvider>
    <div className="App">
      <Dashboard />
    </div>
  </DashboardSettingsProvider>
</ThemeProvider>
```

#### 3. Modify Dashboard.tsx (CRITICAL CHANGES)
**Location**: `/frontend/src/components/Dashboard.tsx`  
**Specific Lines to Change**:
- **Line 1**: Add `import { useDashboardSettings } from '../contexts/DashboardSettingsContext';`
- **Line 52-57**: Replace hardcoded `3000` with `refreshRate` from context
- **Line 106-126**: Add refresh rate selector in header-controls section

**Modified polling logic**:
```typescript
const { refreshRate, isPaused } = useDashboardSettings();

useEffect(() => {
  // ... existing code ...
  
  const refreshInterval = setInterval(() => {
    if (!isPaused) {
      refreshData(false);
      setLastUpdate(new Date());
    }
  }, refreshRate); // NOW CONFIGURABLE!
  
  return () => clearInterval(refreshInterval);
}, [refreshData, refreshRate, isPaused]); // Add dependencies
```

#### 4. Create RefreshRateSelector Component (NEW FILE)
**Location**: `/frontend/src/components/RefreshRateSelector.tsx`  
**Pattern**: Follow ThemeToggle.tsx button style
**Integration**: Add to Dashboard.tsx header-controls section (line 106-126)

#### 5. Enhance API Service (OPTIONAL OPTIMIZATION)
**Location**: `/frontend/src/services/api.ts`  
**Addition**: Client-side caching to avoid redundant API calls when refresh rate is very fast

#### 6. Add Settings Modal (FUTURE ENHANCEMENT)
**Location**: `/frontend/src/components/SettingsModal.tsx`  
**Trigger**: Settings button in header next to ThemeToggle

### Integration Points in Existing Code

#### Dashboard.tsx Header Controls Section (Lines 106-126)
**Current Structure**:
```typescript
<div className="header-controls">
  <div className="connection-status">...</div>
  <ThemeToggle />
  <button onClick={() => refreshData(false)}>🔄 Refresh</button>
  <button onClick={handleEmergencyStop}>🚨 Emergency Stop</button>
</div>
```

**Enhanced Structure**:
```typescript
<div className="header-controls">
  <div className="connection-status">...</div>
  <RefreshRateSelector /> {/* NEW COMPONENT */}
  <ThemeToggle />
  <button onClick={() => refreshData(false)}>🔄 Refresh</button>
  <button onClick={handleEmergencyStop}>🚨 Emergency Stop</button>
</div>
```

### File Creation Checklist

**New Files to Create**:
- [ ] `/frontend/src/contexts/DashboardSettingsContext.tsx`
- [ ] `/frontend/src/components/RefreshRateSelector.tsx`
- [ ] `/frontend/src/components/SettingsModal.tsx` (optional)
- [ ] `/frontend/src/hooks/useBatteryAware.ts` (optional)
- [ ] `/frontend/src/types/settings.ts` (TypeScript definitions)

**Existing Files to Modify**:
- [ ] `/frontend/src/App.tsx` (add provider)
- [ ] `/frontend/src/components/Dashboard.tsx` (replace hardcoded interval)
- [ ] `/frontend/src/services/api.ts` (optional caching)

### CSS Styling Integration

**Follow Existing Patterns**:
- Use same button styles as ThemeToggle
- Integrate with existing `header-controls` flexbox layout
- Follow dark/light theme CSS custom properties
- Match existing `dashboard-header` styling

### Backward Compatibility

**Default Behavior**: 3-second refresh (matches current hardcoded value)
**Settings Persistence**: localStorage (following ThemeContext pattern)
**Graceful Degradation**: If context fails, fall back to 3-second default

### Testing Integration Points

**Component Testing**:
- Test Dashboard.tsx with different refresh rates
- Test RefreshRateSelector UI interactions
- Test context provider state management

**Integration Testing**:
- Test refresh rate changes during active polling
- Test pause/resume functionality
- Test localStorage persistence

### Performance Impact Assessment

**Memory**: Minimal increase (one additional context)
**CPU**: Configurable (user can reduce if needed)
**Bundle Size**: ~5-10KB additional code
**Runtime Impact**: None when using default 3s rate

---

**Priority**: High  
**Estimated Effort**: 6-10 development days  
**Dependencies**: Existing dashboard components, WebSocket infrastructure  
**Target Release**: Next minor version after Task 02 completion

## Quick Implementation Summary

**Phase 1 (Minimal Viable Feature - 2 days)**:
1. Create `DashboardSettingsContext.tsx` (copy ThemeContext pattern)
2. Add provider to `App.tsx`
3. Replace hardcoded `3000` in `Dashboard.tsx` with context value
4. Create basic `RefreshRateSelector.tsx` dropdown
5. Add selector to Dashboard header

**Phase 2 (Enhanced Features - 3-4 days)**:
6. Add pause/resume functionality
7. Add battery-aware settings
8. Add full SettingsModal
9. Add advanced performance optimizations

This approach leverages the existing architecture patterns and requires minimal changes to achieve the core functionality.
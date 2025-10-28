import React, { useState, useEffect, useCallback } from 'react';
import type { SystemData, SystemOverview } from '../types/api';
import { getSystems, getOverview, emergencyStop } from '../services/api';
import SystemCard from './SystemCard';
import OverviewStats from './OverviewStats';
import ThemeToggle from './ThemeToggle';
import RefreshRateSelector from './RefreshRateSelector';
import ControllerIntervalSelector from './ControllerIntervalSelector';
import FanProfileManager from './FanProfileManager';
import { useDashboardSettings } from '../contexts/DashboardSettingsContext';

type TabType = 'systems' | 'profiles';

const Dashboard: React.FC = () => {
  const { refreshRate, isPaused } = useDashboardSettings();
  const [activeTab, setActiveTab] = useState<TabType>('systems');
  const [systems, setSystems] = useState<SystemData[]>([]);
  const [overview, setOverview] = useState<SystemOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  // Persistent dropdown states across re-renders
  const [expandedSensors, setExpandedSensors] = useState<{[systemId: number]: boolean}>({});
  const [expandedFans, setExpandedFans] = useState<{[systemId: number]: boolean}>({});

  // Auto-refresh data every 3 seconds  
  const refreshData = useCallback(async (isInitialLoad = false) => {
    try {
      // Only show loading spinner during initial load, not auto-refresh
      if (isInitialLoad) {
        setLoading(true);
      }
      
      const [systemsData, overviewData] = await Promise.all([
        getSystems(),
        getOverview()
      ]);
      
      setSystems(systemsData);
      setOverview(overviewData);
      setError(null);
      setLastUpdate(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard data');
      console.error('Dashboard refresh error:', err);
    } finally {
      if (isInitialLoad) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    // Initial load with loading spinner
    refreshData(true);

    // Use configurable API polling for real-time updates
    console.log(`🔄 CONFIGURABLE REFRESH: Using API polling every ${refreshRate}ms (paused: ${isPaused})`);
    
    const refreshInterval = setInterval(() => {
      if (!isPaused) {
        console.log('⚡ Auto-refreshing data for real-time updates...');
        // Auto-refresh without loading spinner to preserve dropdown states
        refreshData(false);
        setLastUpdate(new Date());
      }
    }, refreshRate); // Now uses configurable refresh rate!

    return () => {
      clearInterval(refreshInterval);
    };
  }, [refreshData, refreshRate, isPaused]); // Add dependencies for refresh rate and pause state

  const handleEmergencyStop = async () => {
    if (window.confirm('Are you sure you want to trigger emergency stop for ALL systems? This will set all fans to maximum speed.')) {
      try {
        await emergencyStop();
        alert('Emergency stop triggered successfully');
      } catch (err) {
        alert('Emergency stop failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
      }
    }
  };

  // Remove the duplicate refreshData function since we moved it up

  if (loading) {
    return (
      <div className="dashboard loading">
        <div className="loading-spinner">
          <div className="spinner"></div>
          <p>Loading dashboard...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="dashboard error">
        <div className="error-message">
          <h2>Error Loading Dashboard</h2>
          <p>{error}</p>
          <button onClick={() => refreshData(true)} className="retry-button">
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1>Pankha Fan Control</h1>
        <div className="header-controls">
          <div className="connection-status">
            <span className="status-indicator connected">
              🟢 API Polling
            </span>
            <span className="last-update">
              Last update: {lastUpdate.toLocaleTimeString()}
            </span>
          </div>
          <RefreshRateSelector />
          <ControllerIntervalSelector />
          <ThemeToggle />
          <button onClick={() => refreshData(false)} className="refresh-button">
            🔄 Refresh
          </button>
          <button 
            onClick={handleEmergencyStop} 
            className="emergency-button"
            title="Emergency stop all fans"
          >
            🚨 Emergency Stop
          </button>
        </div>
      </header>

      <nav className="dashboard-nav">
        <div className="nav-tabs">
          <button 
            className={`nav-tab ${activeTab === 'systems' ? 'active' : ''}`}
            onClick={() => setActiveTab('systems')}
          >
            🖥️ Systems Monitor
          </button>
          <button 
            className={`nav-tab ${activeTab === 'profiles' ? 'active' : ''}`}
            onClick={() => setActiveTab('profiles')}
          >
            📊 Fan Profiles
          </button>
        </div>
      </nav>

      {overview && activeTab === 'systems' && (
        <OverviewStats overview={overview} />
      )}

      <div className="dashboard-content">
        {activeTab === 'systems' && (
          <div className="systems-grid">
            {systems.length === 0 ? (
              <div className="no-systems">
                <h3>No Systems Found</h3>
                <p>No fan control systems are currently registered.</p>
                <p>Add systems using the API or wait for agents to register automatically.</p>
              </div>
            ) : (
              systems.map(system => (
                <SystemCard 
                  key={system.id} 
                  system={system}
                  onUpdate={() => refreshData(false)}
                  expandedSensors={expandedSensors[system.id] || false}
                  expandedFans={expandedFans[system.id] || false}
                  onToggleSensors={(expanded) => setExpandedSensors(prev => ({...prev, [system.id]: expanded}))}
                  onToggleFans={(expanded) => setExpandedFans(prev => ({...prev, [system.id]: expanded}))}
                />
              ))
            )}
          </div>
        )}

        {activeTab === 'profiles' && (
          <div className="fan-profiles-section">
            <FanProfileManager />
          </div>
        )}
      </div>

      <footer className="dashboard-footer">
        <p>Pankha Fan Control System v1.0.0 | {systems.length} systems monitored</p>
      </footer>
    </div>
  );
};

export default Dashboard;
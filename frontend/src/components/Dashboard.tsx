import React, { useState } from 'react';
import { emergencyStop, getOverview } from '../services/api';
import { toast } from '../utils/toast';
import SystemCard from './SystemCard';
import OverviewStats from './OverviewStats';
import ThemeToggle from './ThemeToggle';
import ControllerIntervalSelector from './ControllerIntervalSelector';
import FanProfileManager from './FanProfileManager';
import Settings from './Settings';
import { useWebSocketData } from '../hooks/useWebSocketData';

type TabType = 'systems' | 'profiles' | 'settings';

const Dashboard: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabType>('systems');
  const [overview, setOverview] = useState<any>(null);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  // Persistent dropdown states across re-renders
  const [expandedSensors, setExpandedSensors] = useState<{[systemId: number]: boolean}>({});
  const [expandedFans, setExpandedFans] = useState<{[systemId: number]: boolean}>({});

  // Pure WebSocket - no HTTP polling!
  const {
    systems,
    connectionState,
    error,
    reconnect,
    removeSystem
  } = useWebSocketData();

  // Fetch overview data separately (could be added to WebSocket later)
  React.useEffect(() => {
    const fetchOverview = async () => {
      try {
        const data = await getOverview();
        setOverview(data);
      } catch (err) {
        console.error('Failed to fetch overview:', err);
      }
    };
    fetchOverview();
    const interval = setInterval(fetchOverview, 10000); // Every 10 seconds
    return () => clearInterval(interval);
  }, []);

  // Fetch latest version from GitHub API
  React.useEffect(() => {
    const fetchLatestVersion = async () => {
      try {
        const response = await fetch('https://api.github.com/repos/Anexgohan/pankha/releases/latest');
        if (response.ok) {
          const data = await response.json();
          setLatestVersion(data.tag_name);
        }
      } catch (err) {
        console.error('Failed to fetch latest version:', err);
      }
    };
    fetchLatestVersion();
    // Re-fetch every 10 minutes
    const interval = setInterval(fetchLatestVersion, 600000);
    return () => clearInterval(interval);
  }, []);

  // Handle updates from SystemCard (no-op with WebSocket - updates come automatically)
  const handleUpdate = () => {
    // With WebSocket, updates come automatically via delta updates
    // This is kept for compatibility but does nothing
    console.log('Update requested - WebSocket will handle automatically');
  };

  const handleEmergencyStop = async () => {
    if (window.confirm('Are you sure you want to trigger emergency stop for ALL systems? This will set all fans to maximum speed.')) {
      try {
        await emergencyStop();
        toast.success('Emergency stop triggered successfully');
      } catch (err) {
        toast.error('Emergency stop failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
      }
    }
  };

  // Show loading only when connecting for the first time
  if (connectionState === 'connecting' && systems.length === 0) {
    return (
      <div className="dashboard loading">
        <div className="loading-spinner">
          <div className="spinner"></div>
          <p>Connecting to server...</p>
        </div>
      </div>
    );
  }

  if (error && systems.length === 0) {
    return (
      <div className="dashboard error">
        <div className="error-message">
          <h2>Connection Error</h2>
          <p>{error}</p>
          <button onClick={reconnect} className="retry-button">
            Reconnect
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
          {/* Connection Status Indicator */}
          <div className={`connection-status status-${connectionState}`}>
            {connectionState === 'connected' && (
              <>
                <span className="status-indicator connected">
                  🟢 Live
                </span>
                <span className="last-update">Real-time</span>
              </>
            )}
            {connectionState === 'connecting' && (
              <>
                <span className="status-indicator connecting">
                  🟡 Connecting...
                </span>
                <span className="last-update">Please wait</span>
              </>
            )}
            {connectionState === 'disconnected' && (
              <>
                <span className="status-indicator disconnected">
                  🔴 Disconnected
                </span>
                <button onClick={reconnect} className="reconnect-btn">
                  Reconnect
                </button>
              </>
            )}
            {connectionState === 'error' && (
              <>
                <span className="status-indicator error">
                  ⚠️ Error
                </span>
                <button onClick={reconnect} className="reconnect-btn">
                  Retry
                </button>
              </>
            )}
          </div>

          <ControllerIntervalSelector />
          <ThemeToggle />

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
          <button 
            className={`nav-tab ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
          >
            ⚙️ Settings
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
                  onUpdate={handleUpdate}
                  onRemove={() => removeSystem(system.id)}
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

        {activeTab === 'settings' && (
          <Settings />
        )}
      </div>

      <footer className="dashboard-footer">
        <p>
          Pankha Fan Control | {systems.length} systems monitored |{' '}
          <a
            href={`https://github.com/Anexgohan/pankha/releases/tag/${__APP_VERSION__}`}
            target="_blank"
            rel="noopener noreferrer"
            className="version-link"
          >
            Current: {__APP_VERSION__}
          </a>
          {latestVersion && (
            <>
              {' | '}
              <a
                href={`https://github.com/Anexgohan/pankha/releases/tag/${latestVersion}`}
                target="_blank"
                rel="noopener noreferrer"
                className="version-link"
              >
                Latest: {latestVersion}
              </a>
            </>
          )}
          {' |'}
        </p>
      </footer>
    </div>
  );
};

export default Dashboard;
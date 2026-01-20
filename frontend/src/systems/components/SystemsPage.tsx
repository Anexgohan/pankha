import React, { useState } from 'react';
import { emergencyStop, getOverview } from '../../services/api';
import { toast } from '../../utils/toast';
import SystemCard from './SystemCard';
import OverviewStats from './OverviewStats';
import ThemeToggle from '../../components/ThemeToggle';
import ControllerIntervalSelector from '../../components/ControllerIntervalSelector';
import FanProfileManager from '../../fan-profiles/components/FanProfileManager';
import Settings from '../../settings/components/Settings';
import { useWebSocketData } from '../../hooks/useWebSocketData';
import HeaderFan from '../../components/HeaderFan';
import { 
  Loader2, 
  Unplug, 
  CircleAlert, 
  ShieldAlert, 
  Monitor, 
  Wind, 
  Settings2,
  ChevronRight,
  Command
} from 'lucide-react';
import DeploymentPage from '../../deployment/components/DeploymentPage';

type TabType = 'systems' | 'profiles' | 'deployment' | 'settings';

const SystemsPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabType>('systems');
  const [overview, setOverview] = useState<any>(null);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [unstableVersion, setUnstableVersion] = useState<string | null>(null);
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

  // Fetch versions from GitHub API
  React.useEffect(() => {
    const fetchVersions = async () => {
      try {
        const response = await fetch('https://api.github.com/repos/Anexgohan/pankha/releases');
        if (response.ok) {
          const releases = await response.json();
          if (releases.length > 0) {
            // Find latest stable
            const stable = releases.find((r: any) => !r.prerelease);
            if (stable) setLatestVersion(stable.tag_name);

            // Find latest unstable (if it's newer than stable or we have no stable)
            const unstable = releases.find((r: any) => r.prerelease);
            if (unstable && (!stable || new Date(unstable.created_at) > new Date(stable.created_at))) {
              setUnstableVersion(unstable.tag_name);
            } else {
              setUnstableVersion(null);
            }
          }
        }
      } catch (err) {
        console.error('Failed to fetch versions:', err);
      }
    };
    fetchVersions();
    // Re-fetch every 10 minutes
    const interval = setInterval(fetchVersions, 600000);
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
      <div className="dashboard dashboard-full-page-loading">
        <div className="loading-spinner">
          <div className="spinner"></div>
          <p>Connecting to server...</p>
        </div>
      </div>
    );
  }

  if (error && systems.length === 0) {
    return (
      <div className="dashboard dashboard-full-page-error">
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
        <h1>
          Pankha Fan Control <span style={{ fontSize: 'var(--spacing-3xl)', opacity: 1.0, fontWeight: 'bold' }}>( पंखा )</span>
          <HeaderFan />
        </h1>
        <div className="header-controls">
          {/* Connection Status Indicator */}
          <div className={`connection-status status-${connectionState}`}>
            {connectionState === 'connected' && (
              <>
                <span className="connection-status-indicator connected">
                  <svg 
                    width="20" 
                    height="20" 
                    viewBox="0 0 24 24" 
                    fill="none" 
                    stroke="currentColor" 
                    strokeWidth="2" 
                    strokeLinecap="round" 
                    strokeLinejoin="round" 
                    className="status-icon"
                  >
                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
                  </svg> Live
                </span>
                <span className="last-update">Real-time</span>
              </>
            )}
            {connectionState === 'connecting' && (
              <>
                <span className="connection-status-indicator connecting">
                  <Loader2 size={14} className="status-icon animate-spin" /> Connecting...
                </span>
                <span className="last-update">Please wait</span>
              </>
            )}
            {connectionState === 'disconnected' && (
              <>
                <span className="connection-status-indicator disconnected">
                  <Unplug size={14} className="status-icon" /> Disconnected
                </span>
                <button onClick={reconnect} className="reconnect-btn">
                  Reconnect
                </button>
              </>
            )}
            {connectionState === 'error' && (
              <>
                <span className="connection-status-indicator error">
                  <CircleAlert size={14} className="status-icon" /> Error
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
            <ShieldAlert size={18} /> Emergency Stop
          </button>
        </div>
      </header>

      <nav className="dashboard-nav">
        <div className="nav-tabs">
          <button
            className={`nav-tab ${activeTab === 'systems' ? 'active' : ''}`}
            onClick={() => setActiveTab('systems')}
          >
            <Monitor size={16} /> Systems Monitor
          </button>
          <button
            className={`nav-tab ${activeTab === 'profiles' ? 'active' : ''}`}
            onClick={() => setActiveTab('profiles')}
          >
            <Wind size={16} /> Fan Profiles
          </button>
          <button
            className={`nav-tab ${activeTab === 'deployment' ? 'active' : ''}`}
            onClick={() => setActiveTab('deployment')}
          >
            <Command size={16} /> Deployment
          </button>
          <button
            className={`nav-tab ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
          >
            <Settings2 size={16} /> Settings
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
              <div className="no-systems-redirect-card">
                <div className="card-header">
                  <ShieldAlert size={24} className="alert-icon" />
                  <h3>CRITICAL: NO ACTIVE NODES DETECTED</h3>
                </div>
                <div className="card-content">
                  <p>Pankha is currently a ghost ship. To populate this dashboard, you need to deploy the agent to your target machines.</p>
                  <button 
                    className="btn btn-primary redirect-btn"
                    onClick={() => setActiveTab('deployment')}
                  >
                    GO TO DEPLOYMENT TAB <ChevronRight size={16} />
                  </button>
                </div>
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

        {activeTab === 'deployment' && (
          <DeploymentPage 
            latestVersion={latestVersion} 
            unstableVersion={unstableVersion}
          />
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

export default SystemsPage;

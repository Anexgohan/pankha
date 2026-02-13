import React, { useState, useMemo, useEffect } from 'react';
import {
  Download,
  ExternalLink,
  Copy,
  Check,
  Rocket,
  Binary,
  Activity,
  Server,
  Terminal,
  Settings2,
  ShieldAlert,
  ArrowRight,
  Command,
  ChevronDown,
  ChevronRight,
  History,
  FolderDown,
  Link2,
  RotateCcw,
  Trash2
} from 'lucide-react';
import { useWebSocketData } from '../../hooks/useWebSocketData';
import { toast } from '../../utils/toast';
import { uiOptions, getDefault, getOption, interpolateTooltip } from '../../utils/uiOptions';
import { createDeploymentTemplate, selfUpdateAgent, API_BASE_URL, getHubStatus, stageUpdateToHub, clearHubDownloads, getDeploymentHubConfig, type HubStatus, type DeploymentHubConfig } from '../../services/api';
import '../styles/deployment.css';

type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
type Failsafe = '30' | '50' | '100';
type PathMode = 'standard' | 'portable';
type UrlMode = 'internal' | 'external';

interface TerminalBlockProps {
  title: string;
  tool: 'curl' | 'wget';
  copiedType: 'curl' | 'wget' | null;
  command: string;
  onCopy: (tool: 'curl' | 'wget') => void;
  isLoading?: boolean;
}

const TerminalBlock: React.FC<TerminalBlockProps> = ({ title, tool, copiedType, command, onCopy, isLoading }) => (
  <div className="terminal-instance">
    <div className="terminal-instance-header">
      <span className="terminal-title-text">{title}</span>
      <button
        className={`terminal-copy-action ${copiedType === tool ? 'success' : ''}`}
        onClick={() => onCopy(tool)}
        disabled={isLoading || !command}
      >
        {copiedType === tool ? <Check size={14} /> : <Copy size={14} />}
        {copiedType === tool ? 'COPIED' : 'COPY'}
      </button>
    </div>
    <div className="terminal-container">
      <div className="terminal-header">
        <div className="terminal-dots">
          <span className="terminal-dot dot-red" />
          <span className="terminal-dot dot-yellow" />
          <span className="terminal-dot dot-green" />
        </div>
        <div className="terminal-path">~/install-pankha</div>
      </div>
      <div className="terminal-body">
        <span className="command-prompt">#</span>
        <code className="command-line">
          {isLoading ? 'Generating secure token...' : (command || 'Configure settings to generate command')}
        </code>
      </div>
    </div>
  </div>
);

const MetricCard: React.FC<{
  label: string;
  value: string | number;
  icon: React.ReactNode;
  borderLeftColor?: string;
  iconStyle?: React.CSSProperties;
  tooltip?: string;
}> = React.memo(({ label, value, icon, borderLeftColor, iconStyle, tooltip }) => (
  <div className="fleet-metric-card" style={{ borderLeftColor }} title={tooltip}>
    <div className="metric-icon" style={iconStyle}>
      {icon}
    </div>
    <div className="metric-content">
      <span className="metric-value">{value}</span>
      <span className="metric-label">{label}</span>
    </div>
  </div>
));

const InstallerSection: React.FC<{
  latestVersion: string | null;
  unstableVersion: string | null;
  githubRepo: string;
}> = React.memo(({ latestVersion, unstableVersion, githubRepo }) => (
  <section className="deployment-section">
    <h3><Download size={20} /> Official Installers</h3>
    <div className="download-options">
      <div className="installer-card">
        <h4>
          <Binary size={18} /> Windows Agent
          <div className="version-tags-row">
            {latestVersion && <span className="version-tag stable">S {latestVersion}</span>}
            {unstableVersion && <span className="version-tag unstable">U {unstableVersion}</span>}
            {!latestVersion && !unstableVersion && <span className="version-tag">Detecting</span>}
          </div>
        </h4>
        <p>Native Windows service with Tray App. Supports Windows 10/11 x86_64. Self-contained .NET 8.0 execution.</p>
        <div className="card-actions-row">
          <a
            href={`${githubRepo}/releases/latest/download/pankha-agent-windows_x64.msi`}
            className="btn-primary-tactical"
            style={{ flex: 1 }}
            download
          >
            <Download size={16} /> Get Latest Release
          </a>
          <a
            href={`${PANKHA_SITE}/docs/wiki/agents-windows/`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-outline-tactical"
          >
            <Server size={16} /> DOCUMENTATION
          </a>
        </div>
      </div>

      <div className="installer-card">
        <h4>
          <Settings2 size={18} /> Linux Setup
          <div className="version-tags-row">
            <span className="version-tag stable">STABLE</span>
            {unstableVersion && <span className="version-tag unstable">PRE-RELEASE</span>}
          </div>
        </h4>
        <p>Systemd service with Rust-based hardware monitoring. Supports Debian, Ubuntu, Proxmox, and RPI.</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
            <div className="coming-soon-badge">
                <span className="badge-dot" />
                STANDALONE GUI AGENT COMING SOON
            </div>
            <p className="subtitle-note">
                Use script-based installation below for current deployments.
            </p>
        </div>
        <a
          href={`${PANKHA_SITE}/docs/wiki/agents-linux/`}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-outline-tactical"
        >
          <Server size={16} /> DOCUMENTATION
        </a>
      </div>
    </div>
  </section>
));

const GITHUB_REPO = 'https://github.com/Anexgohan/pankha';
const PANKHA_SITE = 'https://pankha.app';

const ActionButton: React.FC<{ githubRepo: string }> = React.memo(({ githubRepo }) => (
  <div className="deployment-action-bar">
    <a
      href={`${githubRepo}/releases`}
      target="_blank"
      rel="noopener noreferrer"
      className="btn-action-full"
    >
      <History size={16} /> VIEW ALL RELEASES & CHANGELOG <ExternalLink size={14} />
    </a>
  </div>
));

const ResourcesSection: React.FC<{ githubRepo: string }> = React.memo(({ githubRepo }) => (
  <section className="deployment-section">
    <h3><Terminal size={20} /> Technical Documentation</h3>
    <div className="resource-grid">
      <a href={`${PANKHA_SITE}/docs/`} target="_blank" rel="noopener noreferrer" className="resource-link">
        <div className="link-label">
          <Server size={18} />
          <span>Wiki: Setup & Configuration</span>
        </div>
        <ArrowRight size={16} className="link-arrow" />
      </a>
      <a href={`${PANKHA_SITE}/docs/wiki/agents-linux/`} target="_blank" rel="noopener noreferrer" className="resource-link">
        <div className="link-label">
          <Settings2 size={18} />
          <span>Linux Service Guide</span>
        </div>
        <ArrowRight size={16} className="link-arrow" />
      </a>
      <a href={`${githubRepo}/issues`} target="_blank" rel="noopener noreferrer" className="resource-link">
        <div className="link-label">
          <ExternalLink size={18} />
          <span>Bug Reports & Issues</span>
        </div>
        <ArrowRight size={16} className="link-arrow" />
      </a>
    </div>
  </section>
));

const MaintenanceSection: React.FC<{
  isExpanded: boolean;
  onToggle: () => void;
  systems: any[];
  stableVersion: string | null;
  unstableVersion: string | null;
  updatingAgents: Set<number>;
  onApplyUpdate: (systemId: number) => void;
  hubStatus: HubStatus | null;
}> = React.memo(({ isExpanded, onToggle, systems, stableVersion, unstableVersion, updatingAgents, onApplyUpdate, hubStatus }) => {
  const outdatedCount = useMemo(() => {
    // Priority: Hub version > Latest Stable
    const hubVer = hubStatus?.version?.replace('v', '');
    const stableVer = stableVersion?.replace('v', '');
    const targetVersion = hubVer || stableVer;
    
    if (!targetVersion) return 0;
    return systems.filter(s => s.agent_version && !s.agent_version.includes(targetVersion)).length;
  }, [systems, stableVersion, hubStatus]);

  return (
    <section className={`deployment-section maintenance-panel ${!isExpanded ? 'collapsed' : ''}`}>
      <div className="maintenance-header-toggle">
        <h3 onClick={onToggle} className="clickable-title">
          <Activity size={20} /> Fleet Maintenance
          {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
          {outdatedCount > 0 && (
            <span className="header-badge pulse">
              {outdatedCount} UPDATE{outdatedCount !== 1 ? 'S' : ''} AVAILABLE
            </span>
          )}
        </h3>

        <span className="maintenance-stats">
          {systems.length} System{systems.length !== 1 ? 's' : ''} Connected
        </span>
      </div>

      {isExpanded && (
        <div className="maintenance-content">
          <div className="maintenance-table-wrapper">
            <table className="maintenance-table">
              <thead>
                <tr>
                  <th>Hostname</th>
                  <th>Agent ID</th>
                  <th>Version</th>
                  <th>Status</th>
                  <th>Maintenance</th>
                </tr>
              </thead>
              <tbody>
                {systems.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: 'var(--spacing-2xl) 0', color: 'var(--text-tertiary)' }}>
                      NO REMOTE NODES DISCOVERED
                    </td>
                  </tr>
                ) : (
                  systems.map(system => {
                    const targetVersion = hubStatus?.version || stableVersion;
                    const cleanTarget = targetVersion ? targetVersion.replace('v', '') : '';
                    const isOutdated = targetVersion && system.agent_version && 
                                      !system.agent_version.includes(cleanTarget);
                    const isUpdating = updatingAgents.has(system.id);
                    const isOnline = system.status === 'online';

                    // Determine status display
                    const statusLabel = isUpdating ? 'UPDATING' : (isOnline ? 'ONLINE' : 'OFFLINE');
                    const statusClass = isUpdating ? 'updating' : (isOnline ? 'online' : 'offline');

                    const isWindows = system.platform === 'windows' || system.agent_id.toLowerCase().startsWith('windows-');
                    const platformIcon = isWindows ? (
                      <div className="platform-icon windows" title="Windows Agent">
                        <img src="/icons/windows_01.svg" alt="Windows" width="14" height="14" />
                      </div>
                    ) : (
                      <div className="platform-icon linux" title="Linux Agent">
                        <img src="/icons/linux_01.svg" alt="Linux" width="14" height="14" />
                      </div>
                    );

                    return (
                      <tr key={system.id}>
                        <td className="hostname-cell">
                          <div className="hostname-wrapper">
                            {platformIcon}
                            <span className="hostname-text">{system.name}</span>
                          </div>
                        </td>
                        <td className="agent-id-cell"><code>{system.agent_id}</code></td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-xs)' }}>
                            <span>v{system.agent_version || '0.0.0'}</span>
                            {isOutdated && !isUpdating && (
                              <span className="update-badge" title={`Update to ${targetVersion} available`}>
                                NEW {targetVersion}
                              </span>
                            )}
                          </div>
                        </td>
                        <td>
                          <span className={`status-tag-v2 ${statusClass}`}>
                            <span className="status-dot" />
                            {statusLabel}
                          </span>
                        </td>
                          <td>
                            {isWindows ? (
                              <a 
                                href={`${GITHUB_REPO}/releases/latest/download/pankha-agent-windows_x64.msi`}
                                className={`btn-table-action windows-download ${isOutdated ? 'update-needed' : ''}`}
                                style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '8px' }}
                                download
                              >
                                <Download size={14} />
                                {isOutdated ? 'Download MSI' : 'Get MSI'}
                              </a>
                            ) : (
                              <span
                                title={
                                  !hubStatus?.version 
                                    ? `Download Stable ${stableVersion || ''} or Unstable ${unstableVersion || ''} to server first` 
                                    : (!isOnline 
                                      ? 'Agent is offline' 
                                      : (isUpdating 
                                        ? 'Update in progress...' 
                                        : (isOutdated 
                                          ? `Click to update agent to ${targetVersion}` 
                                          : `Reinstall agent version ${targetVersion}`)))
                                }
                                style={{ display: 'inline-block' }}
                              >
                                <button
                                  className={`btn-table-action ${isOutdated ? 'update-needed' : ''}`}
                                  onClick={() => onApplyUpdate(system.id)}
                                  disabled={!isOnline || isUpdating || !hubStatus?.version}
                                  style={{ pointerEvents: 'auto' }} // Ensure clicks work when enabled
                                >
                                  {isUpdating ? 'Updating...' : (isOutdated ? 'Update Now' : 'Reinstall')}
                                </button>
                              </span>
                            )}
                          </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
});

export const DeploymentPage: React.FC<{ 
  latestVersion: string | null;
  unstableVersion?: string | null;
}> = ({ latestVersion, unstableVersion }) => {
  const { systems } = useWebSocketData();
  const [logLevel, setLogLevel] = useState<LogLevel>(getDefault('logLevel'));
  const [failsafe, setFailsafe] = useState<Failsafe>(String(getDefault('failsafeSpeed')) as Failsafe);
  const [pathMode, setPathMode] = useState<PathMode>('standard');
  const [emergency, setEmergency] = useState(String(getDefault('emergencyTemp')));
  const [agentRate, setAgentRate] = useState(String(getDefault('updateInterval')));
  const [fanStep, setFanStep] = useState(String(getDefault('fanStep')));
  const [hysteresis, setHysteresis] = useState(String(getDefault('hysteresis')));
  const [copiedType, setCopiedType] = useState<'curl' | 'wget' | null>(null);

  // Hub URL Configuration - fetched from backend
  const [hubConfig, setHubConfig] = useState<DeploymentHubConfig | null>(null);
  const [urlMode, setUrlMode] = useState<UrlMode>('internal');

  // Compute URLs based on mode and config
  const getExternalUrl = () => {
    let baseUrl = API_BASE_URL;
    if (!baseUrl || !baseUrl.startsWith('http')) {
      const host = window.location.host;
      const protocol = window.location.protocol;
      baseUrl = `${protocol}//${host}`;
    }
    return baseUrl;
  };

  const getInternalUrl = () => {
    if (hubConfig?.hubIp) {
      return `http://${hubConfig.hubIp}:${hubConfig.hubPort}`;
    }
    return getExternalUrl(); // Fallback if not configured
  };

  const [hubUrl, setHubUrl] = useState<string>('');
  const [isMaintenanceExpanded, setIsMaintenanceExpanded] = useState(true);
  const [deploymentToken, setDeploymentToken] = useState<string | null>(null);
  const [isLoadingToken, setIsLoadingToken] = useState(false);
  const [updatingAgents, setUpdatingAgents] = useState<Set<number>>(new Set());
  const [hubStatus, setHubStatus] = useState<HubStatus | null>(null);
  const [isStaging, setIsStaging] = useState(false);

  // Tooltip context for interpolation (uses current form values)
  const tooltipContext = useMemo(() => ({
    logLevel,
    emergencyTemp: emergency,
    failsafeSpeed: failsafe,
    agentInterval: agentRate,
    fanStep,
    hysteresis
  }), [logLevel, emergency, failsafe, agentRate, fanStep, hysteresis]);

  // Fleet Statistics Calculations
  const fleetStats = useMemo(() => {
    const total = systems.length;
    const online = systems.filter(s => s.status === 'online').length;
    const outdated = systems.filter(s => {
      if (!latestVersion || !s.agent_version) return false;
      const cleanLatest = latestVersion.replace('v', '');
      return !s.agent_version.includes(cleanLatest);
    }).length;

    return { total, online, outdated };
  }, [systems, latestVersion]);

  // Fetch hub status on load and after actions
  const refreshHubStatus = async () => {
    try {
      const status = await getHubStatus();
      setHubStatus(status);
    } catch (error) {
      console.error('Failed to fetch hub status', error);
    }
  };

  useEffect(() => {
    refreshHubStatus();
    // Poll hub status every 10s while on this page
    const interval = setInterval(refreshHubStatus, 10000);
    return () => clearInterval(interval);
  }, []);

  // Fetch deployment hub config ONCE on mount
  useEffect(() => {
    getDeploymentHubConfig()
      .then(config => {
        setHubConfig(config);
        // Set initial URL based on whether internal IP is available
        if (config.hubIp) {
          setHubUrl(`http://${config.hubIp}:${config.hubPort}`);
          setUrlMode('internal');
        } else {
          setHubUrl(getExternalUrl());
          setUrlMode('external');
        }
      })
      .catch(err => {
        console.error('Failed to fetch deployment config', err);
        // Fallback to external URL
        setHubUrl(getExternalUrl());
        setUrlMode('external');
      });
  }, []);

  const handleStageUpdate = async (version: string) => {
    setIsStaging(true);
    try {
      await stageUpdateToHub(version);
      toast.success(`Version ${version} is now ready on local server`);
      await refreshHubStatus();
    } catch (error: any) {
      toast.error(error?.response?.data?.error || 'Failed to download to server');
    } finally {
      setIsStaging(false);
    }
  };

  const handleClearDownloads = async () => {
    if (!hubStatus?.version) {
      toast.error('No cached agents to clear');
      return;
    }

    try {
      await clearHubDownloads();
      toast.success('Agent cache cleared successfully');
      await refreshHubStatus();
    } catch (error: any) {
      toast.error(error?.response?.data?.error || 'Failed to clear cache');
    }
  };

  // Handle token generation when config changes (debounced)
  useEffect(() => {
    const refreshToken = async () => {
      setIsLoadingToken(true);
      try {
        const config = {
          log_level: logLevel,
          failsafe_speed: parseInt(failsafe),
          emergency_temp: parseFloat(emergency),
          update_interval: parseFloat(agentRate),
          fan_step: parseInt(fanStep),
          hysteresis: parseFloat(hysteresis),
          path_mode: pathMode,
          base_url: hubUrl  // User-editable Hub URL for agent connections
        };
        const response = await createDeploymentTemplate(config);
        setDeploymentToken(response.token);
      } catch (error) {
        console.error('Failed to generate deployment token', error);
        toast.error('Token generation failed');
      } finally {
        setIsLoadingToken(false);
      }
    };

    const timer = setTimeout(refreshToken, 500); // Debounce 500ms
    return () => clearTimeout(timer);
  }, [logLevel, failsafe, emergency, agentRate, fanStep, hysteresis, pathMode, hubUrl]);

  // Clear updating state when agent reconnects
  useEffect(() => {
    if (updatingAgents.size > 0) {
      systems.forEach(system => {
        if (updatingAgents.has(system.id) && system.status === 'online') {
          // Agent reconnected, clear updating state after brief delay
          setTimeout(() => {
            setUpdatingAgents(current => {
              const updated = new Set(current);
              updated.delete(system.id);
              return updated;
            });
          }, 3000);
        }
      });
    }
  }, [systems, updatingAgents]);

  const generateCommand = (tool: 'curl' | 'wget') => {
    if (!deploymentToken) return '';

    const url = `${hubUrl}/api/deploy/linux?token=${deploymentToken}`;

    if (tool === 'curl') {
      return `curl -sSL "${url}" | bash`;
    }
    return `wget -qO- "${url}" | bash`;
  };

  const handleRemoteUpdate = async (systemId: number) => {
    try {
      setUpdatingAgents(prev => new Set(prev).add(systemId));
      await selfUpdateAgent(systemId);
      toast.success('Update command sent to agent');
    } catch (error: any) {
      console.error('Failed to trigger remote update', error);
      toast.error(error?.response?.data?.error || 'Failed to send update command');
      // Clear updating state on error
      setUpdatingAgents(prev => {
        const next = new Set(prev);
        next.delete(systemId);
        return next;
      });
    }
  };

  const copyToClipboard = async (tool: 'curl' | 'wget') => {
    const command = generateCommand(tool);
    if (!command) return;

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(command);
      } else {
        throw new Error('Clipboard API unavailable');
      }
      setCopiedType(tool);
      toast.success(`${tool.toUpperCase()} command copied to clipboard`);
      setTimeout(() => setCopiedType(null), 2000);
    } catch {
      // Fallback for non-secure contexts (HTTP over IP)
      try {
        const textarea = document.createElement('textarea');
        textarea.value = command;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const successful = document.execCommand('copy');
        document.body.removeChild(textarea);
        if (successful) {
          setCopiedType(tool);
          toast.success(`${tool.toUpperCase()} command copied to clipboard`);
          setTimeout(() => setCopiedType(null), 2000);
        } else {
          toast.error('Failed to copy to clipboard');
        }
      } catch {
        toast.error('Failed to copy to clipboard');
      }
    }
  };


  return (
    <div className="deployment-page">
      <div className="deployment-section-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-md)' }}>
          <div style={{
            color: 'var(--color-accent-dynamic)',
            background: 'color-mix(in srgb, var(--color-accent-dynamic), transparent 92%)',
            padding: 'var(--spacing-sm)',
            borderRadius: 'var(--radius-md)',
            display: 'flex',
            border: '1px solid color-mix(in srgb, var(--color-accent-dynamic), transparent 85%)'
          }}>
            <Command size={24} />
          </div>
          <div>
            <h2 style={{ margin: 0 }}>Deployment Center</h2>
            <p style={{ margin: 0 }}>Provision new agents and manage existing nodes across your infrastructure.</p>
          </div>
        </div>
      </div>

      {/* Fleet Overview Metrics */}
      <div className="fleet-metrics-row">
        <MetricCard
          label="Total Agents"
          value={fleetStats.total}
          icon={<Server size={20} />}
          tooltip="Total number of registered agents across all systems"
        />
        <MetricCard
          label="Online Now"
          value={fleetStats.online}
          icon={<Activity size={20} />}
          borderLeftColor="var(--color-success)"
          iconStyle={{ color: 'var(--color-success)', background: 'rgba(76, 175, 80, 0.1)' }}
          tooltip="Agents currently connected and reporting data"
        />
        <MetricCard
          label="Outdated"
          value={fleetStats.outdated}
          icon={<ShieldAlert size={20} />}
          borderLeftColor={fleetStats.outdated > 0 ? 'var(--color-warning)' : 'var(--border-color)'}
          iconStyle={{
            color: fleetStats.outdated > 0 ? 'var(--color-warning)' : 'var(--text-tertiary)',
            background: fleetStats.outdated > 0 ? 'rgba(255, 152, 0, 0.1)' : 'var(--bg-hover)'
          }}
          tooltip="Agents running older versions than the latest release"
        />
      </div>

      <div className="deployment-content-grid">
        <InstallerSection 
          latestVersion={latestVersion} 
          unstableVersion={unstableVersion || null}
          githubRepo={GITHUB_REPO} 
        />

        <ActionButton githubRepo={GITHUB_REPO} />

        {/* Agent Downloads - Stage binaries from GitHub to local Hub */}
        <section className="deployment-section agent-downloads-panel">
          <h3><Download size={20} /> Agent Downloads</h3>
          <div className="local-prep-widget">
            <div className="prep-status">
              <Server size={14} />
              <span className="prep-label">Hub:</span>
              {hubStatus?.version ? (
                <span className="prep-version success">{hubStatus.version} Ready</span>
              ) : (
                <span className="prep-version empty">No Cache</span>
              )}
            </div>

            <div className="prep-actions-group">
              {latestVersion && (
                <button
                  className={`btn-prep-action stable ${isStaging ? 'loading' : ''} ${hubStatus?.version === latestVersion ? 'current' : ''}`}
                  onClick={() => handleStageUpdate(latestVersion)}
                  disabled={isStaging || hubStatus?.version === latestVersion}
                  title={hubStatus?.version === latestVersion
                    ? `Stable Version ${latestVersion} is Ready to Deploy.`
                    : `Download Stable Version ${latestVersion} \nSafe & Reliable.`}
                >
                  <Download size={12} />
                  <span>Stable {latestVersion}</span>
                </button>
              )}

              {unstableVersion && (
                <button
                  className={`btn-prep-action unstable ${isStaging ? 'loading' : ''} ${hubStatus?.version === unstableVersion ? 'current' : ''}`}
                  onClick={() => handleStageUpdate(unstableVersion)}
                  disabled={isStaging || hubStatus?.version === unstableVersion}
                  title={hubStatus?.version === unstableVersion
                    ? `Experimental Version ${unstableVersion} is Ready to Deploy.`
                    : `Download Experimental Version ${unstableVersion} \nNewest Features & Fixes, may have bugs.`}
                >
                  <Activity size={12} />
                  <span>Unstable {unstableVersion}</span>
                </button>
              )}
            </div>

            <div className="prep-manual-actions">
              <button
                className="btn-clear-cache"
                onClick={handleClearDownloads}
                disabled={!hubStatus?.version || isStaging}
                title="Clear all cached agent binaries from Hub server"
              >
                <Trash2 size={14} />
                <span>Clear Cache</span>
              </button>
            </div>
          </div>
        </section>

        {/* Rapid Deployment Section */}
        <section className="deployment-section builder-panel">
          <h3><Rocket size={20} /> Deployment AIO</h3>

          <div className="builder-ui">
            {/* Installation Mode Selector - Top Bar */}
            <div className="builder-top-bar">
              <div className="builder-group path-group" title="Choose where the agent will be installed. Standard uses system paths, Portable installs to current directory.">
                <span className="builder-label">Installation Mode</span>
                <div className="toggle-presets path-toggles">
                  <button
                    className={`toggle-item ${pathMode === 'standard' ? 'active' : ''}`}
                    onClick={() => setPathMode('standard')}
                    title="Install to /opt/pankha-agent/ with logs in /var/log/pankha-agent/"
                  >
                    <Server size={14} />
                    Standard (/opt/)
                  </button>
                  <button
                    className={`toggle-item ${pathMode === 'portable' ? 'active' : ''}`}
                    onClick={() => setPathMode('portable')}
                    title="Install to current working directory with logs in same folder"
                  >
                    <FolderDown size={14} />
                    Portable (CWD)
                  </button>
                </div>
              </div>
            </div>

            {/* Hub URL - Connection Mode Toggle + Editable URL */}
            <div className="builder-hub-url">
              <div className="builder-group" title="Select Internal for LAN agents or External for remote agents accessing via public URL.">
                <span className="builder-label">Connection Mode</span>
                <div className="toggle-presets">
                  <button
                    className={`toggle-item ${urlMode === 'internal' ? 'active' : ''}`}
                    onClick={() => {
                      setUrlMode('internal');
                      setHubUrl(getInternalUrl());
                    }}
                    disabled={!hubConfig?.hubIp}
                    title={hubConfig?.hubIp ? `Internal network address: ${hubConfig.hubIp}:${hubConfig.hubPort}` : 'Internal IP not configured in server settings'}
                  >
                    <Server size={14} />{' '}Internal
                  </button>
                  <button
                    className={`toggle-item ${urlMode === 'external' ? 'active' : ''}`}
                    onClick={() => {
                      setUrlMode('external');
                      setHubUrl(getExternalUrl());
                    }}
                    title="Uses the URL you're currently accessing this page from"
                  >
                    <ExternalLink size={14} />{' '}External
                  </button>
                </div>
              </div>
              <div className="hub-url-group" title="The URL agents will use to connect to this Pankha Hub. You can edit this manually.">
                <span className="builder-label"><Link2 size={14} /> Hub URL</span>
                <div className="hub-url-input-wrapper">
                  <input
                    type="text"
                    className="hub-url-input"
                    value={hubUrl}
                    onChange={(e) => setHubUrl(e.target.value)}
                    placeholder="http://192.168.1.100:3000"
                  />
                  <button
                    className="hub-url-reset"
                    onClick={() => {
                      const url = urlMode === 'internal' ? getInternalUrl() : getExternalUrl();
                      setHubUrl(url);
                    }}
                    title={`Reset to ${urlMode} URL`}
                  >
                    <RotateCcw size={14} />
                  </button>
                </div>
              </div>
            </div>

            <div className="builder-main-grid">
              {/* Row 1: Log Level | Emergency C | Failsafe Speed */}
              <div className="builder-group" title={interpolateTooltip(getOption('logLevel').tooltip, tooltipContext)}>
                <span className="builder-label">{uiOptions.options.logLevel.label}</span>
                <div className="toggle-presets">
                  {uiOptions.options.logLevel.values.map(opt => (
                    <button
                      key={String(opt.value)}
                      className={`toggle-item ${logLevel === opt.value ? 'active' : ''}`}
                      onClick={() => setLogLevel(opt.value as LogLevel)}
                    >
                      {opt.cleanLabel || opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="builder-group" title={interpolateTooltip(getOption('emergencyTemp').tooltip, tooltipContext)}>
                <span className="builder-label">{uiOptions.options.emergencyTemp.label}</span>
                <div className="toggle-presets">
                  {uiOptions.options.emergencyTemp.values.map(opt => (
                    <button
                      key={String(opt.value)}
                      className={`toggle-item ${emergency === String(opt.value) ? 'active' : ''}`}
                      onClick={() => setEmergency(String(opt.value))}
                    >
                      {opt.cleanLabel || opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="builder-group" title={interpolateTooltip(getOption('failsafeSpeed').tooltip, tooltipContext)}>
                <span className="builder-label">{uiOptions.options.failsafeSpeed.label}</span>
                <div className="toggle-presets">
                  {uiOptions.options.failsafeSpeed.values.map(opt => (
                    <button
                      key={String(opt.value)}
                      className={`toggle-item ${failsafe === String(opt.value) ? 'active' : ''}`}
                      onClick={() => setFailsafe(String(opt.value) as Failsafe)}
                    >
                      {opt.cleanLabel || opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Row 2: Agent rate | Fan Step | Hysteresis */}
              <div className="builder-group" title={interpolateTooltip(getOption('updateInterval').tooltip, tooltipContext)}>
                <span className="builder-label">{uiOptions.options.updateInterval.label}</span>
                <div className="toggle-presets">
                  {uiOptions.options.updateInterval.values.map(opt => (
                    <button
                      key={String(opt.value)}
                      className={`toggle-item ${agentRate === String(opt.value) ? 'active' : ''}`}
                      onClick={() => setAgentRate(String(opt.value))}
                    >
                      {opt.cleanLabel || opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="builder-group" title={interpolateTooltip(getOption('fanStep').tooltip, tooltipContext)}>
                <span className="builder-label">{uiOptions.options.fanStep.label}</span>
                <div className="toggle-presets">
                  {uiOptions.options.fanStep.values.map(opt => (
                    <button
                      key={String(opt.value)}
                      className={`toggle-item ${fanStep === String(opt.value) ? 'active' : ''}`}
                      onClick={() => setFanStep(String(opt.value))}
                    >
                      {opt.cleanLabel || opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="builder-group" title={interpolateTooltip(getOption('hysteresis').tooltip, tooltipContext)}>
                <span className="builder-label">{uiOptions.options.hysteresis.label}</span>
                <div className="toggle-presets">
                  {uiOptions.options.hysteresis.values.map(opt => (
                    <button
                      key={String(opt.value)}
                      className={`toggle-item ${hysteresis === String(opt.value) ? 'active' : ''}`}
                      onClick={() => setHysteresis(String(opt.value))}
                    >
                      {opt.cleanLabel || opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="deployment-commands-header">
              <h3>Deployment Commands</h3>
            </div>

            <div className="terminal-stack">
              <TerminalBlock
                title="CURL"
                tool="curl"
                copiedType={copiedType}
                command={generateCommand('curl')}
                onCopy={copyToClipboard}
                isLoading={isLoadingToken}
              />
              <div className="terminal-spacer" />
              <TerminalBlock
                title="WGET"
                tool="wget"
                copiedType={copiedType}
                command={generateCommand('wget')}
                onCopy={copyToClipboard}
                isLoading={isLoadingToken}
              />
            </div>
          </div>
        </section>

        <MaintenanceSection
          isExpanded={isMaintenanceExpanded}
          onToggle={() => setIsMaintenanceExpanded(!isMaintenanceExpanded)}
          systems={systems}
          stableVersion={latestVersion}
          unstableVersion={unstableVersion || null}
          updatingAgents={updatingAgents}
          onApplyUpdate={handleRemoteUpdate}
          hubStatus={hubStatus}
        />

        {/* Resources Section */}
        <ResourcesSection githubRepo={GITHUB_REPO} />
      </div>
    </div>
  );
};

export default DeploymentPage;

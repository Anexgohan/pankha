import React, { useState, useMemo } from 'react';
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
  History
} from 'lucide-react';
import { useWebSocketData } from '../../hooks/useWebSocketData';
import { toast } from '../../utils/toast';
import { uiOptions, getDefault } from '../../utils/uiOptions';
import '../styles/deployment.css';

interface DeploymentPageProps {
  latestVersion: string | null;
}

type Arch = 'x86_64' | 'ARM64';
type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
type Failsafe = '30' | '50' | '100';

interface TerminalBlockProps {
  title: string;
  tool: 'curl' | 'wget';
  copiedType: 'curl' | 'wget' | null;
  command: string;
  onCopy: (tool: 'curl' | 'wget') => void;
}

const TerminalBlock: React.FC<TerminalBlockProps> = ({ title, tool, copiedType, command, onCopy }) => (
  <div className="terminal-instance">
    <div className="terminal-instance-header">
      <span className="terminal-title-text">{title}</span>
      <button 
        className={`terminal-copy-action ${copiedType === tool ? 'success' : ''}`} 
        onClick={() => onCopy(tool)}
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
        <code className="command-line">{command}</code>
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
}> = React.memo(({ label, value, icon, borderLeftColor, iconStyle }) => (
  <div className="fleet-metric-card" style={{ borderLeftColor }}>
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
  githubRepo: string;
}> = React.memo(({ latestVersion, githubRepo }) => (
  <section className="deployment-section">
    <h3><Download size={20} /> Official Installers</h3>
    <div className="download-options">
      <div className="installer-card">
        <h4>
          <Binary size={18} /> Windows Agent
          <span className="version-tag">{latestVersion || 'Detecting'}</span>
        </h4>
        <p>Native Windows service with Tray App. Supports Windows 10/11 x86_64. Self-contained .NET 8.0 execution.</p>
        <a 
          href={`${githubRepo}/releases/latest/download/pankha-agent-windows_x64.msi`} 
          className="btn-primary-tactical"
          download
        >
          <Download size={16} /> Get Latest Release
        </a>
      </div>
      
      <div className="installer-card">
        <h4>
          <Settings2 size={18} /> Linux Setup
          <span className="version-tag">STABLE</span>
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
          href={`${githubRepo}/blob/main/documentation/private/agents/clients/linux/rust/setup-guide.md`} 
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
const INSTALL_SCRIPT_URL = 'https://raw.githubusercontent.com/Anexgohan/pankha/main/install.sh';

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
      <a href={`${githubRepo}/wiki`} target="_blank" rel="noopener noreferrer" className="resource-link">
        <div className="link-label">
          <Server size={18} />
          <span>Wiki: Setup & Configuration</span>
        </div>
        <ArrowRight size={16} className="link-arrow" />
      </a>
      <a href={`${githubRepo}/blob/main/documentation/private/agents/clients/linux/rust/setup-guide.md`} target="_blank" rel="noopener noreferrer" className="resource-link">
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
  latestVersion: string | null;
  onApplyUpdate: (tool: 'curl' | 'wget') => void;
}> = React.memo(({ isExpanded, onToggle, systems, latestVersion, onApplyUpdate }) => (
  <section className={`deployment-section maintenance-panel ${!isExpanded ? 'collapsed' : ''}`}>
    <div className="maintenance-header-toggle" onClick={onToggle}>
      <h3>
        <Activity size={20} /> Fleet Maintenance
        {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
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
                <th>Health</th>
                <th>Status</th>
                <th>Maintenance</th>
              </tr>
            </thead>
            <tbody>
              {systems.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: 'var(--spacing-2xl) 0', color: 'var(--text-tertiary)' }}>
                    NO REMOTE NODES DISCOVERED
                  </td>
                </tr>
              ) : (
                systems.map(system => {
                  const isOutdated = latestVersion && system.agent_version && 
                                    !system.agent_version.includes(latestVersion.replace('v', ''));
                  const isOnline = system.status === 'online';
                  return (
                    <tr key={system.id}>
                      <td>{system.name}</td>
                      <td>{system.agent_id}</td>
                      <td>{system.agent_version || 'v0.0.0'}</td>
                      <td>
                        <span className={`status-tag ${isOnline ? 'online' : 'offline'}`} style={{ 
                          background: isOnline ? 'color-mix(in srgb, var(--color-success), transparent 90%)' : 'color-mix(in srgb, var(--color-error), transparent 90%)',
                          color: isOnline ? 'var(--color-success)' : 'var(--color-error)',
                          border: `1px solid color-mix(in srgb, ${isOnline ? 'var(--color-success)' : 'var(--color-error)'}, transparent 80%)`
                        }}>
                          {isOnline ? 'Online' : 'Offline'}
                        </span>
                      </td>
                      <td>
                        <span className={`status-tag ${isOutdated ? 'outdated' : 'current'}`}>
                          {isOutdated ? 'Outdated' : 'Current'}
                        </span>
                      </td>
                      <td>
                        <button 
                          className={`btn-table-action ${isOutdated ? 'update-needed' : ''}`}
                          onClick={() => onApplyUpdate('curl')}
                        >
                          {isOutdated ? 'Apply Update' : 'Reinstall'}
                        </button>
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
));

export const DeploymentPage: React.FC<DeploymentPageProps> = ({ latestVersion }) => {
  const { systems } = useWebSocketData();
  const [arch, setArch] = useState<Arch>('x86_64');
  const [logLevel, setLogLevel] = useState<LogLevel>(getDefault('logLevel'));
  const [failsafe, setFailsafe] = useState<Failsafe>(String(getDefault('failsafeSpeed')) as Failsafe);
  const [emergency, setEmergency] = useState(String(getDefault('emergencyTemp')));
  const [agentRate, setAgentRate] = useState(String(getDefault('updateInterval')));
  const [fanStep, setFanStep] = useState(String(getDefault('fanStep')));
  const [hysteresis, setHysteresis] = useState(String(getDefault('hysteresis')));
  const [copiedType, setCopiedType] = useState<'curl' | 'wget' | null>(null);
  const [isMaintenanceExpanded, setIsMaintenanceExpanded] = useState(true);

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

  const generateCommand = (tool: 'curl' | 'wget') => {
    const flags = `--arch ${arch} --log ${logLevel} --failsafe ${failsafe} --emergency ${emergency} --rate ${agentRate} --step ${fanStep} --hysteresis ${hysteresis}`;
    if (tool === 'curl') {
      return `curl -sSL ${INSTALL_SCRIPT_URL} | bash -s -- ${flags}`;
    }
    return `wget -qO- ${INSTALL_SCRIPT_URL} | bash -s -- ${flags}`;
  };

  const copyToClipboard = async (tool: 'curl' | 'wget') => {
    const command = generateCommand(tool);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(command);
      } else {
        throw new Error('Clipboard API unavailable');
      }
      setCopiedType(tool);
      toast.success(`${tool.toUpperCase()} command copied to clipboard`);
      setTimeout(() => setCopiedType(null), 2000);
    } catch (err) {
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
      } catch (fallbackErr) {
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
        <MetricCard label="Total Agents" value={fleetStats.total} icon={<Server size={20} />} />
        <MetricCard 
          label="Online Now" 
          value={fleetStats.online} 
          icon={<Activity size={20} />} 
          borderLeftColor="var(--color-success)"
          iconStyle={{ color: 'var(--color-success)', background: 'rgba(76, 175, 80, 0.1)' }}
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
        />
      </div>

      <div className="deployment-content-grid">
        <InstallerSection latestVersion={latestVersion} githubRepo={GITHUB_REPO} />

        <ActionButton githubRepo={GITHUB_REPO} />

        {/* Rapid Deployment Section */}
        <section className="deployment-section builder-panel">
          <h3><Rocket size={20} /> Deployment AIO</h3>
          
          <div className="builder-ui">
            {/* Architecture Selector - Top Bar */}
            <div className="builder-top-bar">
              <div className="builder-group arch-group">
                <span className="builder-label">Architecture</span>
                <div className="toggle-presets arch-toggles">
                  {(['x86_64', 'ARM64'] as Arch[]).map(a => (
                    <button 
                      key={a} 
                      className={`toggle-item ${arch === a ? 'active' : ''}`}
                      onClick={() => setArch(a)}
                    >
                      {a}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="builder-main-grid">
              {/* Row 1: Log Level | Emergency °C | Failsafe Speed */}
              <div className="builder-group">
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

              <div className="builder-group">
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

              <div className="builder-group">
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
              <div className="builder-group">
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

              <div className="builder-group">
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

              <div className="builder-group">
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
              />
              <div className="terminal-spacer" />
              <TerminalBlock 
                title="WGET" 
                tool="wget" 
                copiedType={copiedType}
                command={generateCommand('wget')}
                onCopy={copyToClipboard}
              />
            </div>
          </div>
        </section>

        <MaintenanceSection 
          isExpanded={isMaintenanceExpanded}
          onToggle={() => setIsMaintenanceExpanded(!isMaintenanceExpanded)}
          systems={systems}
          latestVersion={latestVersion}
          onApplyUpdate={copyToClipboard}
        />

        {/* Resources Section */}
        <ResourcesSection githubRepo={GITHUB_REPO} />
      </div>
    </div>
  );
};

export default DeploymentPage;

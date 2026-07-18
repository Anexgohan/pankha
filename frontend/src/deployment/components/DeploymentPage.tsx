import React, { useState, useMemo, useEffect } from 'react';
import {
  Command,
  Server,
  Activity,
  ShieldAlert,
  History,
  ExternalLink,
} from 'lucide-react';
import { toast } from '../../utils/toast';
import { getDefault } from '../../utils/uiOptions';
import {
  createDeploymentTemplate,
  selfUpdateAgent,
  API_BASE_URL,
  getHubStatus,
  stageUpdateToHub,
  clearHubDownloads,
  getDeploymentHubConfig,
  type HubStatus,
  type DeploymentHubConfig,
} from '../../services/api';

import PlatformArchPicker, { type Platform, type Arch } from './PlatformArchPicker';
import ReleaseHubCache, { type Channel, type ReleaseInfo } from './ReleaseHubCache';
import BmcProfileStep, { type ProfileMode } from './BmcProfileStep';
import InstallConnection, { type PathMode, type UrlMode } from './InstallConnection';
import RuntimeDefaults, { type LogLevel } from './RuntimeDefaults';
import DeploySummary from './DeploySummary';
import MaintenanceSection from './MaintenanceSection';
import type { PendingAgent } from '../../services/authApi';
import ResourcesSection from './ResourcesSection';
import '../styles/deployment.css';

type Failsafe = string;
type Tool = 'wget' | 'curl' | 'powershell';

const GITHUB_REPO = 'https://github.com/Anexgohan/pankha';
const PANKHA_SITE = 'https://pankha.app';

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
MetricCard.displayName = 'MetricCard';

const ActionButton: React.FC<{ githubRepo: string }> = React.memo(({ githubRepo }) => (
  <div className="deployment-action-bar">
    <a
      href={`${githubRepo}/releases`}
      target="_blank"
      rel="noopener noreferrer"
      className="btn-action-full"
    >
      <History size={16} /> VIEW ALL RELEASES &amp; CHANGELOG <ExternalLink size={14} />
    </a>
  </div>
));
ActionButton.displayName = 'ActionButton';

interface DeploymentPageProps {
  systems: any[];
  latestVersion: string | null;
  unstableVersion?: string | null;
  stableReleases?: ReleaseInfo[];
  unstableReleases?: ReleaseInfo[];
  pendingAgents?: PendingAgent[];
}

export const DeploymentPage: React.FC<DeploymentPageProps> = ({
  systems,
  latestVersion,
  unstableVersion,
  stableReleases = [],
  unstableReleases = [],
  pendingAgents = [],
}) => {
  // Workspace state (new shape replaces aioAgentMode/arch)
  const [platform, setPlatform] = useState<Platform>('linux');
  const [arch, setArch] = useState<Arch>('x64');
  const [channel, setChannel] = useState<Channel>('stable');

  // Runtime defaults state
  const [logLevel, setLogLevel] = useState<LogLevel>(getDefault('logLevel'));
  const [failsafe, setFailsafe] = useState<Failsafe>(String(getDefault('failsafeSpeed')));
  const [emergency, setEmergency] = useState(String(getDefault('emergencyTemp')));
  const [agentRate, setAgentRate] = useState(String(getDefault('updateInterval')));
  const [fanStep, setFanStep] = useState(String(getDefault('fanStep')));
  const [hysteresis, setHysteresis] = useState(String(getDefault('hysteresis')));

  // Install + connection state
  const [pathMode, setPathMode] = useState<PathMode>('standard');
  const [urlMode, setUrlMode] = useState<UrlMode>('internal');
  const [hubConfig, setHubConfig] = useState<DeploymentHubConfig | null>(null);
  const [hubUrl, setHubUrl] = useState<string>('');

  // IPMI profile state
  const [profileMode, setProfileMode] = useState<ProfileMode>('catalog');
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);

  // Hub + deployment state
  const [hubStatus, setHubStatus] = useState<HubStatus | null>(null);
  const [isStaging, setIsStaging] = useState(false);
  const [deploymentToken, setDeploymentToken] = useState<string | null>(null);
  const [isLoadingToken, setIsLoadingToken] = useState(false);
  const [updatingAgents, setUpdatingAgents] = useState<Set<number>>(new Set());
  const [isMaintenanceExpanded, setIsMaintenanceExpanded] = useState(true);
  const [copiedType, setCopiedType] = useState<Tool | null>(null);

  // Version picker state (preserved from previous implementation)
  const [selectedStableVersion, setSelectedStableVersion] = useState<string>('');
  const [selectedUnstableVersion, setSelectedUnstableVersion] = useState<string>('');

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
    return getExternalUrl();
  };

  // Fleet Statistics
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
    const interval = setInterval(refreshHubStatus, 10000);
    return () => clearInterval(interval);
  }, []);

  // Default selections to saved pick or latest of each type when releases load
  useEffect(() => {
    if (!selectedStableVersion && stableReleases.length > 0) {
      const saved = sessionStorage.getItem('pankha-picker-stable');
      const match = saved && stableReleases.some(r => r.tag_name === saved);
      setSelectedStableVersion(match ? saved : stableReleases[0].tag_name);
    }
  }, [stableReleases]);

  useEffect(() => {
    if (!selectedUnstableVersion && unstableReleases.length > 0) {
      const saved = sessionStorage.getItem('pankha-picker-unstable');
      const match = saved && unstableReleases.some(r => r.tag_name === saved);
      setSelectedUnstableVersion(match ? saved : unstableReleases[0].tag_name);
    }
  }, [unstableReleases]);

  // Fetch deployment hub config once
  useEffect(() => {
    getDeploymentHubConfig()
      .then(config => {
        setHubConfig(config);
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
        setHubUrl(getExternalUrl());
        setUrlMode('external');
      });
  }, []);

  const handleUrlModeChange = (mode: UrlMode) => {
    setUrlMode(mode);
    setHubUrl(mode === 'internal' ? getInternalUrl() : getExternalUrl());
  };

  const handleHubUrlReset = () => {
    setHubUrl(urlMode === 'internal' ? getInternalUrl() : getExternalUrl());
  };

  const handleStageUpdate = async (version: string) => {
    setIsStaging(true);
    try {
      const result = await stageUpdateToHub(version);
      const f = result.files;
      const fileParts = `x64 ${f.x64 ? '+' : '-'} arm64 ${f.arm64 ? '+' : '-'} ipmi ${f.ipmi_x64 ? '+' : '-'}`;
      const checksum = result.checksumVerified ? 'checksums passed' : 'checksums unverified';
      toast.success(`Download ready ${result.version} (${fileParts}) ${checksum}`);
      await refreshHubStatus();
    } catch (error: any) {
      const data = error?.response?.data;
      if (data?.files) {
        const f = data.files;
        const fileParts = `x64 ${f.x64 ? '+' : '-'} arm64 ${f.arm64 ? '+' : '-'} ipmi ${f.ipmi_x64 ? '+' : '-'}`;
        toast.error(`Download failed ${data.version || version} (${fileParts}) ${data.error}`);
      } else {
        toast.error(data?.error || 'Download failed');
      }
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
    // Windows uses MSI download, no token needed
    if (platform === 'windows') {
      setDeploymentToken(null);
      return;
    }
    // Skip token generation for IPMI catalog mode when no profile is selected
    if (platform === 'ipmi' && profileMode === 'catalog' && !selectedProfileId) {
      setDeploymentToken(null);
      return;
    }

    const refreshToken = async () => {
      setIsLoadingToken(true);
      try {
        const config: Record<string, any> = {
          log_level: logLevel,
          failsafe_speed: parseInt(failsafe),
          emergency_temp: parseFloat(emergency),
          update_interval: parseFloat(agentRate),
          fan_step: parseInt(fanStep),
          hysteresis: parseFloat(hysteresis),
          path_mode: pathMode,
          base_url: hubUrl,
          arch,
        };

        if (platform === 'ipmi') {
          config.agent_type = 'ipmi_host';
          if (profileMode === 'catalog' && selectedProfileId) {
            config.profile_id = selectedProfileId;
          }
        }

        const response = await createDeploymentTemplate(config);
        setDeploymentToken(response.token);
      } catch (error) {
        console.error('Failed to generate deployment token', error);
        toast.error('Token generation failed');
      } finally {
        setIsLoadingToken(false);
      }
    };

    const timer = setTimeout(refreshToken, 500);
    return () => clearTimeout(timer);
  }, [logLevel, failsafe, emergency, agentRate, fanStep, hysteresis, pathMode, hubUrl, platform, arch, profileMode, selectedProfileId]);

  // Clear updating state when agent reconnects
  useEffect(() => {
    if (updatingAgents.size > 0) {
      systems.forEach(system => {
        if (updatingAgents.has(system.id) && system.status === 'online') {
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

  const generateCommand = (tool: Tool): string => {
    if (tool === 'powershell') {
      // Windows PowerShell installer placeholder - no token yet (Windows endpoint TBD)
      const versionPath = selectedStableVersion || 'latest';
      return `iwr -useb "${GITHUB_REPO}/releases/download/${versionPath}/install.ps1" | iex`;
    }
    if (!deploymentToken) return '';
    const endpoint = platform === 'ipmi' ? 'ipmi' : 'linux';
    const url = `${hubUrl}/api/deploy/${endpoint}?token=${deploymentToken}`;
    if (tool === 'curl') return `curl -sSL "${url}" | bash`;
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
      setUpdatingAgents(prev => {
        const next = new Set(prev);
        next.delete(systemId);
        return next;
      });
    }
  };

  const copyToClipboard = async (tool: Tool) => {
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
      // Fallback for non-secure contexts
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

  // Selected version (used across panels)
  const selectedVersion = channel === 'stable' ? selectedStableVersion : selectedUnstableVersion;

  // Release notes lookup
  const releaseNotes: ReleaseInfo | null = useMemo(() => {
    const list = channel === 'stable' ? stableReleases : unstableReleases;
    return list.find(r => r.tag_name === selectedVersion) || list[0] || null;
  }, [channel, selectedVersion, stableReleases, unstableReleases]);

  // BMC profile display (vendor / model from profile_id)
  const bmcVendorModel = selectedProfileId
    ? selectedProfileId.split('/').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' / ')
    : null;

  // Step numbering: IPMI gets 5 steps with BMC Profile as step 3
  const isIpmi = platform === 'ipmi';
  const stepInstallConnection = isIpmi ? 4 : 3;
  const stepRuntimeDefaults = isIpmi ? 5 : 4;

  return (
    <div className="deployment-page">
      <div className="deployment-section-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-md)' }}>
          <div className="deployment-page-icon">
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
            background: fleetStats.outdated > 0 ? 'rgba(255, 152, 0, 0.1)' : 'var(--bg-hover)',
          }}
          tooltip="Agents running older versions than the latest release"
        />
      </div>

      {/* Deploy workspace eyebrow */}
      <div className="deploy-workspace-eyebrow">
        <span className="deploy-workspace-title">Deploy a new agent</span>
        <span className="deploy-workspace-sub">
          The summary on the right updates as you configure - copy the command when it looks right.
        </span>
      </div>

      {/* 2-column workspace */}
      <div className="deploy-workspace">
        <div className="deploy-workspace-steps">
          <PlatformArchPicker
            stepNumber={1}
            platform={platform}
            arch={arch}
            onPlatformChange={setPlatform}
            onArchChange={setArch}
            hubStatus={hubStatus}
          />

          <ReleaseHubCache
            stepNumber={2}
            channel={channel}
            onChannelChange={setChannel}
            stableReleases={stableReleases}
            unstableReleases={unstableReleases}
            selectedStableVersion={selectedStableVersion}
            selectedUnstableVersion={selectedUnstableVersion}
            onSelectStableVersion={setSelectedStableVersion}
            onSelectUnstableVersion={setSelectedUnstableVersion}
            hubStatus={hubStatus}
            isStaging={isStaging}
            onStageVersion={handleStageUpdate}
            onClearCache={handleClearDownloads}
            githubRepo={GITHUB_REPO}
          />

          {isIpmi && (
            <BmcProfileStep
              stepNumber={3}
              profileMode={profileMode}
              onProfileModeChange={setProfileMode}
              selectedProfileId={selectedProfileId}
              onProfileSelect={setSelectedProfileId}
              systems={systems}
            />
          )}

          <InstallConnection
            stepNumber={stepInstallConnection}
            pathMode={pathMode}
            onPathModeChange={setPathMode}
            urlMode={urlMode}
            onUrlModeChange={handleUrlModeChange}
            hubUrl={hubUrl}
            onHubUrlChange={setHubUrl}
            onHubUrlReset={handleHubUrlReset}
            hubConfig={hubConfig}
          />

          <RuntimeDefaults
            stepNumber={stepRuntimeDefaults}
            logLevel={logLevel}
            onLogLevelChange={setLogLevel}
            emergency={emergency}
            onEmergencyChange={setEmergency}
            failsafe={failsafe}
            onFailsafeChange={setFailsafe}
            agentRate={agentRate}
            onAgentRateChange={setAgentRate}
            fanStep={fanStep}
            onFanStepChange={setFanStep}
            hysteresis={hysteresis}
            onHysteresisChange={setHysteresis}
          />
        </div>

        <DeploySummary
          platform={platform}
          arch={arch}
          channel={channel}
          selectedVersion={selectedVersion}
          pathMode={pathMode}
          urlMode={urlMode}
          hubUrl={hubUrl}
          logLevel={logLevel}
          emergency={emergency}
          failsafe={failsafe}
          agentRate={agentRate}
          fanStep={fanStep}
          hysteresis={hysteresis}
          bmcVendorModel={bmcVendorModel}
          bmcProfileSource={isIpmi ? profileMode : null}
          isLoadingToken={isLoadingToken}
          generateCommand={generateCommand}
          onCopy={copyToClipboard}
          copiedType={copiedType}
          releaseNotes={releaseNotes}
          githubRepo={GITHUB_REPO}
        />
      </div>

      {/* Existing fleet section */}
      <div className="deploy-existing-fleet-divider">
        <span className="builder-label">Existing fleet</span>
      </div>

      <MaintenanceSection
        isExpanded={isMaintenanceExpanded}
        onToggle={() => setIsMaintenanceExpanded(!isMaintenanceExpanded)}
        systems={systems}
        pendingAgents={pendingAgents}
        stableVersion={latestVersion}
        unstableVersion={unstableVersion || null}
        updatingAgents={updatingAgents}
        onApplyUpdate={handleRemoteUpdate}
        hubStatus={hubStatus}
        githubRepo={GITHUB_REPO}
      />

      <ActionButton githubRepo={GITHUB_REPO} />

      <ResourcesSection githubRepo={GITHUB_REPO} pankhaSite={PANKHA_SITE} />
    </div>
  );
};

export default DeploymentPage;

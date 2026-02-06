/**
 * Settings Component - Main settings page with tabs
 */

import React, { useState, useEffect } from 'react';
import { useLicense } from '../../license';
import { useDashboardSettings } from '../../contexts/DashboardSettingsContext';
import { setLicense, getPricing, deleteLicense, getSystems, getDiagnostics } from '../../services/api';
import { formatDate, formatFriendlyDate } from '../../utils/formatters';
import { toast } from '../../utils/toast';
import ColorPicker from './ColorPicker';
import {
  Github,
  ExternalLink,
  BookOpen,
  MessageSquare,
  ShieldCheck,
  Wind,
  Bug,
  Lightbulb,
  HelpCircle,
  Upload,
  Tag
} from 'lucide-react';
import '../styles/settings.css';

// Graph scale configuration constants
const GRAPH_SCALE_MIN_HOURS = 1;
const GRAPH_SCALE_MAX_HOURS = 720; // 30 days

type SettingsTab = 'general' | 'license' | 'diagnostics' | 'about';

interface TierPricing {
  name: string;
  agents: number;
  retentionDays: number;
  alerts: number;
  alertChannels: string[];
  apiAccess: string;
  showBranding: boolean;
  pricing: { monthly: number; yearly: number; lifetime: number };
}

interface PricingData {
  free: TierPricing;
  pro: TierPricing;
  enterprise: TierPricing;
}

// Dodo Payments configuration - Toggle IS_LIVE to switch modes
const IS_LIVE = true;

const CHECKOUT_BASE = IS_LIVE
  ? 'https://checkout.dodopayments.com/buy'
  : 'https://test.checkout.dodopayments.com/buy';

const PRODUCT_IDS = IS_LIVE ? {
  // LIVE MODE IDs
  pro: {
    monthly: 'pdt_0NXHTcRtQcWwEsK5nzGaI',
    yearly: 'pdt_0NXHU9c2ZTT2vIcTACOJ6',
    lifetime: 'pdt_0NXHUVBRXsjOEoOr6IuHb',
  },
  enterprise: {
    monthly: 'pdt_0NXHV9tBBwowJQGrcQHtJ',
    yearly: 'pdt_0NXHVMr0paoF5dyuxh8Tj',
    lifetime: 'pdt_0NXHVVviTeIhMfLCSLNqS',
  },
} : {
  // TEST MODE IDs
  pro: {
    monthly: 'pdt_0NV3sqzBkKRDNGHgkyOT4',
    yearly: 'pdt_0NV8gT4no4UJnP34pVgnl',
    lifetime: 'pdt_0NV8jwCkXAYkXJYyFrPQb',
  },
  enterprise: {
    monthly: 'pdt_0NV3tEaaHxETmRVdeJ0Ei',
    yearly: 'pdt_0NV8l5b1st3Cwv9PBbTLL',
    lifetime: 'pdt_0NV8gqfMxnRCmhzbWUzyR',
  },
};

const CHECKOUT_URLS = {
  pro: {
    monthly: `${CHECKOUT_BASE}/${PRODUCT_IDS.pro.monthly}`,
    yearly: `${CHECKOUT_BASE}/${PRODUCT_IDS.pro.yearly}`,
    lifetime: `${CHECKOUT_BASE}/${PRODUCT_IDS.pro.lifetime}`,
  },
  enterprise: {
    monthly: `${CHECKOUT_BASE}/${PRODUCT_IDS.enterprise.monthly}`,
    yearly: `${CHECKOUT_BASE}/${PRODUCT_IDS.enterprise.yearly}`,
    lifetime: `${CHECKOUT_BASE}/${PRODUCT_IDS.enterprise.lifetime}`,
  },
} as const;

// Diagnostics Tab Component
interface SystemInfo {
  id: number;
  name: string;
  agent_id: string;
  status: string;
  real_time_status?: string;
  agent_version?: string;
  platform?: string;
}

const DiagnosticsTab: React.FC = () => {
  const [systems, setSystems] = useState<SystemInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionStatus, setActionStatus] = useState<{ [key: number]: { type: 'loading' | 'success' | 'error'; message: string } }>({});

  useEffect(() => {
    const fetchSystems = async () => {
      try {
        const data = await getSystems();
        setSystems(data as unknown as SystemInfo[]);
      } catch (error) {
        console.error('Failed to fetch systems:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchSystems();
  }, []);

  const handleCopyToClipboard = async (systemId: number) => {
    setActionStatus(prev => ({ ...prev, [systemId]: { type: 'loading', message: 'Fetching...' } }));
    
    try {
      const response = await getDiagnostics(systemId);
      const jsonString = JSON.stringify(response.diagnostics, null, 2);
      
      // Try modern clipboard API first, fallback for HTTP contexts
      let copied = false;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        try {
          await navigator.clipboard.writeText(jsonString);
          copied = true;
        } catch {
          copied = false;
        }
      }
      
      // Fallback for non-secure contexts (HTTP)
      if (!copied) {
        const textarea = document.createElement('textarea');
        textarea.value = jsonString;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        copied = document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      
      if (copied) {
        setActionStatus(prev => ({ ...prev, [systemId]: { type: 'success', message: 'Copied!' } }));
        toast.success('Diagnostics copied to clipboard');
      } else {
        throw new Error('Copy failed');
      }
      
      setTimeout(() => setActionStatus(prev => {
        const newStatus = { ...prev };
        delete newStatus[systemId];
        return newStatus;
      }), 2000);
    } catch {
      setActionStatus(prev => ({ ...prev, [systemId]: { type: 'error', message: 'Failed' } }));
      toast.error('Failed to copy diagnostics');
      setTimeout(() => setActionStatus(prev => {
        const newStatus = { ...prev };
        delete newStatus[systemId];
        return newStatus;
      }), 3000);
    }
  };

  const handleDownloadAsFile = async (systemId: number, systemName: string) => {
    setActionStatus(prev => ({ ...prev, [systemId]: { type: 'loading', message: 'Fetching...' } }));
    
    try {
      const response = await getDiagnostics(systemId);
      const jsonString = JSON.stringify(response.diagnostics, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${systemName.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-hardware-info.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setActionStatus(prev => ({ ...prev, [systemId]: { type: 'success', message: 'Downloaded!' } }));
      toast.success(`Downloaded ${systemName} diagnostics`);
      setTimeout(() => setActionStatus(prev => {
        const newStatus = { ...prev };
        delete newStatus[systemId];
        return newStatus;
      }), 2000);
    } catch {
      setActionStatus(prev => ({ ...prev, [systemId]: { type: 'error', message: 'Failed' } }));
      toast.error('Failed to download diagnostics');
      setTimeout(() => setActionStatus(prev => {
        const newStatus = { ...prev };
        delete newStatus[systemId];
        return newStatus;
      }), 3000);
    }
  };

  // GitHub Issue URL builder with pre-filled template
  const GITHUB_REPO = 'https://github.com/Anexgohan/pankha';

  const handleReportIssue = async (system: SystemInfo) => {
    const isOnline = system.real_time_status === 'online';
    const platform = system.platform === 'windows' || system.agent_id.toLowerCase().startsWith('windows-') ? 'Windows' : 'Linux';
    
    // Build issue body template
    const issueTitle = encodeURIComponent(`[Hardware Support] ${system.name}`);
    const issueBody = encodeURIComponent(
`## System Information
- **Name:** ${system.name}
- **Agent ID:** \`${system.agent_id}\`
- **Platform:** ${platform}
- **Agent Version:** ${system.agent_version || 'Unknown'}
- **Status:** ${isOnline ? 'Online' : 'Offline'}

## Issue Description
<!-- Describe what's not working -->


## Hardware Diagnostics
<!-- Paste the JSON below (already copied to your clipboard if agent was online) -->
\`\`\`json
<PASTE HERE>
\`\`\`

## Expected Behavior
<!-- What did you expect to happen? -->

`);

    // If online, fetch diagnostics and copy to clipboard
    if (isOnline) {
      try {
        const response = await getDiagnostics(system.id);
        const jsonString = JSON.stringify(response.diagnostics, null, 2);
        
        // Copy to clipboard
        let copied = false;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          try {
            await navigator.clipboard.writeText(jsonString);
            copied = true;
          } catch {
            copied = false;
          }
        }
        
        if (!copied) {
          const textarea = document.createElement('textarea');
          textarea.value = jsonString;
          textarea.style.position = 'fixed';
          textarea.style.opacity = '0';
          document.body.appendChild(textarea);
          textarea.select();
          copied = document.execCommand('copy');
          document.body.removeChild(textarea);
        }
        
        if (copied) {
          toast.success('Diagnostics copied! Paste into the GitHub issue.');
        }
      } catch {
        toast.warning('Could not copy diagnostics. Please download and attach manually.');
      }
    } else {
      toast.info('Agent offline - please describe your hardware in the issue.');
    }
    
    // Open GitHub issue in new tab
    const issueUrl = `${GITHUB_REPO}/issues/new?title=${issueTitle}&labels=hardware-support&body=${issueBody}`;
    window.open(issueUrl, '_blank', 'noopener,noreferrer');
  };

  const onlineCount = systems.filter(s => s.real_time_status === 'online').length;
  const [isExportingAll, setIsExportingAll] = useState(false);

  const handleExportAll = async () => {
    const onlineSystems = systems.filter(s => s.real_time_status === 'online');
    if (onlineSystems.length === 0) return;

    setIsExportingAll(true);
    const results: { [name: string]: unknown } = {};
    
    for (const system of onlineSystems) {
      try {
        const response = await getDiagnostics(system.id);
        results[system.name] = response.diagnostics;
      } catch {
        results[system.name] = { error: 'Failed to fetch diagnostics' };
      }
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const jsonString = JSON.stringify(results, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `all-diagnostics-${timestamp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(`Exported ${onlineSystems.length} agent diagnostics`);
    setIsExportingAll(false);
  };

  // Report with all diagnostics - copies all and opens GitHub issue
  const [isReportingWithDiagnostics, setIsReportingWithDiagnostics] = useState(false);

  const handleReportWithDiagnostics = async () => {
    const onlineSystems = systems.filter(s => s.real_time_status === 'online');
    
    if (onlineSystems.length === 0) {
      toast.warning('No online agents to export diagnostics from.');
      return;
    }

    setIsReportingWithDiagnostics(true);
    const results: { [name: string]: unknown } = {};
    
    for (const system of onlineSystems) {
      try {
        const response = await getDiagnostics(system.id);
        results[system.name] = response.diagnostics;
      } catch {
        results[system.name] = { error: 'Failed to fetch diagnostics' };
      }
    }

    const jsonString = JSON.stringify(results, null, 2);
    
    // Copy to clipboard
    let copied = false;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(jsonString);
        copied = true;
      } catch {
        copied = false;
      }
    }
    
    if (!copied) {
      const textarea = document.createElement('textarea');
      textarea.value = jsonString;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      copied = document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    
    if (copied) {
      toast.success(`Diagnostics from ${onlineSystems.length} agents copied! Paste into the issue.`);
    } else {
      toast.warning('Could not copy to clipboard. Use Export All and attach the file.');
    }

    // Build issue template
    const issueTitle = encodeURIComponent(`[Bug Report] Fleet Issue - ${onlineSystems.length} Agents`);
    const issueBody = encodeURIComponent(
`## Fleet Information
- **Total Agents:** ${systems.length}
- **Online Agents:** ${onlineSystems.length}
- **Agents Included:** ${onlineSystems.map(s => s.name).join(', ')}

## Issue Description
<!-- Describe what's not working -->


## Hardware Diagnostics (All Agents)
<!-- Paste the JSON below (already copied to your clipboard) -->
\`\`\`json
<PASTE HERE>
\`\`\`

## Expected Behavior
<!-- What did you expect to happen? -->

`);

    const issueUrl = `${GITHUB_REPO}/issues/new?title=${issueTitle}&labels=bug&body=${issueBody}`;
    window.open(issueUrl, '_blank', 'noopener,noreferrer');
    setIsReportingWithDiagnostics(false);
  };

  const getPlatformIcon = (system: SystemInfo) => {
    const isWindows = system.platform === 'windows' || system.agent_id.toLowerCase().startsWith('windows-');
    return isWindows ? (
      <div className="platform-icon windows" title="Windows Agent">
        <img src="/icons/windows_01.svg" alt="Windows" width="14" height="14" />
      </div>
    ) : (
      <div className="platform-icon linux" title="Linux Agent">
        <img src="/icons/linux_01.svg" alt="Linux" width="14" height="14" />
      </div>
    );
  };

  /* Helper to check if system is windows */
  const isSystemWindows = (system: SystemInfo) => 
    system.platform === 'windows' || system.agent_id.toLowerCase().startsWith('windows-');

  /* Group systems by platform */
  const windowsSystems = systems.filter(isSystemWindows);
  const linuxSystems = systems.filter(s => !isSystemWindows(s));

  const renderDiagnosticsTable = (title: string, tableSystems: SystemInfo[], iconSrc: string) => (
    <div className="diagnostics-table-wrapper">
      <div className="table-header-row">
        <img src={iconSrc} alt={title} width="16" height="16" style={{ opacity: 0.7 }} />
        <h3 className="table-title">{title} <span className="count-badge">{tableSystems.length}</span></h3>
      </div>
      <table className="diagnostics-table">
        <thead>
          <tr>
            <th style={{ width: '40%' }}>System</th>
            <th style={{ width: '15%' }}>Status</th>
            <th style={{ width: '30%', textAlign: 'right' }}>Actions</th>
            <th style={{ width: '15%', textAlign: 'center' }}>Report</th>
          </tr>
        </thead>
        <tbody>
          {tableSystems.length > 0 ? (
            tableSystems.map(system => {
              const isOnline = system.real_time_status === 'online';
              const status = actionStatus[system.id];
              const statusLabel = isOnline ? 'ONLINE' : 'OFFLINE';
              const statusClass = isOnline ? 'online' : 'offline';

              return (
                <tr key={system.id}>
                  <td className="hostname-cell">
                    <div className="hostname-wrapper">
                      {getPlatformIcon(system)}
                      <div className="system-identity">
                        <span className="hostname-text">{system.name}</span>
                        <code className="agent-id-subtext">{system.agent_id}</code>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={`status-tag-v2 ${statusClass}`}>
                      <span className="status-dot" />
                      {statusLabel}
                    </span>
                  </td>
                  <td className="actions-cell">
                    <div className="actions-wrapper">
                      {status && (
                        <span className={`action-feedback ${status.type}`}>{status.message}</span>
                      )}
                      <button
                        className={`btn-table-action ${status?.type === 'loading' ? 'loading' : ''}`}
                        onClick={() => handleCopyToClipboard(system.id)}
                        disabled={!isOnline || status?.type === 'loading'}
                        title="Copy diagnostics to clipboard"
                      >
                        Copy
                      </button>
                      <button
                        className={`btn-table-action primary ${status?.type === 'loading' ? 'loading' : ''}`}
                        onClick={() => handleDownloadAsFile(system.id, system.name)}
                        disabled={!isOnline || status?.type === 'loading'}
                        title="Download diagnostics as JSON file"
                      >
                        Download
                      </button>
                    </div>
                  </td>
                  <td className="report-cell">
                    <button
                      className="btn-table-action report"
                      onClick={() => handleReportIssue(system)}
                      title="Report issue on GitHub (copies diagnostics to clipboard)"
                    >
                      <Bug size={12} />
                      Report
                    </button>
                  </td>
                </tr>
              );
            })
          ) : (
           <tr>
               <td colSpan={4} className="empty-table-cell">No {title.toLowerCase()} agents found.</td>
             </tr>
          )}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="settings-section">
      <div className="diagnostics-header">
        <div className="diagnostics-title-row">
          <h2>Diagnostics</h2>
          <span className="diagnostics-stats">
            {systems.length} System{systems.length !== 1 ? 's' : ''} • {onlineCount} Online
          </span>
        </div>
        {onlineCount > 0 && (
          <button
            className="btn-export-all"
            onClick={handleExportAll}
            disabled={isExportingAll}
          >
            {isExportingAll ? 'Exporting...' : 'Export All'}
          </button>
        )}
      </div>
      <p className="settings-info">
        Export hardware diagnostic data from connected agents for support and troubleshooting.
      </p>

      {/* GitHub Help Section */}
      <div className="diagnostics-help-section">
        <div className="help-section-header">
          <HelpCircle size={16} />
          <span>Need Help?</span>
        </div>
        
        <div className="help-actions">
          <a
            href={`${GITHUB_REPO}/issues/new?template=bug_report.md&labels=bug`}
            target="_blank"
            rel="noopener noreferrer"
            className="help-action-btn bug"
          >
            <Bug size={14} />
            Report Bug
          </a>
          <a
            href={`${GITHUB_REPO}/issues/new?template=feature_request.md&labels=enhancement`}
            target="_blank"
            rel="noopener noreferrer"
            className="help-action-btn feature"
          >
            <Lightbulb size={14} />
            Feature Request
          </a>
          <a
            href={`${GITHUB_REPO}/wiki`}
            target="_blank"
            rel="noopener noreferrer"
            className="help-action-btn docs"
          >
            <BookOpen size={14} />
            Documentation
          </a>
          <button
            onClick={handleReportWithDiagnostics}
            className="help-action-btn diagnostics"
            disabled={isReportingWithDiagnostics || onlineCount === 0}
            title={onlineCount === 0 ? 'No online agents' : 'Copies all diagnostics and opens GitHub issue'}
          >
            <Upload size={14} />
            {isReportingWithDiagnostics ? 'Exporting...' : 'Report + Diagnostics'}
          </button>
        </div>

        <p className="help-tip">
          <strong>Tip : </strong> <br />Download diagnostics from an online agent and attach to your GitHub issue for faster support.
        </p>
      </div>

      {loading ? (
        <p>Loading systems...</p>
      ) : systems.length === 0 ? (
        <div className="diagnostics-empty">
          No agents connected.
        </div>
      ) : (
        <div className="diagnostics-split-view">
          {renderDiagnosticsTable('LINUX Agents', linuxSystems, '/icons/linux_01.svg')}
          {renderDiagnosticsTable('WINDOWS Agents', windowsSystems, '/icons/windows_01.svg')}
        </div>
      )}
    </div>
  );
};


const AboutTab: React.FC = () => {
  const version = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
  
  return (
    <div className="settings-section about-overhaul">
      <div className="about-hero">
        <div className="about-hero-brand">
          <div className="about-logo-wrapper">
             <Wind className="about-logo-icon" size={40} />
          </div>
          <div className="about-hero-text">
            <h1>Pankha</h1>
            <div className="about-version-badge">
              <span className="version-label">VERSION:</span>
              <span className="version-code">{version}</span>
            </div>
          </div>
        </div>
        <p className="about-tagline">
          Heterogeneous hardware telemetry governor and thermal orchestration kernel. 
          Optimized for high-frequency PID-driven cooling topologies and mission-critical infrastructure stability.
        </p>
      </div>

      <div className="about-links-tactical">
        <a href="https://github.com/Anexgohan/pankha" target="_blank" rel="noopener noreferrer" className="link-card">
          <Github className="link-icon" size={20} />
          <div className="link-text">
            <span className="link-title">GitHub Repo</span>
            <span className="link-desc">Source code & active development</span>
          </div>
          <ExternalLink className="link-arrow" size={14} />
        </a>
        <a href="https://github.com/Anexgohan/pankha/wiki" target="_blank" rel="noopener noreferrer" className="link-card">
          <BookOpen className="link-icon" size={20} />
          <div className="link-text">
            <span className="link-title">Documentation</span>
            <span className="link-desc">Setup guides & technical wiki</span>
          </div>
          <ExternalLink className="link-arrow" size={14} />
        </a>
        <a href="https://github.com/Anexgohan/pankha/issues" target="_blank" rel="noopener noreferrer" className="link-card">
          <MessageSquare className="link-icon" size={20} />
          <div className="link-text">
            <span className="link-title">Report Issue</span>
            <span className="link-desc">Bugs, feature requests & support</span>
          </div>
          <ExternalLink className="link-arrow" size={14} />
        </a>
      </div>

      <div className="about-footer-info">
        <div className="footer-info-item">
          <ShieldCheck size={14} />
          <span>License: AGPL-3.0 / Commercial</span>
        </div>
        <div className="footer-info-item">
          <ExternalLink size={14} />
          <span>Built for Mission Critical Stability</span>
        </div>
      </div>
    </div>
  );
};

const Settings: React.FC = () => {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const { license, isLoading, refreshLicense } = useLicense();
  const [licenseKey, setLicenseKey] = useState('');
  const [licenseStatus, setLicenseStatus] = useState<{ success: boolean; message: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  // Billing period toggles for pricing cards
  const [proBilling, setProBilling] = useState<'monthly' | 'yearly'>('monthly');
  const [enterpriseBilling, setEnterpriseBilling] = useState<'monthly' | 'yearly'>('monthly');
  const [lifetimeTier, setLifetimeTier] = useState<'pro' | 'enterprise'>('pro');
  
  // Dynamic pricing from API
  const [pricing, setPricing] = useState<PricingData | null>(null);

  // General Settings from Context
  const { graphScale, updateGraphScale, dataRetentionDays, updateDataRetention, timezone } = useDashboardSettings();
  const [isCustomScale, setIsCustomScale] = useState(false);
  const [customScaleInput, setCustomScaleInput] = useState(graphScale.toString());
  const [isCustomRetention, setIsCustomRetention] = useState(false);
  const [customRetentionInput, setCustomRetentionInput] = useState(dataRetentionDays.toString());
  
  // Appearance state
  const { 
    accentColor, updateAccentColor,
    hoverTintColor, updateHoverTintColor
  } = useDashboardSettings();

  const tacticalPresets = [
    { name: 'Kaali', color: '#B61B4F' },
    { name: 'Cyber Blue', color: '#2196F3' },
    { name: 'Hazard Orange', color: '#FF9800' },
    { name: 'Bold Saffron', color: '#F0741E' },
    { name: 'Digital Violet', color: '#9C27B0' },
    { name: 'Cosmic Lavender', color: '#867CFF' },
    { name: 'Toxic Green', color: '#4CAF50' },
    { name: 'Mistic Water', color: '#4cacaf' },
  ];
  
  // Update custom inputs when global values change (e.g. from preset)
  useEffect(() => {
    setCustomScaleInput(graphScale.toString());
  }, [graphScale]);
  
  useEffect(() => {
    setCustomRetentionInput(dataRetentionDays.toString());
  }, [dataRetentionDays]);

  const scalePresets = [
    { label: '1h', value: 1 },
    { label: '6h', value: 6 },
    { label: '12h', value: 12 },
    { label: '24h', value: 24 },
    { label: '3d', value: 72 },
    { label: '1w', value: 168 },
  ];
  
  /**
   * Data Retention Presets
   * Options: 1d, 7d, 30d, 90d, 365d
   * Presets above license.retentionDays are disabled (grayed out)
   * The max limit comes from the SST via license API (not hardcoded)
   */
  const retentionPresets = [
    { label: '1d', value: 1 },
    { label: '7d', value: 7 },
    { label: '30d', value: 30 },
    { label: '90d', value: 90 },
    { label: '365d', value: 365 },
  ];
  
  // Max retention allowed by license tier (from SST via API)
  const maxRetentionDays = license?.retentionDays || 7;
  
  useEffect(() => {
    const fetchPricing = async () => {
      try {
        const data = await getPricing();
        setPricing(data);
      } catch (error) {
        console.error('Failed to fetch pricing:', error);
      }
    };
    fetchPricing();
  }, []);

  const handleCustomScaleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseInt(customScaleInput, 10);
    if (!isNaN(val) && val >= GRAPH_SCALE_MIN_HOURS && val <= GRAPH_SCALE_MAX_HOURS) {
      updateGraphScale(val);
      setIsCustomScale(false);
    }
  };

  const handleCustomRetentionSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseInt(customRetentionInput, 10);
    // Enforce license tier limit
    if (!isNaN(val) && val >= 1 && val <= maxRetentionDays) {
      updateDataRetention(val);
      setIsCustomRetention(false);
    }
  };

  const handleLicenseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!licenseKey.trim()) return;

    setIsSubmitting(true);
    setLicenseStatus(null);

    try {
      const result = await setLicense(licenseKey.trim());
      if (result.success) {
        setLicenseStatus({ success: true, message: `License activated: ${result.tier}` });
        setLicenseKey('');
        await refreshLicense();
      } else {
        setLicenseStatus({ success: false, message: result.error || 'Invalid license key' });
      }
    } catch (error) {
      setLicenseStatus({ success: false, message: 'Failed to validate license' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRemoveLicense = async () => {
    if (!confirm('Are you sure you want to remove your license? You will revert to the Free tier.')) {
      return;
    }

    try {
      setIsSubmitting(true);
      await deleteLicense();
      await refreshLicense();
      setLicenseStatus({ success: true, message: 'License removed. Reverted to Free tier.' });
    } catch (error) {
      setLicenseStatus({ success: false, message: 'Failed to remove license' });
    } finally {
      setIsSubmitting(false);
    }
  };

  /**
   * Sync license with license server to check for renewals
   */
  const handleSyncLicense = async () => {
    setIsSyncing(true);
    try {
      const response = await fetch('/api/license/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const result = await response.json();

      if (result.success) {
        setLicenseStatus({ success: true, message: result.changed ? 'License updated!' : 'License is up to date' });
        await refreshLicense();
      } else {
        setLicenseStatus({ success: false, message: result.error || 'Sync failed' });
      }
    } catch {
      setLicenseStatus({ success: false, message: 'Could not reach license server' });
    } finally {
      setIsSyncing(false);
    }
  };

  const formatLimit = (value: number) => {
    return value === -1 ? '∞' : value.toString();
  };

  /**
   * Format remaining time dynamically and return urgency level
   */
  const formatRemaining = (expiresAt: string | null): { text: string; urgency: 'normal' | 'caution' | 'critical' } => {
    if (!expiresAt) {
      return { text: 'Lifetime', urgency: 'normal' };
    }

    const now = new Date();
    const expires = new Date(expiresAt);
    const diffMs = expires.getTime() - now.getTime();
    
    if (diffMs <= 0) {
      return { text: 'Expired', urgency: 'critical' };
    }

    const totalDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    // Determine urgency
    let urgency: 'normal' | 'caution' | 'critical' = 'normal';
    if (totalDays <= 3) {
      urgency = 'critical';
    } else if (totalDays <= 7) {
      urgency = 'caution';
    }

    // Format based on duration
    if (totalDays < 30) {
      return { text: `${totalDays} day${totalDays !== 1 ? 's' : ''}`, urgency };
    }

    const years = Math.floor(totalDays / 365);
    const months = Math.floor((totalDays % 365) / 30);
    const days = totalDays % 30;

    const parts: string[] = [];
    if (years > 0) parts.push(`${years}y`);
    if (months > 0) parts.push(`${months}m`);
    if (days > 0 && years === 0) parts.push(`${days}d`);  // Only show days if less than a year

    return { text: parts.join(' '), urgency };
  };

  return (
    <div className="settings-container">
      <nav className="settings-tabs">
        <button
          className={`settings-tab ${activeTab === 'general' ? 'active' : ''}`}
          onClick={() => setActiveTab('general')}
        >
          General
        </button>
        <button
          className={`settings-tab ${activeTab === 'license' ? 'active' : ''}`}
          onClick={() => setActiveTab('license')}
        >
          Subscription
        </button>
        <button
          className={`settings-tab ${activeTab === 'diagnostics' ? 'active' : ''}`}
          onClick={() => setActiveTab('diagnostics')}
        >
          Diagnostics
        </button>
        <button
          className={`settings-tab ${activeTab === 'about' ? 'active' : ''}`}
          onClick={() => setActiveTab('about')}
        >
          About
        </button>
      </nav>

      <div className="settings-content">
        {/* General Tab */}
        {activeTab === 'general' && (
          <div className="settings-section">
            <h2>General Settings</h2>
            <p className="settings-info">
              Configure global dashboard preferences and display options.
            </p>
            
            <div className="settings-list">
              <div className="setting-item graph-scale-section">
                <div className="setting-info-wrapper">
                  <span className="setting-label">Graph Scale</span>
                  <span className="setting-description">
                    Adjust the historical data window for all dashboard sparklines.
                  </span>
                </div>
                
                <div className="scale-control-wrapper">
                  {!isCustomScale ? (
                    <div className="scale-presets">
                      {scalePresets.map((preset) => (
                        <button
                          key={preset.value}
                          className={`scale-preset-btn ${graphScale === preset.value ? 'active' : ''}`}
                          onClick={() => updateGraphScale(preset.value)}
                        >
                          {preset.label}
                        </button>
                      ))}
                      <button 
                        className={`scale-preset-btn custom ${!scalePresets.some(p => p.value === graphScale) ? 'active' : ''}`}
                        onClick={() => setIsCustomScale(true)}
                      >
                        {scalePresets.some(p => p.value === graphScale) ? 'Custom' : `${graphScale}h`}
                      </button>
                    </div>
                  ) : (
                    <form onSubmit={handleCustomScaleSubmit} className="scale-custom-form">
                      <input
                        type="number"
                        min={GRAPH_SCALE_MIN_HOURS}
                        max={GRAPH_SCALE_MAX_HOURS}
                        autoFocus
                        value={customScaleInput}
                        onChange={(e) => setCustomScaleInput(e.target.value)}
                        className="setting-input scale-input"
                      />
                      <span className="setting-unit">hours</span>
                      <button type="submit" className="scale-apply-btn">Apply</button>
                      <button 
                        type="button" 
                        className="scale-cancel-btn"
                        onClick={() => setIsCustomScale(false)}
                      >
                        ✕
                      </button>
                    </form>
                  )}
                </div>
              </div>
              
              {/* Data Retention Days Setting
                  Configurable within license tier limit.
                  Options above license.retentionDays are disabled (from SST via API) */}
              <div className="setting-item graph-scale-section">
                <div className="setting-info-wrapper">
                  <span className="setting-label">Data Retention</span>
                  <span className="setting-description">
                    Configure how many days of historical data to keep.
                    {maxRetentionDays < 365 && (
                      <span className="tier-limit-note"> (Your tier allows up to {maxRetentionDays} days)</span>
                    )}
                  </span>
                </div>
                
                <div className="scale-control-wrapper">
                  {!isCustomRetention ? (
                    <div className="scale-presets">
                      {retentionPresets.map((preset) => (
                        <button
                          key={preset.value}
                          className={`scale-preset-btn ${dataRetentionDays === preset.value ? 'active' : ''} ${preset.value > maxRetentionDays ? 'disabled' : ''}`}
                          onClick={() => preset.value <= maxRetentionDays && updateDataRetention(preset.value)}
                          disabled={preset.value > maxRetentionDays}
                          title={preset.value > maxRetentionDays ? `Requires ${preset.value > 90 ? 'Enterprise' : preset.value > 30 ? 'Pro+' : 'Pro'} tier` : undefined}
                        >
                          {preset.label}
                        </button>
                      ))}
                      <button 
                        className={`scale-preset-btn custom ${!retentionPresets.some(p => p.value === dataRetentionDays) ? 'active' : ''}`}
                        onClick={() => setIsCustomRetention(true)}
                      >
                        {retentionPresets.some(p => p.value === dataRetentionDays) ? 'Custom' : `${dataRetentionDays}d`}
                      </button>
                    </div>
                  ) : (
                    <form onSubmit={handleCustomRetentionSubmit} className="scale-custom-form">
                      <input
                        type="number"
                        min={1}
                        max={maxRetentionDays}
                        autoFocus
                        value={customRetentionInput}
                        onChange={(e) => setCustomRetentionInput(e.target.value)}
                        className="setting-input scale-input"
                      />
                      <span className="setting-unit">days (max {maxRetentionDays})</span>
                      <button type="submit" className="scale-apply-btn">Apply</button>
                      <button 
                        type="button" 
                        className="scale-cancel-btn"
                        onClick={() => setIsCustomRetention(false)}
                      >
                        ✕
                      </button>
                    </form>
                  )}
                </div>
              </div>
            </div>

            <div className="settings-section">
              <h3>Appearance</h3>
              <p className="settings-info">
                Personalize the dashboard color scheme and interaction feedback.
              </p>
              
              <div className="settings-list aesthetics-compact-list">
                <div className="setting-item aesthetics-row">
                  <span className="setting-label">Accent Color</span>
                  <div className="tactical-accent-picker">
                    <ColorPicker 
                      color={accentColor} 
                      onChange={updateAccentColor} 
                      label="Accent Color" 
                      presets={tacticalPresets}
                    />
                  </div>
                </div>

                <div className="setting-item aesthetics-row">
                  <span className="setting-label">Hover Tint</span>
                  <div className="tactical-accent-picker">
                    <ColorPicker 
                      color={hoverTintColor} 
                      onChange={updateHoverTintColor} 
                      label="Hover Tint" 
                      presets={tacticalPresets}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* License/Subscription Tab */}
        {activeTab === 'license' && (
          <div className="settings-section">
            <h2>Subscription</h2>
            
            {isLoading ? (
              <p>Loading license info...</p>
            ) : license ? (
              <>
                {/* Available Plans - First */}
                <div className="pricing-section">
                  <h3>Available Plans</h3>
                  <div className="pricing-cards">
                    {/* Free Plan */}
                    <div className={`pricing-card ${license.tier === 'Free' ? 'current' : ''}`}>
                      <div className="pricing-header">
                        <h4>Free</h4>
                        <div className="pricing-price">$0</div>
                        <div className="pricing-period">forever</div>
                      </div>
                      <ul className="pricing-features">
                        <li>{pricing?.free.agents || 3} Agents</li>
                        <li>{pricing?.free.retentionDays || 7} Days History</li>
                        <li>Critical Temp & Fan Fail Alerts</li>
                        <li>Dashboard & Email Notifications</li>
                      </ul>
                      {license.tier === 'Free' && <div className="current-plan-badge">Current Plan</div>}
                    </div>

                    {/* Pro Plan */}
                    <div className="pricing-card featured">
                      <div className="pricing-header">
                        <h4>Pro</h4>
                        <div className="pricing-toggle">
                          <button 
                            className={`toggle-btn ${proBilling === 'monthly' ? 'active' : ''}`}
                            onClick={() => setProBilling('monthly')}
                          >
                            Monthly
                          </button>
                          <button 
                            className={`toggle-btn ${proBilling === 'yearly' ? 'active' : ''}`}
                            onClick={() => setProBilling('yearly')}
                          >
                            Yearly
                          </button>
                        </div>
                        <div className="pricing-price">
                          ${proBilling === 'monthly' 
                            ? pricing?.pro.pricing.monthly || 5 
                            : pricing?.pro.pricing.yearly || 49}
                        </div>
                        <div className="pricing-period">
                          {proBilling === 'monthly' ? 'per month' : 'per year'}
                          {proBilling === 'yearly' && <span className="savings"> (save 18%)</span>}
                        </div>
                      </div>
                      <ul className="pricing-features">
                        <li>{pricing?.pro.agents || 10} Agents</li>
                        <li>{pricing?.pro.retentionDays || 30} Days History</li>
                        <li>Unlimited Alerts</li>
                        <li>All Notification Channels</li>
                        <li>Full API Access</li>
                      </ul>
                      {license.tier === 'Pro' && license.billing === proBilling ? (
                        <div className="current-plan-badge">Current Plan</div>
                      ) : license.tier === 'Pro' ? (
                        <a 
                          href={CHECKOUT_URLS.pro[proBilling]} 
                          target="_blank" 
                          rel="noopener noreferrer" 
                          className="pricing-buy-btn current-tier-btn"
                        >
                          Switch to {proBilling === 'monthly' ? 'Monthly' : 'Yearly'} (${proBilling === 'monthly' 
                            ? `${pricing?.pro.pricing.monthly || 5}/mo` 
                            : `${pricing?.pro.pricing.yearly || 49}/yr`})
                        </a>
                      ) : (
                        <a 
                          href={CHECKOUT_URLS.pro[proBilling]} 
                          target="_blank" 
                          rel="noopener noreferrer" 
                          className="pricing-buy-btn"
                        >
                          Get Pro (${proBilling === 'monthly' 
                            ? `${pricing?.pro.pricing.monthly || 5}/mo` 
                            : `${pricing?.pro.pricing.yearly || 49}/yr`})
                        </a>
                      )}
                    </div>

                    {/* Enterprise Plan */}
                    <div className="pricing-card">
                      <div className="pricing-header">
                        <h4>Enterprise</h4>
                        <div className="pricing-toggle">
                          <button 
                            className={`toggle-btn ${enterpriseBilling === 'monthly' ? 'active' : ''}`}
                            onClick={() => setEnterpriseBilling('monthly')}
                          >
                            Monthly
                          </button>
                          <button 
                            className={`toggle-btn ${enterpriseBilling === 'yearly' ? 'active' : ''}`}
                            onClick={() => setEnterpriseBilling('yearly')}
                          >
                            Yearly
                          </button>
                        </div>
                        <div className="pricing-price">
                          ${enterpriseBilling === 'monthly' 
                            ? pricing?.enterprise.pricing.monthly || 35 
                            : pricing?.enterprise.pricing.yearly || 249}
                        </div>
                        <div className="pricing-period">
                          {enterpriseBilling === 'monthly' ? 'per month' : 'per year'}
                          {enterpriseBilling === 'yearly' && <span className="savings"> (save 17%)</span>}
                        </div>
                      </div>
                      <ul className="pricing-features">
                        <li>Unlimited Agents</li>
                        <li>{pricing?.enterprise.retentionDays || 365} Days History</li>
                        <li>Unlimited Alerts</li>
                        <li>All Notification Channels</li>
                        <li>Full API Access</li>
                        <li>No Branding</li>
                      </ul>
                      {license.tier === 'Enterprise' && license.billing === enterpriseBilling ? (
                        <div className="current-plan-badge">Current Plan</div>
                      ) : license.tier === 'Enterprise' ? (
                        <a 
                          href={CHECKOUT_URLS.enterprise[enterpriseBilling]} 
                          target="_blank" 
                          rel="noopener noreferrer" 
                          className="pricing-buy-btn current-tier-btn"
                        >
                          Switch to {enterpriseBilling === 'monthly' ? 'Monthly' : 'Yearly'} (${enterpriseBilling === 'monthly' 
                            ? `${pricing?.enterprise.pricing.monthly || 35}/mo` 
                            : `${pricing?.enterprise.pricing.yearly || 249}/yr`})
                        </a>
                      ) : (
                        <a 
                          href={CHECKOUT_URLS.enterprise[enterpriseBilling]} 
                          target="_blank" 
                          rel="noopener noreferrer" 
                          className="pricing-buy-btn"
                        >
                          Get Enterprise (${enterpriseBilling === 'monthly' 
                            ? `${pricing?.enterprise.pricing.monthly || 35}/mo` 
                            : `${pricing?.enterprise.pricing.yearly || 249}/yr`})
                        </a>
                      )}
                    </div>

                    {/* Lifetime Plan */}
                    <div className="pricing-card lifetime">
                      <div className="pricing-badge best-value">BEST VALUE</div>
                      <div className="pricing-header">
                        <h4>Lifetime</h4>
                        <div className="pricing-toggle">
                          <button 
                            className={`toggle-btn ${lifetimeTier === 'pro' ? 'active' : ''}`}
                            onClick={() => setLifetimeTier('pro')}
                          >
                            Pro
                          </button>
                          <button 
                            className={`toggle-btn ${lifetimeTier === 'enterprise' ? 'active' : ''}`}
                            onClick={() => setLifetimeTier('enterprise')}
                          >
                            Enterprise
                          </button>
                        </div>
                        <div className="pricing-price">
                          ${lifetimeTier === 'pro' 
                            ? pricing?.pro.pricing.lifetime || 149 
                            : pricing?.enterprise.pricing.lifetime || 499}
                        </div>
                        <div className="pricing-period">one-time payment</div>
                      </div>
                      <ul className="pricing-features">
                        <li>Pay once, own forever</li>
                        <li>{lifetimeTier === 'pro' 
                          ? (pricing?.pro.agents || 10)
                          : (pricing?.enterprise.agents === -1 ? 'Unlimited' : pricing?.enterprise.agents || 'Unlimited')} Agents</li>
                        <li>{lifetimeTier === 'pro' 
                          ? (pricing?.pro.retentionDays || 30)
                          : (pricing?.enterprise.retentionDays || 365)} Days History</li>
                        <li>Unlimited Alerts</li>
                        <li>All Notification Channels</li>
                        <li>Full API Access</li>
                        {lifetimeTier === 'enterprise' && <li>No Branding</li>}
                      </ul>
                      {license.tier === (lifetimeTier === 'pro' ? 'Pro' : 'Enterprise') && license.billing === 'lifetime' ? (
                        <div className="current-plan-badge">Current Plan</div>
                      ) : (
                        <a 
                          href={CHECKOUT_URLS[lifetimeTier].lifetime} 
                          target="_blank" 
                          rel="noopener noreferrer" 
                          className="pricing-buy-btn lifetime-btn"
                        >
                          Get {lifetimeTier === 'pro' ? 'Pro' : 'Enterprise'} Lifetime ($
                          {lifetimeTier === 'pro' 
                            ? pricing?.pro.pricing.lifetime || 149 
                            : pricing?.enterprise.pricing.lifetime || 499})
                        </a>
                      )}
                    </div>
                  </div>
                </div>

                {/* Current Subscription - Second */}
                <h3>Your Subscription</h3>
                <div className="license-info">
                  <div className="tier-badges">
                    <div className={`tier-badge tier-${license.tier.toLowerCase()}`}>
                      {license.tier}
                    </div>
                    {license.billing && (
                      <div className="billing-badge">
                        {license.billing.charAt(0).toUpperCase() + license.billing.slice(1)}
                      </div>
                    )}
                  </div>
                  {/* Discount banner - only shows when active discount exists */}
                  {license.discountCode && (license.discountCyclesRemaining ?? 0) > 0 && (
                    <div className="discount-banner">
                      <Tag size={14} className="discount-icon" />
                      <span className="discount-text">
                        Promo <strong>{license.discountCode}</strong> applied · {license.discountCyclesRemaining} discounted renewal{license.discountCyclesRemaining !== 1 ? 's' : ''} remaining
                      </span>
                    </div>
                  )}
                  <div className="license-limits">
                    <div className="limit-item">
                      <span className="limit-label">Agents</span>
                      <span className="limit-value">{formatLimit(license.agentLimit)}</span>
                    </div>
                    <div className="limit-item">
                      <span className="limit-label">History</span>
                      <span className="limit-value">{license.retentionDays} days</span>
                    </div>
                    <div className="limit-item">
                      <span className="limit-label">Alerts</span>
                      <span className="limit-value">{formatLimit(license.alertLimit)}</span>
                    </div>
                    <div className="limit-item">
                      <span className="limit-label">API</span>
                      <span className="limit-value">{license.apiAccess === 'none' ? 'No' : license.apiAccess}</span>
                    </div>
                    {license.activatedAt && (
                      <div className="limit-item">
                        <span className="limit-label">Activated</span>
                        <div className="limit-value-group">
                          <span className="limit-value">{formatDate(license.activatedAt, timezone)}</span>
                          <span className="limit-subtext-date">{formatFriendlyDate(license.activatedAt, timezone)}</span>
                        </div>
                      </div>
                    )}
                    <div className="limit-item">
                      <span className="limit-label">Expires</span>
                      <div className="limit-value-group">
                        <span className="limit-value">
                          {license.expiresAt ? formatDate(license.expiresAt, timezone) : 'Lifetime'}
                        </span>
                        {license.expiresAt && (
                          <span className="limit-subtext-date">{formatFriendlyDate(license.expiresAt, timezone)}</span>
                        )}
                      </div>
                    </div>
                    {(() => {
                      const remaining = formatRemaining(license.expiresAt);
                      return (
                        <div className={`limit-item remaining-${remaining.urgency}`}>
                          <span className="limit-label">Remaining</span>
                          <div className="limit-value-group">
                            <span className="limit-value">{remaining.text}</span>
                            {/* Show "Renews {date}" for subscriptions, or nothing for lifetime */}
                            {license.billing !== 'lifetime' && license.nextBillingDate && (
                              <span className="limit-subtext-date">
                                Renews {formatFriendlyDate(license.nextBillingDate, timezone)}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>

                <form onSubmit={handleLicenseSubmit} className="license-form">
                  <h3>Enter License Key</h3>
                  <div className="license-input-group">
                    <input
                      type="text"
                      value={licenseKey}
                      onChange={(e) => setLicenseKey(e.target.value)}
                      placeholder="Paste your license token (eyJhbGciOiJSUzI1NiIs...)"
                      className="license-input"
                      disabled={isSubmitting}
                    />
                    <button 
                      type="submit" 
                      className="license-submit"
                      disabled={isSubmitting || !licenseKey.trim()}
                    >
                      {isSubmitting ? 'Validating...' : 'Activate'}
                    </button>
                    {license.tier !== 'Free' && (
                      <>
                        <button
                          type="button"
                          className="remove-license-btn"
                          onClick={handleRemoveLicense}
                          disabled={isSubmitting}
                        >
                          Remove
                        </button>
                        <button
                          type="button"
                          className="refresh-button"
                          onClick={handleSyncLicense}
                          disabled={isSyncing}
                          title="Check for license updates"
                          style={{ padding: 'var(--spacing-md)', minWidth: 'auto' }}
                        >
                          <svg
                            viewBox="0 0 24 24"
                            width="18"
                            height="18"
                            style={{
                              animation: isSyncing ? 'spin 1s linear infinite' : 'none',
                              display: 'block'
                            }}
                          >
                            <path
                              fill="currentColor"
                              d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"
                            />
                          </svg>
                        </button>
                      </>
                    )}
                  </div>
                  {licenseStatus && (
                    <p className={`license-status ${licenseStatus.success ? 'success' : 'error'}`}>
                      {licenseStatus.message}
                    </p>
                  )}
                </form>
              </>
            ) : (
              <p>Failed to load license info</p>
            )}
          </div>
        )}

        {/* Diagnostics Tab */}
        {activeTab === 'diagnostics' && (
          <DiagnosticsTab />
        )}

        {/* About Tab */}
        {activeTab === 'about' && (
          <AboutTab />
        )}
      </div>
    </div>
  );
};

export default Settings;

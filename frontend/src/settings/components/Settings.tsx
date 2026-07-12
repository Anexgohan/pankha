/**
 * Settings Component - Main settings page with tabs
 */

import React, { useState, useEffect } from 'react';
import { useLicense, type LicenseInfo } from '../../license';
import { PRIMARY_FONT_OPTIONS, SECONDARY_FONT_OPTIONS, FONT_SCALE_MIN, FONT_SCALE_MAX, FONT_SCALE_STEP, type UIPrimaryFontChoice, type UISecondaryFontChoice, ensureGoogleFontForOption, useDashboardSettings } from '../../contexts/DashboardSettingsContext';
import { Select, type SelectOption } from '../../components/ui/Select';
import { setLicense, getPricing, deleteLicense, getSystems, getDiagnostics } from '../../services/api';
import { formatDate, formatFriendlyDate, USER_TIMEZONE } from '../../utils/formatters';
import { toast } from '../../utils/toast';
import { useDemoMode } from '../../hooks/useDemoMode';
import ColorPicker from './ColorPicker';
import ThresholdStrip from './ThresholdStrip';
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
  Tag,
  ClipboardPaste,
  RotateCcw,
  Copy,
  Check,
  KeyRound,
  Clock,
  Flame,
  Eye,
  EyeOff,
  Trash2,
  RefreshCw,
  ChevronUp,
  ChevronDown,
  Monitor,
  Ban,
  TriangleAlert
} from 'lucide-react';
import '../styles/settings.css';

// Font dropdown rows: name in the UI font + a dimmed specimen in the option's
// own typeface (slot-appropriate: pangram for primary, numeric for mono)
interface FontOptionData {
  stack: string;
  specimen: string;
}

const PRIMARY_FONT_SPECIMEN = 'The quick brown fox jumps over the lazy dog';
const SECONDARY_FONT_SPECIMEN = '42.7°C · 1800 RPM';

const PRIMARY_FONT_SELECT_OPTIONS = PRIMARY_FONT_OPTIONS.map((o) => ({
  value: o.value,
  label: o.label,
  data: { stack: o.stack, specimen: PRIMARY_FONT_SPECIMEN } as FontOptionData,
}));
const SECONDARY_FONT_SELECT_OPTIONS = SECONDARY_FONT_OPTIONS.map((o) => ({
  value: o.value,
  label: o.label,
  data: { stack: o.stack, specimen: SECONDARY_FONT_SPECIMEN } as FontOptionData,
}));

function renderFontOption<V extends string>(opt: SelectOption<V>) {
  const data = opt.data as FontOptionData;
  return (
    <>
      <span className="font-option-name">{opt.label}</span>
      <span className="font-option-preview" style={{ fontFamily: data.stack }}>
        {data.specimen}
      </span>
    </>
  );
}

// Graph scale configuration constants
const GRAPH_SCALE_MIN_HOURS = 1;
const GRAPH_SCALE_MAX_HOURS = 720; // 30 days

// Site URLs
const PANKHA_SITE = 'https://pankha.app';
const GITHUB_REPO = 'https://github.com/Anexgohan/pankha';

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
  benefits: string[];
}

interface PricingData {
  free: TierPricing;
  pro: TierPricing;
  enterprise: TierPricing;
}

// Advertised discount data - populated from /api/license/promo (Worker → Dodo)
interface PromoOffer {
  code: string;
  name: string;
  amountPct: number;
  expiresAt: string | null;
  remaining: number | null;
  totalLimit: number | null;
  cycles: number | null;
  appliesTo: Array<{
    tier: 'pro' | 'enterprise';
    billing: 'monthly' | 'yearly' | 'lifetime';
    productId: string;
  }>;
}

interface PromoResponse {
  offers: PromoOffer[];
  fetchedAt: string | null;
}

// Period-claim badge label.
// Sourced from JWT pi/pc claims (Dodo payment_frequency_interval/count).
// Falls back to capitalised billing enum for legacy tokens that pre-date the claims.
// count=1 collapses to natural English ("Daily", "Monthly"); count>1 expands ("7 Days").
function formatPeriodBadge(
  interval: string | null,
  count: number | null,
  billingFallback: string | null
): string {
  if (interval && count && count > 0) {
    if (count === 1) {
      const map: Record<string, string> = {
        Day: 'Daily',
        Week: 'Weekly',
        Month: 'Monthly',
        Year: 'Yearly',
      };
      return map[interval] || `1 ${interval}`;
    }
    return `${count} ${interval}s`;
  }
  if (billingFallback) {
    return billingFallback.charAt(0).toUpperCase() + billingFallback.slice(1);
  }
  return '';
}

// 3-line tooltip showing local, UTC, and relative time for a date.
// Mirrors the format used by Dodo's dashboard:
//   Asia/Kolkata: May 12, 2026, 1:58:32 AM
//   UTC: May 11, 2026, 8:28:32 PM
//   in 8 hours
// Returns `fallback` when date is null/invalid (use for lifetime products etc.).
function formatDateTooltip(dateInput: string | null, fallback = ''): string {
  if (!dateInput) return fallback;
  const d = new Date(dateInput);
  if (Number.isNaN(d.getTime())) return fallback;

  const userTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const fmt: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  };

  const local = new Intl.DateTimeFormat('en-US', { ...fmt, timeZone: userTz }).format(d);
  const utc = new Intl.DateTimeFormat('en-US', { ...fmt, timeZone: 'UTC' }).format(d);

  // Relative - pick the best unit so values like "in 8 hours" or "2 days ago" feel natural
  const diffSec = (d.getTime() - Date.now()) / 1000;
  const absSec = Math.abs(diffSec);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  let rel: string;
  if (absSec < 45) rel = rtf.format(Math.round(diffSec), 'second');
  else if (absSec < 45 * 60) rel = rtf.format(Math.round(diffSec / 60), 'minute');
  else if (absSec < 22 * 3600) rel = rtf.format(Math.round(diffSec / 3600), 'hour');
  else if (absSec < 26 * 86400) rel = rtf.format(Math.round(diffSec / 86400), 'day');
  else if (absSec < 320 * 86400) rel = rtf.format(Math.round(diffSec / (30.44 * 86400)), 'month');
  else rel = rtf.format(Math.round(diffSec / (365.25 * 86400)), 'year');

  return `${userTz}: ${local}\nUTC: ${utc}\n${rel}`;
}

// Short relative-time phrase ("2 hours ago", "in 3 days") for inline use under
// the Account Details title. Same picker as formatDateTooltip's relative line
// so phrasing stays consistent across the panel and its tooltip.
function formatRelativeTime(dateInput: string | null): string {
  if (!dateInput) return '';
  const d = new Date(dateInput);
  if (Number.isNaN(d.getTime())) return '';
  const diffSec = (d.getTime() - Date.now()) / 1000;
  const absSec = Math.abs(diffSec);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (absSec < 45) return rtf.format(Math.round(diffSec), 'second');
  if (absSec < 45 * 60) return rtf.format(Math.round(diffSec / 60), 'minute');
  if (absSec < 22 * 3600) return rtf.format(Math.round(diffSec / 3600), 'hour');
  if (absSec < 26 * 86400) return rtf.format(Math.round(diffSec / 86400), 'day');
  if (absSec < 320 * 86400) return rtf.format(Math.round(diffSec / (30.44 * 86400)), 'month');
  return rtf.format(Math.round(diffSec / (365.25 * 86400)), 'year');
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

// productId → static checkout URL lookup. Used by handleCheckout to resolve
// the fallback URL when a Sessions API call fails or no discount is present.
const PRODUCT_TO_STATIC_URL: Record<string, string> = {
  [PRODUCT_IDS.pro.monthly]: CHECKOUT_URLS.pro.monthly,
  [PRODUCT_IDS.pro.yearly]: CHECKOUT_URLS.pro.yearly,
  [PRODUCT_IDS.pro.lifetime]: CHECKOUT_URLS.pro.lifetime,
  [PRODUCT_IDS.enterprise.monthly]: CHECKOUT_URLS.enterprise.monthly,
  [PRODUCT_IDS.enterprise.yearly]: CHECKOUT_URLS.enterprise.yearly,
  [PRODUCT_IDS.enterprise.lifetime]: CHECKOUT_URLS.enterprise.lifetime,
};

// Diagnostics Tab Component
interface SystemInfo {
  id: number;
  name: string;
  agent_id: string;
  status: string;
  real_time_status?: string;
  agent_version?: string;
  platform?: string;
  last_error?: string | null;
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

  const handleCopyToClipboard = async (systemId: number, systemName?: string) => {
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
        toast.success(`${systemName || 'Diagnostics'} diagnostics copied to clipboard`);
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
      toast.success(`${systemName} diagnostics downloaded`);
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

  const handleReportIssue = async (system: SystemInfo) => {
    const isOnline = system.real_time_status === 'online' || system.real_time_status === 'error';
    const platform = system.platform === 'windows' || system.agent_id.toLowerCase().startsWith('windows-') ? 'Windows' : 'Linux';

    const issueTitle = encodeURIComponent(`[Hardware Support] ${system.name} - ${platform}`);
    const issueBody = encodeURIComponent(
`## System Information
- **Name:** ${system.name}
- **Agent ID:** \`${system.agent_id}\`
- **Platform:** ${platform}
- **Agent Version:** ${system.agent_version || 'Unknown'}
- **Status:** ${system.real_time_status === 'error' ? 'Error' : (isOnline ? 'Online' : 'Offline')}

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

        let copied = false;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          try {
            await navigator.clipboard.writeText(jsonString);
            copied = true;
          } catch { copied = false; }
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
          toast.success(`${system.name} diagnostics copied to clipboard. Paste into the GitHub issue.`);
        }
      } catch {
        toast.warning('Could not fetch diagnostics. Please download and attach manually.');
      }
    } else {
      toast.info('Agent offline - please describe your hardware in the issue.');
    }

    const issueUrl = `${GITHUB_REPO}/issues/new?title=${issueTitle}&labels=hardware-support&body=${issueBody}`;
    window.open(issueUrl, '_blank', 'noopener,noreferrer');
  };

  const onlineCount = systems.filter(s => s.real_time_status === 'online' || s.real_time_status === 'error').length;
  const [isExportingAll, setIsExportingAll] = useState(false);

  const handleExportAll = async () => {
    const onlineSystems = systems.filter(s => s.real_time_status === 'online' || s.real_time_status === 'error');
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
    const onlineSystems = systems.filter(s => s.real_time_status === 'online' || s.real_time_status === 'error');
    
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

    // Copy diagnostics to clipboard
    let copied = false;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(jsonString);
        copied = true;
      } catch { copied = false; }
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
      toast.success(`Diagnostics from ${onlineSystems.length} agents copied to clipboard. Paste into the GitHub issue.`);
    } else {
      toast.warning('Could not copy to clipboard. Use Export All and attach the file.');
    }

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
              const isOnline = system.real_time_status === 'online' || system.real_time_status === 'error';
              const status = actionStatus[system.id];
              const statusLabel = system.real_time_status === 'error' ? 'ERROR' : (isOnline ? 'ONLINE' : 'OFFLINE');
              const statusClass = system.real_time_status === 'error' ? 'error' : (isOnline ? 'online' : 'offline');

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
                    <span
                      className={`status-tag-v2 ${statusClass}`}
                      title={system.real_time_status === 'error' && system.last_error
                        ? `Agent status is currently "ERROR"\n\nReason: ${system.last_error}`
                        : `Agent status is currently "${statusLabel}"`}
                    >
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
                        onClick={() => handleCopyToClipboard(system.id, system.name)}
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
            href={`${GITHUB_REPO}/issues/new?labels=bug&title=${encodeURIComponent('[Bug] ')}&body=${encodeURIComponent(
`## Bug Description
<!-- What happened? -->


## Steps to Reproduce
1.
2.
3.

## Expected Behavior
<!-- What did you expect to happen? -->


## Environment
- **Pankha Version:** ${__APP_VERSION__}
- **Browser:**
- **OS:**

## Screenshots / Logs
<!-- If applicable, add screenshots or paste relevant logs -->
`)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="help-action-btn bug"
          >
            <Bug size={14} />
            Report Bug
          </a>
          <a
            href={`${GITHUB_REPO}/issues/new?labels=enhancement&title=${encodeURIComponent('[Feature] ')}&body=${encodeURIComponent(
`## Feature Description
<!-- What would you like to see? -->


## Use Case
<!-- Why is this useful? What problem does it solve? -->


## Proposed Solution
<!-- How do you think this should work? -->


## Alternatives Considered
<!-- Any other approaches you've thought of? -->


## Screenshots / Mockups
<!-- If applicable, drag and drop images here to help illustrate your idea -->
`)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="help-action-btn feature"
          >
            <Lightbulb size={14} />
            Feature Request
          </a>
          <a
            href={`${PANKHA_SITE}/docs/`}
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
          Monitor temperatures and control fan speeds across all your machines from one dashboard.
          Pankha connects to distributed agents running on your systems, giving you real-time visibility and automated cooling management.
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
        <a href={`${PANKHA_SITE}/docs/`} target="_blank" rel="noopener noreferrer" className="link-card">
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
  const { isDemoMode } = useDemoMode();
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const { license, isLoading, refreshLicense } = useLicense();
  const [licenseKey, setLicenseKey] = useState('');
  const [licenseStatus, setLicenseStatus] = useState<{ success: boolean; message: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isRenewing, setIsRenewing] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  // Seat conflict (activation 409): holds the pending key + worker's verdict
  // so the modal can retry with forceSeat. null = modal closed.
  const [seatConflict, setSeatConflict] = useState<{ key: string; boundAt: string | null; canForce: boolean } | null>(null);

  // Billing period toggles for pricing cards
  const [proBilling, setProBilling] = useState<'monthly' | 'yearly'>('monthly');
  const [enterpriseBilling, setEnterpriseBilling] = useState<'monthly' | 'yearly'>('monthly');
  const [lifetimeTier, setLifetimeTier] = useState<'pro' | 'enterprise'>('pro');
  
  // Dynamic pricing from API
  const [pricing, setPricing] = useState<PricingData | null>(null);
  const [promo, setPromo] = useState<PromoResponse | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [tokenRevealed, setTokenRevealed] = useState(false);
  // Tracks which one-shot copy succeeded so the icon can flip to a check briefly.
  // Values: 'token' (license token field), 'account' (Copy All in Account Details).
  const [copiedTarget, setCopiedTarget] = useState<'token' | 'account' | null>(null);

  // General Settings from Context
  const { graphScale, updateGraphScale, dataRetentionDays, updateDataRetention, hardwarePruneDays, updateHardwarePruneDays, hubLogLevel, updateHubLogLevel, fanRecalDays, updateFanRecalDays } = useDashboardSettings();
  const [isCustomScale, setIsCustomScale] = useState(false);
  const [customScaleInput, setCustomScaleInput] = useState(graphScale.toString());
  const [isCustomRetention, setIsCustomRetention] = useState(false);
  const [customRetentionInput, setCustomRetentionInput] = useState(dataRetentionDays.toString());

  type ThresholdTab = 'global' | 'customise' | 'cpu' | 'gpu' | 'nvme' | 'mobo';
  const [activeThresholdType, setActiveThresholdType] = useState<ThresholdTab>('global');

  const {
    accentColor, updateAccentColor,
    hoverTintColor, updateHoverTintColor,
    primaryFont, updatePrimaryFont,
    secondaryFont, updateSecondaryFont,
    fontScale, updateFontScale,
    tempThresholds, updateTempThresholds,
    tempColors, updateTempColors,
    perTypeEnabled, setPerTypeEnabled,
    perTypeThresholds, updatePerTypeThresholds,
    resetTempDefaults,
  } = useDashboardSettings();

  const tacticalPresets = [
    { name: 'Kaali', color: '#B61B4F' },
    { name: 'Cyber Blue', color: '#2196F3' },
    { name: 'Hazard Orange', color: '#FF9800' },
    { name: 'Bold Saffron', color: '#F0741E' },
    { name: 'Digital Violet', color: '#9C27B0' },
    { name: 'Cosmic Lavender', color: '#867CFF' },
    { name: 'Toxic Green', color: '#4CAF50' },
    { name: 'Mistic Water', color: '#0FEEEE' },
  ];

  // Temperature-themed presets per status level. Kept short on purpose -
  // these guide the user toward sane hues, not give every shade.
  const tempColorPresets: Record<'normal' | 'caution' | 'warning' | 'critical', { name: string; color: string }[]> = {
    normal: [
      { name: 'Toxic Green', color: '#4CAF50' },
      { name: 'Emerald', color: '#00C853' },
      { name: 'Mint', color: '#2ECC71' },
      { name: 'Sage', color: '#66BB6A' },
    ],
    caution: [
      { name: 'Amber', color: '#FFCA28' },
      { name: 'Goldenrod', color: '#FFC107' },
      { name: 'Lemon', color: '#FDD835' },
      { name: 'Bold Saffron', color: '#F0741E' },
    ],
    warning: [
      { name: 'Hazard', color: '#FF7700' },
      { name: 'Hazard Orange', color: '#FF9800' },
      { name: 'Tangerine', color: '#FF6F00' },
      { name: 'Deep Orange', color: '#FF5722' },
    ],
    critical: [
      { name: 'Inferno', color: '#c80f0f' },
      { name: 'Crimson', color: '#F44336' },
      { name: 'Maroon', color: '#B71C1C' },
      { name: 'Vermilion', color: '#FF3C00' },
    ],
  };
  
  // Update custom inputs when global values change (e.g. from preset)
  useEffect(() => {
    setCustomScaleInput(graphScale.toString());
  }, [graphScale]);
  
  useEffect(() => {
    setCustomRetentionInput(dataRetentionDays.toString());
  }, [dataRetentionDays]);

  useEffect(() => {
    if (isDemoMode && activeTab === 'license') {
      setActiveTab('general');
    }
  }, [isDemoMode, activeTab]);

  // Load every font's stylesheet so the dropdown previews render honestly
  useEffect(() => {
    [...PRIMARY_FONT_OPTIONS, ...SECONDARY_FONT_OPTIONS].forEach(ensureGoogleFontForOption);
  }, []);

  // Tick once a minute so the "Grace - <countdown>" badge stays current on an
  // otherwise idle screen. Settings is React.memo'd (no longer re-renders on
  // sensor deltas), so without this the countdown would only recompute on a
  // license refetch. Runs only while a paid token hasn't fully expired (active
  // approaching expiry, or in grace); the interval is already ticking before the
  // time-based active->grace crossover, and unmounts with the Settings tab.
  const [, setGraceTick] = useState(0);
  useEffect(() => {
    const graceEnd = license?.graceExpiresAt ? new Date(license.graceExpiresAt).getTime() : null;
    if (graceEnd === null || Date.now() >= graceEnd) return; // lifetime/free, or fully expired: nothing to tick
    const id = setInterval(() => setGraceTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, [license?.expiresAt, license?.graceExpiresAt]);

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
  
  const prunePresets = [
    { label: '1d', value: 1, tooltip: 'Clean up undetected fans after 24 hours' },
    { label: '7d', value: 7, tooltip: 'Clean up undetected fans after 7 days' },
    { label: '30d', value: 30, tooltip: 'Clean up undetected fans after 30 days' },
    { label: 'Never', value: 0, tooltip: 'Never auto-clean. Manage fan records manually' },
  ];

  // Fan recalibration ladder (days; 0 = manual only).
  // label = open-menu text; data = closed-trigger text ("Every ...").
  const recalIntervalOptions: SelectOption<number>[] = [
    { value: 0, label: 'Manual only' },
    { value: 1, label: '1 day', data: 'Every day' },
    { value: 3, label: '3 days', data: 'Every 3 days' },
    { value: 7, label: '7 days (default)', data: 'Every 7 days (default)' },
    { value: 15, label: '15 days', data: 'Every 15 days' },
    { value: 30, label: '30 days', data: 'Every 30 days' },
    { value: 60, label: '2 months', data: 'Every 2 months' },
    { value: 90, label: '3 months', data: 'Every 3 months' },
    { value: 180, label: '6 months', data: 'Every 6 months' },
    { value: 365, label: '1 year', data: 'Every year' },
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
    const fetchPromo = async () => {
      try {
        const r = await fetch('/api/license/promo');
        if (r.ok) {
          setPromo(await r.json());
        }
      } catch {
        // graceful no-op: empty banner on failure
      }
    };
    fetchPricing();
    fetchPromo();
  }, []);

  // Find the highest-amount discount applicable to a (tier, billing) card.
  // Returns null if no discount applies. Used for per-card strikethrough +
  // discount-aware checkout button.
  const discountForCard = (
    promoData: PromoResponse | null,
    tier: 'pro' | 'enterprise',
    billing: 'monthly' | 'yearly' | 'lifetime'
  ): PromoOffer | null => {
    if (!promoData || !promoData.offers.length) return null;
    const matches = promoData.offers.filter((o) =>
      o.appliesTo.some((a) => a.tier === tier && a.billing === billing)
    );
    if (!matches.length) return null;
    return matches.reduce((best, cur) => (cur.amountPct > best.amountPct ? cur : best));
  };

  const productIdForCard = (
    tier: 'pro' | 'enterprise',
    billing: 'monthly' | 'yearly' | 'lifetime'
  ): string | undefined => {
    const offer = discountForCard(promo, tier, billing);
    if (!offer) return undefined;
    const match = offer.appliesTo.find((a) => a.tier === tier && a.billing === billing);
    return match?.productId;
  };

  // Copy a discount code to the clipboard, briefly flip the icon to a check.
  // navigator.clipboard only works in secure contexts (HTTPS / localhost), so
  // fall back to a legacy textarea + execCommand path for http://<lan-ip>:port
  // dev/self-hosted deployments. Surface failure via toast so the user knows.
  const copyDiscountCode = async (code: string) => {
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
        ok = true;
      } else {
        const ta = document.createElement('textarea');
        ta.value = code;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '0';
        ta.style.left = '0';
        ta.style.opacity = '0';
        ta.style.pointerEvents = 'none';
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, ta.value.length);
        ok = document.execCommand('copy');
        document.body.removeChild(ta);
      }
    } catch {
      ok = false;
    }
    if (ok) {
      setCopiedCode(code);
      setTimeout(() => setCopiedCode((c) => (c === code ? null : c)), 2000);
    } else {
      toast.error('Could not copy code. Select and copy manually.');
    }
  };

  // Copy arbitrary text using the same secure-context fallback strategy as
  // copyDiscountCode. `target` keys the brief icon-flip on the calling button.
  const copyToClipboard = async (text: string, target: 'token' | 'account'): Promise<void> => {
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        ok = true;
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '0';
        ta.style.left = '0';
        ta.style.opacity = '0';
        ta.style.pointerEvents = 'none';
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, ta.value.length);
        ok = document.execCommand('copy');
        document.body.removeChild(ta);
      }
    } catch {
      ok = false;
    }
    if (ok) {
      setCopiedTarget(target);
      setTimeout(() => setCopiedTarget((t) => (t === target ? null : t)), 1500);
    } else {
      toast.error('Could not copy. Select and copy manually.');
    }
  };

  // Mask a token to first 24 + dots + last 12 chars for the default hidden view.
  const maskToken = (t: string): string => {
    if (t.length <= 40) return t;
    return `${t.slice(0, 24)}${'.'.repeat(12)}${t.slice(-12)}`;
  };

  // Per-field reveal for the other sensitive Account Details values (email,
  // IDs, discount code). Hidden by default, same rationale as the token.
  const [revealedFields, setRevealedFields] = useState<Set<string>>(new Set());
  const toggleFieldReveal = (key: string) => {
    setRevealedFields((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Short-value mask: first 4 + dots + last 4 (tokens use maskToken above).
  const maskValue = (v: string): string =>
    v.length <= 8 ? '.'.repeat(8) : `${v.slice(0, 4)}${'.'.repeat(6)}${v.slice(-4)}`;

  // Compose Account Details as plain text for the "Copy All" button. The token
  // is intentionally excluded - users with paranoid clipboards / screen-share
  // contexts can copy it separately via the dedicated token copy button.
  const composeAccountDetails = (info: LicenseInfo): string => {
    const lines: string[] = ['Account Details'];
    if (info.customerName) lines.push(`Name: ${info.customerName}`);
    if (info.customerEmail) lines.push(`Email: ${info.customerEmail}`);
    if (info.licenseId) lines.push(`License ID: ${info.licenseId}`);
    if (info.subscriptionId) lines.push(`Subscription ID: ${info.subscriptionId}`);
    if (info.customerId) lines.push(`Customer ID: ${info.customerId}`);
    if (info.instanceId) lines.push(`System ID: ${info.instanceId}`);
    if (info.discountCode) {
      const cycles = info.discountCyclesRemaining;
      const cyclesPart = cycles != null && cycles > 0 ? `, ${cycles} cycles remaining` : '';
      lines.push(`Discount: ${info.discountCode}${cyclesPart}`);
    }
    if (info.lastSyncAt) {
      lines.push(`Last Synced: ${formatFriendlyDate(info.lastSyncAt, USER_TIMEZONE)}`);
    }
    return lines.join('\n');
  };

  // Click handler for "Get Pro/Enterprise" buttons. With a discount code,
  // calls backend /checkout to get a Dodo Sessions URL with discount
  // pre-applied. Without a discount, opens the static Dodo URL directly.
  // Any backend/network failure on the discounted path falls back to the
  // static URL so the customer can always complete a purchase.
  const handleCheckout = async (productId: string, discountCode?: string) => {
    const fallbackUrl = PRODUCT_TO_STATIC_URL[productId];
    if (!discountCode) {
      if (fallbackUrl) window.open(fallbackUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    try {
      const r = await fetch('/api/license/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId,
          discountCode,
          returnUrl: `${window.location.origin}/settings?tab=license`,
        }),
      });
      const data = await r.json();
      if (data.ok && data.checkoutUrl) {
        window.open(data.checkoutUrl, '_blank', 'noopener,noreferrer');
        return;
      }
      console.warn('[checkout] backend returned error, falling back to static URL', data);
    } catch (e) {
      console.warn('[checkout] request failed, falling back to static URL', e);
    }
    if (fallbackUrl) window.open(fallbackUrl, '_blank', 'noopener,noreferrer');
  };

  // Build per-card "Save X% for Y months" caption. Uses the active billing
  // toggle so phrasing is natural ("for 7 months" on monthly, "for 7 years"
  // on yearly), falling back to "for X cycles" when ambiguous.
  const buildSavingsLine = (offer: PromoOffer, billing: 'monthly' | 'yearly' | 'lifetime'): string => {
    const head = `Save ${offer.amountPct}%`;
    if (offer.cycles == null) return head;
    if (billing === 'monthly') {
      return `${head} for ${offer.cycles} ${offer.cycles === 1 ? 'month' : 'months'}`;
    }
    if (billing === 'yearly') {
      return `${head} for ${offer.cycles} ${offer.cycles === 1 ? 'year' : 'years'}`;
    }
    return `${head} for ${offer.cycles} ${offer.cycles === 1 ? 'cycle' : 'cycles'}`;
  };

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

  /**
   * Activate a key. On 409 seat_taken the worker says the license is bound to
   * another system - open the conflict dialog instead of failing; the dialog
   * retries with forceSeat (worker-enforced: 2 moves/7 days, owner emailed).
   */
  const activateKey = async (key: string, forceSeat = false) => {
    setIsSubmitting(true);
    setLicenseStatus(null);

    try {
      const result = await setLicense(key, forceSeat);
      if (result.success) {
        setLicenseStatus({ success: true, message: `License activated: ${result.tier}` });
        setLicenseKey('');
        setSeatConflict(null);
        await refreshLicense();
      } else if (result.seatConflict) {
        setSeatConflict({ key, boundAt: result.boundAt ?? null, canForce: result.canForce === true });
      } else {
        setLicenseStatus({ success: false, message: result.error || 'Invalid license key' });
      }
    } catch {
      setLicenseStatus({ success: false, message: 'Failed to validate license' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLicenseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!licenseKey.trim()) return;
    await activateKey(licenseKey.trim());
  };

  /** Force-move retry from the conflict dialog (or seat-lost banner via stored token). */
  const handleForceMove = async () => {
    if (!seatConflict) return;
    await activateKey(seatConflict.key, true);
  };

  /**
   * Schedule cancel-at-period-end via backend /cancel proxy. Access continues
   * until the paid-through date; UI flips to "Cancellation scheduled".
   */
  const handleCancelSubscription = async () => {
    const until = license?.expiresAt ? formatFriendlyDate(license.expiresAt, USER_TIMEZONE) : 'the end of the current billing period';
    if (!confirm(`Cancel your subscription?\n\nYour ${license?.tier} features stay active until ${until}. No further charges after that.`)) {
      return;
    }

    setIsCancelling(true);
    try {
      const response = await fetch('/api/license/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const result = await response.json();

      if (result.success) {
        const accessUntil = result.accessUntil ? formatFriendlyDate(result.accessUntil, USER_TIMEZONE) : until;
        setLicenseStatus({ success: true, message: `Cancellation scheduled. Access continues until ${accessUntil}.` });
        await refreshLicense();
      } else {
        setLicenseStatus({ success: false, message: result.error || 'Cancellation failed. Please try again or contact support.' });
      }
    } catch {
      setLicenseStatus({ success: false, message: 'Could not reach license server. Check your internet connection.' });
    } finally {
      setIsCancelling(false);
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
    } catch {
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
    const wasExpired = license?.tier === 'Free' && !!license?.licenseId;
    try {
      const response = await fetch('/api/license/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const result = await response.json();

      if (result.success) {
        let message: string;
        if (result.upgraded) {
          message = 'License renewed! Your subscription is active again.';
        } else if (result.changed) {
          message = 'License updated - new expiry applied.';
        } else if (wasExpired) {
          message = 'No renewal available yet. If you paid recently, give it a minute and try again, or check your email for the renewal token.';
        } else {
          message = 'License is up to date.';
        }
        setLicenseStatus({ success: true, message });
        await refreshLicense();
      } else {
        const err = result.error || '';
        let message: string;
        if (err === 'Timeout') {
          message = 'License server did not respond in time. Check your internet connection and try again.';
        } else if (err === 'License not found') {
          message = 'This license isn\'t recognized by our server. Please contact support@pankha.app and include your license ID.';
        } else if (err === 'License server error') {
          message = 'License server returned an error. Please try again in a few minutes.';
        } else {
          message = err || 'Sync failed.';
        }
        setLicenseStatus({ success: false, message });
      }
    } catch {
      setLicenseStatus({ success: false, message: 'Could not reach license server. Check your internet connection.' });
    } finally {
      setIsSyncing(false);
    }
  };

  /**
   * Force-renew license via worker /renew (vendor-independent recovery).
   * Used when Sync alone can't recover the license - e.g., Dodo's webhook
   * never fired but the customer paid. Subject to 15min cooldown + 3/day cap.
   */
  const handleRenewLicense = async () => {
    setIsRenewing(true);
    try {
      const response = await fetch('/api/license/renew', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const result = await response.json();

      if (result.success) {
        const message = result.changed
          ? 'License refreshed from server.'
          : 'License is up to date.';
        setLicenseStatus({ success: true, message });
        await refreshLicense();
      } else {
        let message: string;
        if (result.isRateLimited) {
          message = result.error || 'You can only Renew 3 times per day. Try again later.';
        } else if (result.error === 'Timeout') {
          message = 'License server did not respond in time. Check your internet connection and try again.';
        } else if (result.error === 'No license token to renew' || result.error === 'No stored license token') {
          message = 'No license token on file to renew. Please activate a token first.';
        } else {
          message = result.error || 'Renew failed.';
        }
        setLicenseStatus({ success: false, message });
      }
    } catch {
      setLicenseStatus({ success: false, message: 'Could not reach license server. Check your internet connection.' });
    } finally {
      setIsRenewing(false);
    }
  };

  // Renew is enabled when the local license is in a state Sync alone may not recover:
  //  1. Demoted to Free with a licenseId on file (hard-expired past 3-day grace)
  //  2. Token's exp has passed (covers the 3-day grace window before validator demotes)
  // Disabled otherwise - Sync handles the normal path.
  const canRenew = !!license?.licenseId && (
    license.tier === 'Free' ||
    (!!license.expiresAt && new Date(license.expiresAt).getTime() < Date.now())
  );

  const formatLimit = (value: number) => {
    return value === -1 ? '∞' : value.toString();
  };

  /**
   * Format remaining time dynamically and return urgency level. Three states:
   *  - Active: time left until token exp (green/amber/red by closeness)
   *  - Grace:  exp passed but still within the offline grace window (amber),
   *            "Grace - <Xd/Xh/Xm left>", with a grace-end tooltip
   *  - Expired: past grace (red)
   */
  const formatRemaining = (
    expiresAt: string | null,
    graceExpiresAt: string | null
  ): { text: string; urgency: 'normal' | 'caution' | 'critical'; tooltip?: string } => {
    if (!expiresAt) {
      return { text: 'Lifetime', urgency: 'normal' };
    }

    const now = new Date();
    const expires = new Date(expiresAt);
    const diffMs = expires.getTime() - now.getTime();

    if (diffMs <= 0) {
      // Past token exp: still entitled while within grace, hard-expired after.
      const graceEnd = graceExpiresAt ? new Date(graceExpiresAt) : null;
      const graceMs = graceEnd ? graceEnd.getTime() - now.getTime() : 0;
      if (graceEnd && graceMs > 0) {
        const mins = Math.floor(graceMs / (1000 * 60));
        const left = mins >= 1440
          ? `${Math.floor(mins / 1440)}d left`
          : mins >= 60
            ? `${Math.floor(mins / 60)}h left`
            : `${Math.max(1, mins)}m left`;
        return {
          text: `Grace - ${left}`,
          urgency: 'caution',
          tooltip: `Grace period ends ${formatDateTooltip(graceExpiresAt)}`,
        };
      }
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
        {!isDemoMode && (
          <button
            className={`settings-tab ${activeTab === 'license' ? 'active' : ''}`}
            onClick={() => setActiveTab('license')}
          >
            Subscription
          </button>
        )}
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
            <h2>General</h2>
            <p className="settings-info">
              Configure global dashboard preferences and display options.
            </p>

            <div className="settings-groups">
              <div className="settings-group">
                <div className="settings-group-header">
                  <h3 className="settings-group-title">GUI Settings</h3>
                  <p className="settings-group-info">
                    Dashboard presentation and interaction preferences.
                  </p>
                </div>

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

            </div>
              </div>

              <div className="settings-group">
                <div className="settings-group-header">
                  <h3 className="settings-group-title">Backend Settings</h3>
                  <p className="settings-group-info">
                    Server-side data retention and hardware cleanup behavior.
                  </p>
                </div>

                <div className="settings-list">
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

              {/* Hardware Pruning Setting
                  Controls when stale fan/sensor records are marked inactive.
                  Data is preserved for reactivation if hardware returns. */}
              <div className="setting-item graph-scale-section">
                <div className="setting-info-wrapper">
                  <span className="setting-label">Hardware Pruning</span>
                  <span className="setting-description">
                    Automatically clean up fans no longer detected on your systems. Records are preserved if hardware returns.
                  </span>
                </div>

                <div className="scale-control-wrapper">
                  <div className="scale-presets">
                    {prunePresets.map((preset) => (
                      <button
                        key={preset.value}
                        className={`scale-preset-btn ${hardwarePruneDays === preset.value ? 'active' : ''}`}
                        onClick={() => updateHardwarePruneDays(preset.value)}
                        title={preset.tooltip}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Fan Recalibration Setting
                  How often calibrated fans are automatically re-measured. */}
              <div className="setting-item graph-scale-section">
                <div className="setting-info-wrapper">
                  <span className="setting-label">Fan Recalibration</span>
                  <span className="setting-description">
                    How often each fan is automatically re-measured to keep its speed curve accurate.
                  </span>
                </div>

                <div className="scale-control-wrapper">
                  <Select<number>
                    className="recal-select"
                    value={fanRecalDays}
                    onChange={updateFanRecalDays}
                    options={recalIntervalOptions}
                    renderTrigger={(sel) => (sel ? ((sel.data as string) ?? sel.label) : null)}
                    ariaLabel="Fan recalibration interval"
                  />
                </div>
              </div>

              {/* Hub Log Level Setting
                  Controls backend/hub process log verbosity at runtime. */}
              <div className="setting-item graph-scale-section">
                <div className="setting-info-wrapper">
                  <span className="setting-label">Log Level</span>
                  <span className="setting-description">
                    Controls backend log verbosity. Higher levels include all lower levels.
                  </span>
                </div>

                <div className="scale-control-wrapper">
                  <div className="scale-presets">
                    {(['error', 'warn', 'info', 'debug', 'trace'] as const).map((level) => (
                      <button
                        key={level}
                        className={`scale-preset-btn ${hubLogLevel === level ? 'active' : ''}`}
                        onClick={() => updateHubLogLevel(level)}
                        title={
                          level === 'error' ? 'Errors only' :
                          level === 'warn' ? 'Warnings and errors' :
                          level === 'info' ? 'General operational info (default)' :
                          level === 'debug' ? 'Detailed debug output' :
                          'Ultra-detailed trace output'
                        }
                      >
                        {level.charAt(0).toUpperCase() + level.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

            </div>
              </div>

              <div className="settings-group settings-group-appearance">
                <div className="settings-group-header">
                  <h3 className="settings-group-title">Appearance</h3>
                  <p className="settings-group-info">
                    Theme colors, typography, and temperature status styling.
                  </p>
                </div>

                <div className="settings-list">

                  {/* Accent Color */}
                  <div className="setting-item">
                    <div className="setting-info-wrapper">
                      <span className="setting-label">Accent Color</span>
                      <span className="setting-description">
                        Primary brand color - buttons, focus rings, tab underlines, active states.
                      </span>
                    </div>
                    <div className="appearance-color-control">
                      <div className="appearance-color-presets">
                        {tacticalPresets.map((p) => (
                          <button
                            key={p.color}
                            type="button"
                            className={`appearance-color-preset ${accentColor.toLowerCase() === p.color.toLowerCase() ? 'active' : ''}`}
                            style={{ backgroundColor: p.color }}
                            title={p.name}
                            onClick={() => updateAccentColor(p.color)}
                            aria-label={`Accent: ${p.name}`}
                          />
                        ))}
                      </div>
                      <span className="appearance-color-divider" aria-hidden />
                      <ColorPicker
                        color={accentColor}
                        onChange={updateAccentColor}
                        label="Accent Color"
                        presets={tacticalPresets}
                      />
                    </div>
                  </div>

                  {/* Hover Tint */}
                  <div className="setting-item">
                    <div className="setting-info-wrapper">
                      <span className="setting-label">Hover Tint</span>
                      <span className="setting-description">
                        Bloom color that washes over rows and controls on mouse-over.
                      </span>
                    </div>
                    <div className="appearance-color-control">
                      <div className="appearance-color-presets">
                        {tacticalPresets.map((p) => (
                          <button
                            key={p.color}
                            type="button"
                            className={`appearance-color-preset ${hoverTintColor.toLowerCase() === p.color.toLowerCase() ? 'active' : ''}`}
                            style={{ backgroundColor: p.color }}
                            title={p.name}
                            onClick={() => updateHoverTintColor(p.color)}
                            aria-label={`Hover: ${p.name}`}
                          />
                        ))}
                      </div>
                      <span className="appearance-color-divider" aria-hidden />
                      <ColorPicker
                        color={hoverTintColor}
                        onChange={updateHoverTintColor}
                        label="Hover Tint"
                        presets={tacticalPresets}
                      />
                    </div>
                  </div>

                  {/* Primary Font */}
                  <div className="setting-item">
                    <div className="setting-info-wrapper">
                      <span className="setting-label">Primary Font</span>
                      <span className="setting-description">
                        The interface body font. Used for everything except numeric monospace areas.
                      </span>
                    </div>
                    <div className="appearance-font-control">
                      <span
                        className="appearance-font-sample"
                        style={{ fontFamily: PRIMARY_FONT_OPTIONS.find((o) => o.value === primaryFont)?.stack }}
                      >
                        <span>THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG</span>
                        <span>the quick brown fox jumps over the lazy dog</span>
                      </span>
                      <Select<UIPrimaryFontChoice>
                        className="font-select"
                        menuClassName="font-select-menu"
                        value={primaryFont}
                        onChange={updatePrimaryFont}
                        options={PRIMARY_FONT_SELECT_OPTIONS}
                        renderOption={renderFontOption}
                        ariaLabel="Primary font"
                      />
                    </div>
                  </div>

                  {/* Secondary Font */}
                  <div className="setting-item">
                    <div className="setting-info-wrapper">
                      <span className="setting-label">Secondary Font</span>
                      <span className="setting-description">
                        Monospace face - temperatures, fan speeds, hex codes, code blocks.
                      </span>
                    </div>
                    <div className="appearance-font-control">
                      <span
                        className="appearance-font-sample"
                        style={{ fontFamily: SECONDARY_FONT_OPTIONS.find((o) => o.value === secondaryFont)?.stack }}
                      >
                        <span>42.7°C · 1800 RPM · 0xDEADBEEF</span>
                      </span>
                      <Select<UISecondaryFontChoice>
                        className="font-select"
                        menuClassName="font-select-menu"
                        value={secondaryFont}
                        onChange={updateSecondaryFont}
                        options={SECONDARY_FONT_SELECT_OPTIONS}
                        renderOption={renderFontOption}
                        ariaLabel="Secondary font"
                      />
                    </div>
                  </div>

                  {/* Font Size */}
                  <div className="setting-item">
                    <div className="setting-info-wrapper">
                      <span className="setting-label">Font Size</span>
                      <span className="setting-description">
                        Scales all interface text. Click the value to reset.
                      </span>
                    </div>
                    <div className="font-scale-control">
                      <button
                        type="button"
                        className="font-scale-btn"
                        onClick={() => updateFontScale(fontScale - FONT_SCALE_STEP)}
                        disabled={fontScale <= FONT_SCALE_MIN}
                        aria-label="Decrease font size"
                      >
                        <ChevronDown size={14} />
                      </button>
                      <button
                        type="button"
                        className="font-scale-value"
                        onClick={() => updateFontScale(1)}
                        title="Reset to 100%"
                      >
                        {Math.round(fontScale * 100)}%
                      </button>
                      <button
                        type="button"
                        className="font-scale-btn"
                        onClick={() => updateFontScale(fontScale + FONT_SCALE_STEP)}
                        disabled={fontScale >= FONT_SCALE_MAX}
                        aria-label="Increase font size"
                      >
                        <ChevronUp size={14} />
                      </button>
                    </div>
                  </div>

                  {/* Temperature Thresholds - wide row */}
                  {(() => {
                    const isTypeTab =
                      activeThresholdType === 'cpu' ||
                      activeThresholdType === 'gpu' ||
                      activeThresholdType === 'nvme' ||
                      activeThresholdType === 'mobo';
                    const isCustomiseTab = activeThresholdType === 'customise';
                    const typeTabsVisible = isCustomiseTab || isTypeTab;

                    const activeThresholds = isTypeTab
                      ? (perTypeThresholds[activeThresholdType] ?? { ...tempThresholds })
                      : tempThresholds;

                    const updateActiveThresholds = (next: typeof tempThresholds) => {
                      if (isTypeTab) {
                        if (!perTypeEnabled) setPerTypeEnabled(true);
                        updatePerTypeThresholds({ ...perTypeThresholds, [activeThresholdType]: next });
                      } else if (activeThresholdType === 'global') {
                        updateTempThresholds(next);
                      }
                      // 'customise' is a meta-tab - drag/edits are disabled until a type is picked.
                    };

                    const handleTabClick = (key: ThresholdTab) => {
                      if (key === 'global') {
                        setPerTypeEnabled(false);
                      } else if (key === 'customise') {
                        setPerTypeEnabled(true);
                      } else {
                        if (!perTypeEnabled) setPerTypeEnabled(true);
                      }
                      setActiveThresholdType(key);
                    };

                    const baseTabs: { key: ThresholdTab; label: string }[] = [
                      { key: 'global', label: 'Global' },
                      { key: 'customise', label: 'Customise' },
                    ];
                    const typeTabs: { key: ThresholdTab; label: string }[] = [
                      { key: 'cpu', label: 'CPU' },
                      { key: 'gpu', label: 'GPU' },
                      { key: 'nvme', label: 'NVMe' },
                      { key: 'mobo', label: 'Mobo' },
                    ];

                    return (
                      <div className="setting-item appearance-threshold-item">
                        <div className="appearance-threshold-head">
                          <div className="setting-info-wrapper">
                            <span className="setting-label">Temperature Thresholds</span>
                            <span className="setting-description">
                              Where sensors flip from normal → caution → warning → critical on the dashboard.
                            </span>
                          </div>
                          <div className="scale-presets appearance-threshold-tabs" role="tablist" aria-label="Threshold scope">
                            {baseTabs.map(({ key, label }) => (
                              <button
                                key={key}
                                type="button"
                                role="tab"
                                aria-selected={activeThresholdType === key}
                                className={`scale-preset-btn ${activeThresholdType === key ? 'active' : ''}`}
                                onClick={() => handleTabClick(key)}
                              >
                                {label}
                              </button>
                            ))}
                            {typeTabsVisible && (
                              <>
                                <span className="appearance-threshold-tabs-divider" aria-hidden />
                                {typeTabs.map(({ key, label }) => (
                                  <button
                                    key={key}
                                    type="button"
                                    role="tab"
                                    aria-selected={activeThresholdType === key}
                                    className={`scale-preset-btn ${activeThresholdType === key ? 'active' : ''}`}
                                    onClick={() => handleTabClick(key)}
                                  >
                                    {label}
                                  </button>
                                ))}
                              </>
                            )}
                          </div>
                        </div>

                        <ThresholdStrip
                          values={activeThresholds}
                          colors={tempColors}
                          onChange={updateActiveThresholds}
                          readOnly={isCustomiseTab}
                        />

                        <div className="appearance-threshold-chips">
                          {/* Normal - color only */}
                          <div className="appearance-threshold-chip" style={{ borderLeftColor: tempColors.normal }}>
                            <div className="appearance-threshold-chip-head">
                              <span className="threshold-color-dot" style={{ backgroundColor: tempColors.normal }} />
                              <span className="appearance-threshold-chip-label">Normal</span>
                              <ColorPicker
                                color={tempColors.normal}
                                onChange={(c) => updateTempColors({ ...tempColors, normal: c })}
                                label="Normal"
                                presets={tempColorPresets.normal}
                              />
                            </div>
                            <span className="appearance-threshold-chip-value">&lt; {activeThresholds.caution}°C</span>
                          </div>

                          {(['caution', 'warning', 'critical'] as const).map((lvl) => {
                            const min =
                              lvl === 'caution'
                                ? 1
                                : activeThresholds[lvl === 'warning' ? 'caution' : 'warning'] + 1;
                            const max =
                              lvl === 'critical'
                                ? 150
                                : activeThresholds[lvl === 'caution' ? 'warning' : 'critical'] - 1;
                            const label = lvl[0].toUpperCase() + lvl.slice(1);
                            return (
                              <div
                                key={lvl}
                                className="appearance-threshold-chip"
                                style={{ borderLeftColor: tempColors[lvl] }}
                              >
                                <div className="appearance-threshold-chip-head">
                                  <span className="threshold-color-dot" style={{ backgroundColor: tempColors[lvl] }} />
                                  <span className="appearance-threshold-chip-label">{label}</span>
                                  <ColorPicker
                                    color={tempColors[lvl]}
                                    onChange={(c) => updateTempColors({ ...tempColors, [lvl]: c })}
                                    label={label}
                                    presets={tempColorPresets[lvl]}
                                  />
                                </div>
                                <div className="appearance-threshold-chip-input">
                                  <input
                                    type="number"
                                    className="setting-input threshold-input"
                                    value={activeThresholds[lvl]}
                                    min={min}
                                    max={max}
                                    disabled={isCustomiseTab}
                                    onChange={(e) => {
                                      const raw = parseInt(e.target.value, 10);
                                      if (isNaN(raw)) return;
                                      const val = Math.max(min, Math.min(max, raw));
                                      updateActiveThresholds({ ...activeThresholds, [lvl]: val });
                                    }}
                                  />
                                  <span className="threshold-unit">°C</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        <div className="appearance-threshold-foot">
                          <span className="appearance-threshold-hint">
                            {activeThresholdType === 'global' && (
                              <>Editing the <strong>Global</strong> baseline - applies to all sensors.</>
                            )}
                            {isCustomiseTab && (
                              <>Per-type overrides <strong>enabled</strong> - pick a sensor type to edit its thresholds.</>
                            )}
                            {isTypeTab && (
                              <>
                                Editing override for <strong>{activeThresholdType.toUpperCase()}</strong> - falls back to Global where unset.
                              </>
                            )}
                          </span>
                          <div className="appearance-threshold-foot-actions">
                            {isTypeTab && (
                              <button
                                className="threshold-action-btn appearance-threshold-paste-btn"
                                onClick={() => {
                                  const label =
                                    activeThresholdType === 'nvme'
                                      ? 'NVMe'
                                      : activeThresholdType === 'mobo'
                                      ? 'Mobo'
                                      : activeThresholdType.toUpperCase();
                                  updatePerTypeThresholds({
                                    ...perTypeThresholds,
                                    [activeThresholdType]: { ...tempThresholds },
                                  });
                                  toast.success(`${label} reset to global values`);
                                }}
                                title="Paste Global thresholds into this type"
                              >
                                <ClipboardPaste size={14} />
                                <span>Paste Global</span>
                              </button>
                            )}
                            <button
                              className="threshold-reset-btn"
                              onClick={() => {
                                resetTempDefaults();
                                toast.success('Temperature thresholds and colors reset to defaults');
                              }}
                            >
                              <RotateCcw size={14} />
                              Reset Defaults
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                </div>
              </div>
          </div>
      </div>
    )}

        {/* License/Subscription Tab */}
        {!isDemoMode && activeTab === 'license' && (
          <div className="settings-section">
            <h2>Subscription</h2>
            
            {isLoading ? (
              <p>Loading license info...</p>
            ) : license ? (
              <>
                {/* Available Plans - First */}
                {/* Tier benefits, agent limits, retention, and prices below all flow from
                    backend/src/license/tiers.ts via /api/license/pricing. The `|| N` price
                    fallbacks only render during the brief loading window before the API
                    responds - keep them in sync with tiers.ts pricing if you change it. */}
                <div className="pricing-section">
                  {promo && promo.offers.length > 0 && (
                    <>
                      <h3>Offers</h3>
                      <div className="promo-offers" role="region" aria-label="Available discount offers">
                      {promo.offers.map((offer) => {
                        const hasLimit = offer.expiresAt != null || offer.totalLimit != null;
                        const productSummary = offer.appliesTo
                          .map((a) => `${a.tier === 'pro' ? 'Pro' : 'Enterprise'} ${a.billing.charAt(0).toUpperCase() + a.billing.slice(1)}`)
                          .join(' & ');

                        let daysRemaining: number | null = null;
                        let endDateLabel: string | null = null;
                        if (offer.expiresAt) {
                          const dt = new Date(offer.expiresAt);
                          const msLeft = dt.getTime() - Date.now();
                          daysRemaining = Math.max(0, Math.ceil(msLeft / (1000 * 60 * 60 * 24)));
                          endDateLabel = dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
                        }

                        const spotsRatio = offer.remaining != null && offer.totalLimit != null && offer.totalLimit > 0
                          ? Math.max(0, Math.min(1, offer.remaining / offer.totalLimit))
                          : null;

                        // Card urgency drives all non-bar elements (label dot,
                        // stamp number, hover glow, etc.). Based on absolute
                        // remaining count: <=3 critical, <=10 caution, else
                        // normal. Days-to-expiry can escalate the tier.
                        let urgency: 'normal' | 'caution' | 'critical' | null = null;
                        if (offer.remaining != null) {
                          if (offer.remaining <= 3) urgency = 'critical';
                          else if (offer.remaining <= 10) urgency = 'caution';
                          else urgency = 'normal';
                        }
                        if (daysRemaining != null) {
                          if (daysRemaining <= 7) {
                            urgency = 'critical';
                          } else if (daysRemaining <= 30 && urgency !== 'critical') {
                            urgency = urgency === null || urgency === 'normal' ? 'caution' : urgency;
                          }
                        }

                        // Bar urgency drives the progress bar fill only.
                        // Based on % of slots remaining (independent of card):
                        //   > 60% left -> normal (green)
                        //   30-60% left -> caution (amber)
                        //   < 30% left -> critical (red)
                        let barUrgency: 'normal' | 'caution' | 'critical' | null = null;
                        if (spotsRatio != null) {
                          if (spotsRatio < 0.30) barUrgency = 'critical';
                          else if (spotsRatio <= 0.60) barUrgency = 'caution';
                          else barUrgency = 'normal';
                        }

                        // Stamp tier - drives the big "%" amount color so it
                        // matches the rarity color of the highest tier this
                        // discount applies to. Highest rarity wins:
                        // lifetime > enterprise > pro.
                        let stampTier: 'pro' | 'enterprise' | 'lifetime' | null = null;
                        if (offer.appliesTo.some((a) => a.billing === 'lifetime')) {
                          stampTier = 'lifetime';
                        } else if (offer.appliesTo.some((a) => a.tier === 'enterprise')) {
                          stampTier = 'enterprise';
                        } else if (offer.appliesTo.some((a) => a.tier === 'pro')) {
                          stampTier = 'pro';
                        }

                        return (
                          <article
                            key={offer.code}
                            className="promo-offer"
                            data-urgency={urgency ?? undefined}
                            data-stamp-tier={stampTier ?? undefined}
                          >
                            <div className="promo-offer-stamp">
                              <span className="promo-offer-stamp-label">SAVE</span>
                              <div className="promo-offer-stamp-amount">
                                <span className="promo-offer-stamp-number">{offer.amountPct}</span>
                                <span className="promo-offer-stamp-symbol">%</span>
                              </div>
                              {offer.cycles != null && (
                                <span className="promo-offer-stamp-cycles">
                                  for {offer.cycles} {offer.cycles === 1 ? 'cycle' : 'cycles'}
                                </span>
                              )}
                              {endDateLabel && (
                                <span className="promo-offer-stamp-expires">
                                  <Clock size={11} aria-hidden="true" />
                                  Ends {endDateLabel}
                                </span>
                              )}
                            </div>

                            <div className="promo-offer-content">
                              <div className="promo-offer-header">
                                <span className="promo-offer-label">
                                  <span className="promo-offer-label-dot" aria-hidden="true" />
                                  {hasLimit ? 'LIMITED OFFER' : 'OFFER'}
                                </span>
                              </div>
                              <h4 className="promo-offer-title">{productSummary || 'Select plans'}</h4>

                              {(offer.remaining != null || daysRemaining != null) && (
                                <div className="promo-offer-spots">
                                  <div className="promo-offer-spots-row">
                                    {offer.remaining != null && (
                                      <span className="promo-offer-spots-text">
                                        {urgency === 'critical' && (
                                          <Flame size={12} className="promo-offer-spots-icon" aria-hidden="true" />
                                        )}
                                        <span className="promo-offer-spots-current">{offer.remaining}</span>
                                        {offer.totalLimit != null && <> of {offer.totalLimit}</>}
                                        {' '}{offer.remaining === 1 ? 'spot' : 'spots'} left
                                      </span>
                                    )}
                                    {daysRemaining != null && (
                                      <span className="promo-offer-days">{daysRemaining} days remaining</span>
                                    )}
                                  </div>
                                  {spotsRatio != null && (
                                    <div
                                      className="promo-offer-spots-bar"
                                      data-urgency={barUrgency ?? undefined}
                                      aria-hidden="true"
                                    >
                                      <div className="promo-offer-spots-fill" style={{ width: `${spotsRatio * 100}%` }} />
                                    </div>
                                  )}
                                </div>
                              )}

                              <div className="promo-offer-code-row">
                                <code className="promo-offer-code">{offer.code}</code>
                                <button
                                  type="button"
                                  className="promo-copy-btn"
                                  onClick={() => copyDiscountCode(offer.code)}
                                  aria-label={`Copy code ${offer.code}`}
                                >
                                  {copiedCode === offer.code ? <Check size={14} /> : <Copy size={14} />}
                                  <span>{copiedCode === offer.code ? 'Copied' : 'Copy'}</span>
                                </button>
                              </div>
                            </div>
                          </article>
                        );
                      })}
                      </div>
                    </>
                  )}

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
                        {pricing?.free.benefits?.map((b, i) => <li key={i}>{b}</li>)}
                      </ul>
                      {license.tier === 'Free' && <div className="current-plan-badge">Current Plan</div>}
                    </div>

                    {/* Pro Plan */}
                    {(() => {
                      const proDiscount = discountForCard(promo, 'pro', proBilling);
                      const proPriceRaw = proBilling === 'monthly'
                        ? (pricing?.pro.pricing.monthly || 5)
                        : (pricing?.pro.pricing.yearly || 49);
                      const proPriceShown = proDiscount
                        ? Math.round(proPriceRaw * (1 - proDiscount.amountPct / 100) * 100) / 100
                        : proPriceRaw;
                      const proProductId = productIdForCard('pro', proBilling);
                      const proStaticUrl = CHECKOUT_URLS.pro[proBilling];
                      const proPeriodSuffix = proBilling === 'monthly' ? 'mo' : 'yr';
                      return (
                        <div className="pricing-card featured" data-tier="pro">
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
                              {proDiscount ? (
                                <>
                                  <span className="pricing-price-strike">${proPriceRaw}</span>
                                  <span className="pricing-price-discounted">${proPriceShown}</span>
                                </>
                              ) : (
                                <>${proPriceRaw}</>
                              )}
                            </div>
                            <div className="pricing-period">
                              {proBilling === 'monthly' ? 'per month' : 'per year'}
                              {proBilling === 'yearly' && !proDiscount && <span className="savings"> (save 18%)</span>}
                            </div>
                            {proDiscount && (
                              <div className="pricing-savings-line">{buildSavingsLine(proDiscount, proBilling)}</div>
                            )}
                          </div>
                          <ul className="pricing-features">
                            {pricing?.pro.benefits?.map((b, i) => <li key={i}>{b}</li>)}
                          </ul>
                          {license.tier === 'Pro' && license.billing === proBilling ? (
                            <div className="current-plan-badge">Current Plan</div>
                          ) : proDiscount && proProductId ? (
                            <button
                              type="button"
                              className={`pricing-buy-btn ${license.tier === 'Pro' ? 'current-tier-btn' : ''}`}
                              onClick={() => handleCheckout(proProductId, proDiscount.code)}
                            >
                              {license.tier === 'Pro' ? 'Switch to' : 'Get'} Pro {proBilling === 'monthly' ? 'Monthly' : 'Yearly'} (${proPriceShown}/{proPeriodSuffix})
                            </button>
                          ) : license.tier === 'Pro' ? (
                            <a
                              href={proStaticUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="pricing-buy-btn current-tier-btn"
                            >
                              Switch to {proBilling === 'monthly' ? 'Monthly' : 'Yearly'} (${proPriceRaw}/{proPeriodSuffix})
                            </a>
                          ) : (
                            <a
                              href={proStaticUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="pricing-buy-btn"
                            >
                              Get Pro (${proPriceRaw}/{proPeriodSuffix})
                            </a>
                          )}
                        </div>
                      );
                    })()}

                    {/* Enterprise Plan */}
                    {(() => {
                      const entDiscount = discountForCard(promo, 'enterprise', enterpriseBilling);
                      const entPriceRaw = enterpriseBilling === 'monthly'
                        ? (pricing?.enterprise.pricing.monthly || 25)
                        : (pricing?.enterprise.pricing.yearly || 249);
                      const entPriceShown = entDiscount
                        ? Math.round(entPriceRaw * (1 - entDiscount.amountPct / 100) * 100) / 100
                        : entPriceRaw;
                      const entProductId = productIdForCard('enterprise', enterpriseBilling);
                      const entStaticUrl = CHECKOUT_URLS.enterprise[enterpriseBilling];
                      const entPeriodSuffix = enterpriseBilling === 'monthly' ? 'mo' : 'yr';
                      return (
                        <div className="pricing-card" data-tier="enterprise">
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
                              {entDiscount ? (
                                <>
                                  <span className="pricing-price-strike">${entPriceRaw}</span>
                                  <span className="pricing-price-discounted">${entPriceShown}</span>
                                </>
                              ) : (
                                <>${entPriceRaw}</>
                              )}
                            </div>
                            <div className="pricing-period">
                              {enterpriseBilling === 'monthly' ? 'per month' : 'per year'}
                              {enterpriseBilling === 'yearly' && !entDiscount && <span className="savings"> (save 17%)</span>}
                            </div>
                            {entDiscount && (
                              <div className="pricing-savings-line">{buildSavingsLine(entDiscount, enterpriseBilling)}</div>
                            )}
                          </div>
                          <ul className="pricing-features">
                            {pricing?.enterprise.benefits?.map((b, i) => <li key={i}>{b}</li>)}
                          </ul>
                          {license.tier === 'Enterprise' && license.billing === enterpriseBilling ? (
                            <div className="current-plan-badge">Current Plan</div>
                          ) : entDiscount && entProductId ? (
                            <button
                              type="button"
                              className={`pricing-buy-btn ${license.tier === 'Enterprise' ? 'current-tier-btn' : ''}`}
                              onClick={() => handleCheckout(entProductId, entDiscount.code)}
                            >
                              {license.tier === 'Enterprise' ? 'Switch to' : 'Get'} Enterprise {enterpriseBilling === 'monthly' ? 'Monthly' : 'Yearly'} (${entPriceShown}/{entPeriodSuffix})
                            </button>
                          ) : license.tier === 'Enterprise' ? (
                            <a
                              href={entStaticUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="pricing-buy-btn current-tier-btn"
                            >
                              Switch to {enterpriseBilling === 'monthly' ? 'Monthly' : 'Yearly'} (${entPriceRaw}/{entPeriodSuffix})
                            </a>
                          ) : (
                            <a
                              href={entStaticUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="pricing-buy-btn"
                            >
                              Get Enterprise (${entPriceRaw}/{entPeriodSuffix})
                            </a>
                          )}
                        </div>
                      );
                    })()}

                    {/* Lifetime Plan */}
                    {(() => {
                      const lifeDiscount = discountForCard(promo, lifetimeTier, 'lifetime');
                      const lifePriceRaw = lifetimeTier === 'pro'
                        ? (pricing?.pro.pricing.lifetime || 199)
                        : (pricing?.enterprise.pricing.lifetime || 649);
                      const lifePriceShown = lifeDiscount
                        ? Math.round(lifePriceRaw * (1 - lifeDiscount.amountPct / 100) * 100) / 100
                        : lifePriceRaw;
                      const lifeProductId = productIdForCard(lifetimeTier, 'lifetime');
                      const lifeStaticUrl = CHECKOUT_URLS[lifetimeTier].lifetime;
                      const lifeTierLabel = lifetimeTier === 'pro' ? 'Pro' : 'Enterprise';
                      return (
                        <div className="pricing-card lifetime" data-tier="lifetime">
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
                              {lifeDiscount ? (
                                <>
                                  <span className="pricing-price-strike">${lifePriceRaw}</span>
                                  <span className="pricing-price-discounted">${lifePriceShown}</span>
                                </>
                              ) : (
                                <>${lifePriceRaw}</>
                              )}
                            </div>
                            <div className="pricing-period">one-time payment</div>
                            {lifeDiscount && (
                              <div className="pricing-savings-line">{buildSavingsLine(lifeDiscount, 'lifetime')}</div>
                            )}
                          </div>
                          <ul className="pricing-features">
                            <li>Pay once, own forever</li>
                            {(lifetimeTier === 'pro' ? pricing?.pro.benefits : pricing?.enterprise.benefits)
                              ?.map((b, i) => <li key={i}>{b}</li>)}
                          </ul>
                          {license.tier === lifeTierLabel && license.billing === 'lifetime' ? (
                            <div className="current-plan-badge">Current Plan</div>
                          ) : lifeDiscount && lifeProductId ? (
                            <button
                              type="button"
                              className="pricing-buy-btn lifetime-btn"
                              onClick={() => handleCheckout(lifeProductId, lifeDiscount.code)}
                            >
                              Get {lifeTierLabel} Lifetime (${lifePriceShown})
                            </button>
                          ) : (
                            <a
                              href={lifeStaticUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="pricing-buy-btn lifetime-btn"
                            >
                              Get {lifeTierLabel} Lifetime (${lifePriceRaw})
                            </a>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {/* Current Subscription - Second */}
                <h3>Your Subscription</h3>
                <div className="license-info">
                  <div className="tier-badges">
                    <div className={`tier-badge tier-${license.tier.toLowerCase()}`}>
                      {license.tier}
                    </div>
                    {(license.billing || license.periodInterval) && (
                      <div className="billing-badge">
                        {formatPeriodBadge(license.periodInterval, license.periodCount, license.billing)}
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
                  {/* Cancellation scheduled - access continues to the paid-through date */}
                  {license.cancelScheduledAt && license.tier !== 'Free' && (
                    <div className="cancel-banner">
                      <TriangleAlert size={14} className="cancel-banner-icon" />
                      <span>
                        <strong>Cancellation scheduled</strong> · access continues until {license.expiresAt ? formatFriendlyDate(license.expiresAt, USER_TIMEZONE) : 'the end of the billing period'} · no further charges
                      </span>
                    </div>
                  )}
                  {/* Seat lost - license was activated on another system (soft demote) */}
                  {license.seatState === 'lost' && (
                    <div className="seat-lost-banner">
                      <TriangleAlert size={14} className="seat-lost-icon" />
                      <span>
                        Your license was activated on <strong>another system</strong>. This system reverted to Free.
                      </span>
                      {license.token && (
                        <button
                          type="button"
                          className="license-action-btn"
                          onClick={() => setSeatConflict({ key: license.token!, boundAt: null, canForce: true })}
                        >
                          <span>Move license here</span>
                        </button>
                      )}
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
                      <div className="limit-item" title={formatDateTooltip(license.activatedAt)}>
                        <span className="limit-label">Activated</span>
                        <div className="limit-value-group">
                          <span className="limit-value">{formatDate(license.activatedAt, USER_TIMEZONE)}</span>
                          <span className="limit-subtext-date">{formatFriendlyDate(license.activatedAt, USER_TIMEZONE)}</span>
                        </div>
                      </div>
                    )}
                    <div className="limit-item" title={formatDateTooltip(license.expiresAt, 'Lifetime - never expires')}>
                      <span className="limit-label">Expires</span>
                      <div className="limit-value-group">
                        <span className="limit-value">
                          {license.expiresAt ? formatDate(license.expiresAt, USER_TIMEZONE) : 'Lifetime'}
                        </span>
                        {license.expiresAt && (
                          <span className="limit-subtext-date">{formatFriendlyDate(license.expiresAt, USER_TIMEZONE)}</span>
                        )}
                      </div>
                    </div>
                    {(() => {
                      const remaining = formatRemaining(license.expiresAt, license.graceExpiresAt);
                      const remainingTooltip = remaining.tooltip
                        ?? (license.billing === 'lifetime'
                          ? 'Lifetime - unlimited access'
                          : formatDateTooltip(license.nextBillingDate, 'No upcoming renewal scheduled'));
                      return (
                        <div className={`limit-item remaining-${remaining.urgency}`} title={remainingTooltip}>
                          <span className="limit-label">Remaining</span>
                          <div className="limit-value-group">
                            <span className="limit-value">{remaining.text}</span>
                            {/* "Renews {date}" for subscriptions; flips to "Ends" once a cancellation is scheduled */}
                            {license.billing !== 'lifetime' && license.nextBillingDate && (
                              <span className="limit-subtext-date">
                                {license.cancelScheduledAt ? 'Ends' : 'Renews'} {formatFriendlyDate(license.nextBillingDate, USER_TIMEZONE)}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                  {/* Manage strip - server-scoped status + actions, styled in the
                      limit-tiles language (bg surface + left accent) so it reads
                      as part of the card, not floating buttons. */}
                  {license.licenseId && (
                    <div className="manage-strip">
                      <span className="license-manage-status">
                        {license.seatState === 'bound' && (
                          <span className="seat-chip">
                            <Monitor size={13} />
                            This system holds the license
                          </span>
                        )}
                        {license.lastSyncAt && (
                          <span title={formatDateTooltip(license.lastSyncAt)}>
                            Last synced {formatRelativeTime(license.lastSyncAt)}
                          </span>
                        )}
                      </span>
                      <span className="license-manage-actions">
                        <span className="btn-group">
                          <button
                            type="button"
                            className="license-action-btn"
                            onClick={handleSyncLicense}
                            disabled={isSyncing}
                            title="Check the license server for renewals or updates"
                          >
                            <RefreshCw
                              size={16}
                              style={{ animation: isSyncing ? 'spin 1s linear infinite' : 'none' }}
                            />
                            <span>Sync</span>
                          </button>
                          <button
                            type="button"
                            className="license-action-btn"
                            onClick={handleRenewLicense}
                            disabled={!canRenew || isRenewing}
                            title={canRenew
                              ? 'Force-refresh your license token from the server. 15 min cooldown, 3/day.'
                              : 'Available when Sync cannot recover your license (e.g., token expired or webhook lost). Try Sync first.'}
                          >
                            <KeyRound
                              size={16}
                              style={{ animation: isRenewing ? 'spin 1s linear infinite' : 'none' }}
                            />
                            <span>Renew</span>
                          </button>
                        </span>
                        {license.tier !== 'Free' && license.billing !== 'lifetime' && (
                          license.cancelScheduledAt ? (
                            <button type="button" className="license-action-btn" disabled title="Cancellation is scheduled; access continues until the paid-through date">
                              <span>Cancellation scheduled</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="license-action-btn license-action-btn--danger"
                              onClick={handleCancelSubscription}
                              disabled={isCancelling}
                              title="Cancel your subscription at the end of the current billing period"
                            >
                              <Ban size={16} />
                              <span>{isCancelling ? 'Cancelling...' : 'Cancel Subscription'}</span>
                            </button>
                          )
                        )}
                      </span>
                    </div>
                  )}
                </div>

                <form onSubmit={handleLicenseSubmit} className="license-form">
                  <label className="license-form-label" htmlFor="license-key-input">Enter License Key</label>
                  <div className="license-form-row">
                    <input
                      id="license-key-input"
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
                      <button
                        type="button"
                        className="license-action-btn license-action-btn--danger"
                        onClick={handleRemoveLicense}
                        disabled={isSubmitting}
                        title="Remove license from this system and free its seat"
                      >
                        <Trash2 size={16} />
                        <span>Remove</span>
                      </button>
                    )}
                  </div>
                  {licenseStatus && (
                    <p className={`license-status ${licenseStatus.success ? 'success' : 'error'}`}>
                      {licenseStatus.message}
                    </p>
                  )}
                </form>

                {/* Seat-conflict dialog: activation hit 409 (license bound to another
                    system). Move is consequential, not destructive - the other
                    system reverts to Free with data intact. */}
                {seatConflict && (
                  <div
                    className="seat-modal-backdrop"
                    onClick={(e) => { if (e.target === e.currentTarget) setSeatConflict(null); }}
                  >
                    <div className="seat-modal" role="dialog" aria-modal="true" aria-labelledby="seat-modal-title">
                      <div className="seat-modal-head">
                        <TriangleAlert size={20} />
                        <h4 id="seat-modal-title">License in use on another system</h4>
                      </div>
                      <p>
                        This license is active on another system{seatConflict.boundAt ? ` (since ${formatFriendlyDate(seatConflict.boundAt, USER_TIMEZONE)})` : ''}.
                        A license can only be active on one system at a time.
                      </p>
                      <p>
                        Moving it here deactivates it there - that system reverts to Free,
                        its settings and data stay intact.
                      </p>
                      <p className="seat-modal-fine">
                        Limit: 2 moves per 7 days. The license owner is notified by email on every move.
                      </p>
                      <div className="seat-modal-actions">
                        <button type="button" className="license-action-btn" onClick={() => setSeatConflict(null)}>
                          Keep it there
                        </button>
                        {seatConflict.canForce ? (
                          <button
                            type="button"
                            className="seat-modal-move"
                            onClick={handleForceMove}
                            disabled={isSubmitting}
                          >
                            {isSubmitting ? 'Moving...' : 'Move license here'}
                          </button>
                        ) : (
                          <span className="seat-modal-fine">
                            Move limit reached - try again later or contact support@pankha.app
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {license.tier !== 'Free' && (license.customerName || license.customerEmail) && (
                  <div className="license-details">
                    <div className="license-details-header">
                      <div className="license-details-heading">
                        <h4 className="license-details-title">Account Details</h4>
                        {license.lastSyncAt && (
                          <p
                            className="license-details-subtitle"
                            title={formatDateTooltip(license.lastSyncAt)}
                          >
                            Last synced {formatFriendlyDate(license.lastSyncAt, USER_TIMEZONE)}
                            <span className="license-details-subtitle-sep"> · </span>
                            {formatRelativeTime(license.lastSyncAt)}
                          </p>
                        )}
                      </div>
                      <div className="license-details-meta">
                        <span
                          className="license-status-pill"
                          data-tier={license.billing === 'lifetime' ? 'lifetime' : license.tier.toLowerCase()}
                          title={license.billing ? `${license.tier} · ${license.billing}` : license.tier}
                        >
                          <span className="license-status-pill-dot" aria-hidden="true" />
                          <span className="license-status-pill-text">
                            ACTIVE
                            {license.billing && <> · {license.tier.toUpperCase()} {license.billing.toUpperCase()}</>}
                          </span>
                        </span>
                        <button
                          type="button"
                          className="license-details-copy-all"
                          onClick={() => copyToClipboard(composeAccountDetails(license), 'account')}
                          title="Copy account details (excludes token)"
                          aria-label="Copy account details (excludes token)"
                        >
                          {copiedTarget === 'account' ? <Check size={14} /> : <Copy size={14} />}
                        </button>
                      </div>
                    </div>

                    <div className="license-field-grid">
                      {license.customerName && (
                        <div className="license-field">
                          <div className="license-field-header">
                            <span className="license-field-label">Name</span>
                          </div>
                          <div className="license-field-input">
                            <span className="license-field-value">{license.customerName}</span>
                            <div className="license-field-actions">
                              <button
                                type="button"
                                className="license-details-icon-button"
                                onClick={() => copyToClipboard(license.customerName!, 'account')}
                                title="Copy name"
                                aria-label="Copy name"
                              >
                                <Copy size={14} />
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                      {license.customerEmail && (
                        <div className="license-field">
                          <div className="license-field-header">
                            <span className="license-field-label">Email</span>
                          </div>
                          <div className="license-field-input">
                            <span className="license-field-value">
                              {revealedFields.has('email') ? license.customerEmail : maskValue(license.customerEmail)}
                            </span>
                            <div className="license-field-actions">
                              <button
                                type="button"
                                className="license-details-icon-button"
                                onClick={() => toggleFieldReveal('email')}
                                title={revealedFields.has('email') ? 'Hide email' : 'Show email'}
                                aria-label={revealedFields.has('email') ? 'Hide email' : 'Show email'}
                              >
                                {revealedFields.has('email') ? <EyeOff size={14} /> : <Eye size={14} />}
                              </button>
                              <button
                                type="button"
                                className="license-details-icon-button"
                                onClick={() => copyToClipboard(license.customerEmail!, 'account')}
                                title="Copy email"
                                aria-label="Copy email"
                              >
                                <Copy size={14} />
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                      {license.licenseId && (
                        <div className="license-field">
                          <div className="license-field-header">
                            <span className="license-field-label">License ID</span>
                          </div>
                          <div className="license-field-input">
                            <span className="license-field-value license-field-value--mono">
                              {revealedFields.has('licenseId') ? license.licenseId : maskValue(license.licenseId)}
                            </span>
                            <div className="license-field-actions">
                              <button
                                type="button"
                                className="license-details-icon-button"
                                onClick={() => toggleFieldReveal('licenseId')}
                                title={revealedFields.has('licenseId') ? 'Hide License ID' : 'Show License ID'}
                                aria-label={revealedFields.has('licenseId') ? 'Hide License ID' : 'Show License ID'}
                              >
                                {revealedFields.has('licenseId') ? <EyeOff size={14} /> : <Eye size={14} />}
                              </button>
                              <button
                                type="button"
                                className="license-details-icon-button"
                                onClick={() => copyToClipboard(license.licenseId!, 'account')}
                                title="Copy License ID"
                                aria-label="Copy License ID"
                              >
                                <Copy size={14} />
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                      {license.subscriptionId && (
                        <div className="license-field">
                          <div className="license-field-header">
                            <span className="license-field-label">Subscription ID</span>
                          </div>
                          <div className="license-field-input">
                            <span className="license-field-value license-field-value--mono">
                              {revealedFields.has('subscriptionId') ? license.subscriptionId : maskValue(license.subscriptionId)}
                            </span>
                            <div className="license-field-actions">
                              <button
                                type="button"
                                className="license-details-icon-button"
                                onClick={() => toggleFieldReveal('subscriptionId')}
                                title={revealedFields.has('subscriptionId') ? 'Hide Subscription ID' : 'Show Subscription ID'}
                                aria-label={revealedFields.has('subscriptionId') ? 'Hide Subscription ID' : 'Show Subscription ID'}
                              >
                                {revealedFields.has('subscriptionId') ? <EyeOff size={14} /> : <Eye size={14} />}
                              </button>
                              <button
                                type="button"
                                className="license-details-icon-button"
                                onClick={() => copyToClipboard(license.subscriptionId!, 'account')}
                                title="Copy Subscription ID"
                                aria-label="Copy Subscription ID"
                              >
                                <Copy size={14} />
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                      {license.customerId && (
                        <div className="license-field">
                          <div className="license-field-header">
                            <span className="license-field-label">Customer ID</span>
                          </div>
                          <div className="license-field-input">
                            <span className="license-field-value license-field-value--mono">
                              {revealedFields.has('customerId') ? license.customerId : maskValue(license.customerId)}
                            </span>
                            <div className="license-field-actions">
                              <button
                                type="button"
                                className="license-details-icon-button"
                                onClick={() => toggleFieldReveal('customerId')}
                                title={revealedFields.has('customerId') ? 'Hide Customer ID' : 'Show Customer ID'}
                                aria-label={revealedFields.has('customerId') ? 'Hide Customer ID' : 'Show Customer ID'}
                              >
                                {revealedFields.has('customerId') ? <EyeOff size={14} /> : <Eye size={14} />}
                              </button>
                              <button
                                type="button"
                                className="license-details-icon-button"
                                onClick={() => copyToClipboard(license.customerId!, 'account')}
                                title="Copy Customer ID"
                                aria-label="Copy Customer ID"
                              >
                                <Copy size={14} />
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                      {license.instanceId && (
                        <div className="license-field">
                          <div className="license-field-header">
                            <span className="license-field-label">System ID</span>
                          </div>
                          <div className="license-field-input">
                            <span className="license-field-value license-field-value--mono">
                              {revealedFields.has('instanceId') ? license.instanceId : maskValue(license.instanceId)}
                            </span>
                            <div className="license-field-actions">
                              <button
                                type="button"
                                className="license-details-icon-button"
                                onClick={() => toggleFieldReveal('instanceId')}
                                title={revealedFields.has('instanceId') ? 'Hide System ID' : 'Show System ID'}
                                aria-label={revealedFields.has('instanceId') ? 'Hide System ID' : 'Show System ID'}
                              >
                                {revealedFields.has('instanceId') ? <EyeOff size={14} /> : <Eye size={14} />}
                              </button>
                              <button
                                type="button"
                                className="license-details-icon-button"
                                onClick={() => copyToClipboard(license.instanceId!, 'account')}
                                title="Copy System ID"
                                aria-label="Copy System ID"
                              >
                                <Copy size={14} />
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                      {license.discountCode && (
                        <div className="license-field license-field--full">
                          <div className="license-field-header">
                            <span className="license-field-label">Discount code</span>
                            {license.discountCyclesRemaining != null && license.discountCyclesRemaining > 0 && (
                              <span className="license-field-hint">{license.discountCyclesRemaining} cycles remaining</span>
                            )}
                          </div>
                          <div className="license-field-input">
                            <span className="license-field-value license-field-value--mono">
                              {revealedFields.has('discount') ? license.discountCode : maskValue(license.discountCode)}
                            </span>
                            <div className="license-field-actions">
                              <button
                                type="button"
                                className="license-details-icon-button"
                                onClick={() => toggleFieldReveal('discount')}
                                title={revealedFields.has('discount') ? 'Hide discount code' : 'Show discount code'}
                                aria-label={revealedFields.has('discount') ? 'Hide discount code' : 'Show discount code'}
                              >
                                {revealedFields.has('discount') ? <EyeOff size={14} /> : <Eye size={14} />}
                              </button>
                              <button
                                type="button"
                                className="license-details-icon-button"
                                onClick={() => copyToClipboard(license.discountCode!, 'account')}
                                title="Copy discount code"
                                aria-label="Copy discount code"
                              >
                                <Copy size={14} />
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                      {license.token && (
                        <div className="license-field license-field--full">
                          <div className="license-field-header">
                            <span className="license-field-label">License Token</span>
                            <span className="license-field-hint">Keep this secret - it authenticates your client.</span>
                          </div>
                          <div className="license-field-input license-field-input--token">
                            <span className="license-field-value license-field-value--mono license-field-value--token">
                              {tokenRevealed ? license.token : maskToken(license.token)}
                            </span>
                            <div className="license-field-actions">
                              <button
                                type="button"
                                className="license-details-icon-button"
                                onClick={() => setTokenRevealed((r) => !r)}
                                title={tokenRevealed ? 'Hide token' : 'Show token'}
                                aria-label={tokenRevealed ? 'Hide token' : 'Show token'}
                              >
                                {tokenRevealed ? <EyeOff size={14} /> : <Eye size={14} />}
                              </button>
                              <button
                                type="button"
                                className="license-details-icon-button"
                                onClick={() => copyToClipboard(license.token!, 'token')}
                                title="Copy token"
                                aria-label="Copy token"
                              >
                                {copiedTarget === 'token' ? <Check size={14} /> : <Copy size={14} />}
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
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

// Memoized: Settings takes no props, so this prevents the every-~3s re-render it
// would otherwise inherit from SystemsPage on each live sensor delta. It still
// re-renders on context changes (license/dashboard-settings) and its own state
// (including the grace tick above).
export default React.memo(Settings);

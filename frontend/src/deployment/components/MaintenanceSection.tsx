import React, { useState, useMemo } from 'react';
import { Activity, ChevronDown, ChevronRight, Download } from 'lucide-react';
import type { HubStatus } from '../../services/api';
import type { PendingAgent } from '../../services/authApi';

type MaintenanceSortKey = 'name' | 'agentId' | 'platform' | 'agentType' | 'version' | 'status' | 'maintenance';
type SortDirection = 'asc' | 'desc';

interface MaintenanceSectionProps {
  isExpanded: boolean;
  onToggle: () => void;
  systems: any[];
  pendingAgents?: PendingAgent[];
  stableVersion: string | null;
  unstableVersion: string | null;
  updatingAgents: Set<number>;
  onApplyUpdate: (systemId: number) => void;
  hubStatus: HubStatus | null;
  githubRepo: string;
}

const isWindowsSystem = (system: any) =>
  system.platform === 'windows' || system.agent_id?.toLowerCase().startsWith('windows-');

/**
 * Parse pre-release tag into a comparable number based on GitHub workflow definition.
 * Ranks: stable (Infinity) > rc > beta > alpha > dev/nightly/etc.
 */
const parsePreRelease = (version: string): number => {
  if (!version.includes('-')) return Infinity;

  const suffix = version.split('-')[1]?.toLowerCase() || '';
  const numMatch = suffix.match(/\d+$/);
  const num = numMatch ? parseInt(numMatch[0], 10) : 0;

  let weight = 0;
  if (suffix.startsWith('rc')) weight = 8000;
  else if (suffix.startsWith('beta')) weight = 7000;
  else if (suffix.startsWith('alpha')) weight = 6000;
  else if (suffix.startsWith('pre') || suffix.startsWith('preview')) weight = 5000;
  else if (suffix.startsWith('insiders')) weight = 4000;
  else if (suffix.startsWith('experimental')) weight = 3000;
  else if (suffix.startsWith('canary')) weight = 2000;
  else if (suffix.startsWith('dev')) weight = 1000;
  else if (suffix.startsWith('nightly')) weight = 500;
  else weight = 100;

  return weight + num;
};

const stripPreRelease = (version: string): string =>
  (version || '0.0.0').replace(/^v/, '').replace(/-.*$/, '');

const compareSemver = (a: string, b: string): number => {
  const cleanA = (a || '0.0.0').replace(/^v/, '');
  const cleanB = (b || '0.0.0').replace(/^v/, '');
  const pa = stripPreRelease(cleanA).split('.').map(Number);
  const pb = stripPreRelease(cleanB).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na !== nb) return na - nb;
  }
  return (parsePreRelease(cleanA) - parsePreRelease(cleanB)) || 0;
};

const MaintenanceSection: React.FC<MaintenanceSectionProps> = React.memo(({
  isExpanded,
  onToggle,
  systems,
  pendingAgents = [],
  stableVersion,
  unstableVersion,
  updatingAgents,
  onApplyUpdate,
  hubStatus,
  githubRepo,
}) => {
  const [sortKey, setSortKey] = useState<MaintenanceSortKey | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  // Agents connected but held for admin approval: not registered, so their
  // systems row still reads offline - show the truthful state instead
  const pendingIds = useMemo(
    () => new Set(pendingAgents.map(p => p.agentId)),
    [pendingAgents]
  );

  const getStatusLabel = (system: any) =>
    updatingAgents.has(system.id)
      ? 'UPDATING'
      : pendingIds.has(system.agent_id)
        ? 'PENDING APPROVAL'
        : (system.status === 'error' ? 'ERROR' : (system.status === 'online' ? 'ONLINE' : 'OFFLINE'));

  const getMaintenanceLabel = (system: any) => {
    const isWindows = isWindowsSystem(system);
    const hubVer = hubStatus?.version?.replace('v', '') || '';
    const stableVer = stableVersion?.replace('v', '') || '';
    const cleanTarget = isWindows ? stableVer : (hubVer || stableVer);
    const isMismatch = cleanTarget && system.agent_version && compareSemver(cleanTarget, system.agent_version) !== 0;
    const isDowngrade = isMismatch && compareSemver(cleanTarget, system.agent_version) < 0;
    const isOutdated = isMismatch && !isDowngrade;
    const isUpdating = updatingAgents.has(system.id);
    const isOnline = system.status === 'online' || system.status === 'error';

    if (isWindows) return isOutdated ? 'DOWNLOAD MSI' : 'GET MSI';
    if (pendingIds.has(system.agent_id)) return 'APPROVE FIRST';
    if (!hubStatus?.version) return 'UNAVAILABLE';
    if (!isOnline) return 'OFFLINE';
    if (isUpdating) return 'UPDATING';
    if (isDowngrade) return 'DOWNGRADE';
    if (isOutdated) return 'UPDATE NOW';
    return 'REINSTALL';
  };

  const handleSort = (key: MaintenanceSortKey) => {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDirection('asc');
      return;
    }
    if (sortDirection === 'asc') {
      setSortDirection('desc');
      return;
    }
    setSortKey(null);
    setSortDirection('asc');
  };

  const getSortIndicator = (key: MaintenanceSortKey) => {
    if (sortKey !== key) return '↕';
    return sortDirection === 'asc' ? '↑' : '↓';
  };

  const outdatedCount = useMemo(() => {
    const hubVer = hubStatus?.version?.replace('v', '') || '';
    const stableVer = stableVersion?.replace('v', '') || '';
    const linuxTarget = hubVer || stableVer;
    const windowsTarget = stableVer;

    if (!linuxTarget && !windowsTarget) return 0;
    return systems.filter(s => {
      if (!s.agent_version) return false;
      const isWindows = isWindowsSystem(s);
      const target = isWindows ? windowsTarget : linuxTarget;
      return target && compareSemver(target, s.agent_version) !== 0;
    }).length;
  }, [systems, stableVersion, hubStatus]);

  const sortedSystems = useMemo(() => {
    if (!sortKey) return systems;

    const sorted = [...systems].sort((a, b) => {
      switch (sortKey) {
        case 'name':
          return (a.name || '').localeCompare((b.name || ''), undefined, { sensitivity: 'base', numeric: true });
        case 'agentId':
          return (a.agent_id || '').localeCompare((b.agent_id || ''), undefined, { sensitivity: 'base', numeric: true });
        case 'platform': {
          const getPlatformLabel = (s: typeof a) => {
            if (s.agent_type === 'ipmi_host' || s.agent_type === 'ipmi_network')
              return s.profile_id?.split('/')[0]?.toUpperCase() || 'IPMI';
            return isWindowsSystem(s) ? 'WINDOWS' : 'LINUX';
          };
          return getPlatformLabel(a).localeCompare(getPlatformLabel(b), undefined, { sensitivity: 'base' });
        }
        case 'agentType':
          return (a.agent_type || '').localeCompare((b.agent_type || ''), undefined, { sensitivity: 'base' });
        case 'version':
          return compareSemver(a.agent_version, b.agent_version);
        case 'status': {
          const rank: Record<string, number> = { OFFLINE: 0, 'PENDING APPROVAL': 1, ERROR: 2, ONLINE: 3, UPDATING: 4 };
          return (rank[getStatusLabel(a)] ?? 0) - (rank[getStatusLabel(b)] ?? 0);
        }
        case 'maintenance':
          return getMaintenanceLabel(a).localeCompare(getMaintenanceLabel(b), undefined, { sensitivity: 'base', numeric: true });
        default:
          return 0;
      }
    });

    return sortDirection === 'asc' ? sorted : sorted.reverse();
  }, [systems, sortKey, sortDirection, updatingAgents, pendingIds]);

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
                  <th>
                    <button type="button" className={`maintenance-sort-btn ${sortKey === 'name' ? 'active' : ''}`} onClick={() => handleSort('name')}>
                      Hostname <span className="sort-indicator">{getSortIndicator('name')}</span>
                    </button>
                  </th>
                  <th>
                    <button type="button" className={`maintenance-sort-btn ${sortKey === 'agentId' ? 'active' : ''}`} onClick={() => handleSort('agentId')}>
                      Agent ID <span className="sort-indicator">{getSortIndicator('agentId')}</span>
                    </button>
                  </th>
                  <th>
                    <button type="button" className={`maintenance-sort-btn ${sortKey === 'platform' ? 'active' : ''}`} onClick={() => handleSort('platform')}>
                      Platform <span className="sort-indicator">{getSortIndicator('platform')}</span>
                    </button>
                  </th>
                  <th>
                    <button type="button" className={`maintenance-sort-btn ${sortKey === 'agentType' ? 'active' : ''}`} onClick={() => handleSort('agentType')}>
                      Agent Type <span className="sort-indicator">{getSortIndicator('agentType')}</span>
                    </button>
                  </th>
                  <th>
                    <button type="button" className={`maintenance-sort-btn ${sortKey === 'version' ? 'active' : ''}`} onClick={() => handleSort('version')}>
                      Version <span className="sort-indicator">{getSortIndicator('version')}</span>
                    </button>
                  </th>
                  <th>
                    <button type="button" className={`maintenance-sort-btn ${sortKey === 'status' ? 'active' : ''}`} onClick={() => handleSort('status')}>
                      Status <span className="sort-indicator">{getSortIndicator('status')}</span>
                    </button>
                  </th>
                  <th>
                    <button type="button" className={`maintenance-sort-btn ${sortKey === 'maintenance' ? 'active' : ''}`} onClick={() => handleSort('maintenance')}>
                      Maintenance <span className="sort-indicator">{getSortIndicator('maintenance')}</span>
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {systems.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: 'var(--spacing-2xl) 0', color: 'var(--text-tertiary)' }}>
                      NO REMOTE NODES DISCOVERED
                    </td>
                  </tr>
                ) : (
                  sortedSystems.map(system => {
                    const isWindows = isWindowsSystem(system);
                    const hubVer = hubStatus?.version?.replace('v', '') || '';
                    const stableVer = stableVersion?.replace('v', '') || '';
                    const cleanTarget = isWindows ? stableVer : (hubVer || stableVer);
                    const targetVersion = cleanTarget ? `v${cleanTarget}` : null;
                    const isMismatch = cleanTarget && system.agent_version && compareSemver(cleanTarget, system.agent_version) !== 0;
                    const isDowngrade = isMismatch && compareSemver(cleanTarget, system.agent_version) < 0;
                    const isOutdated = isMismatch && !isDowngrade;
                    const isUpdating = updatingAgents.has(system.id);
                    const isPending = pendingIds.has(system.agent_id);
                    const isOnline = system.status === 'online' || system.status === 'error';

                    const statusLabel = getStatusLabel(system);
                    const statusClass = isUpdating ? 'updating' : (isPending ? 'pending' : (isOnline ? (system.status === 'error' ? 'error' : 'online') : 'offline'));

                    const getFleetIcon = () => {
                      if (system.agent_type === 'ipmi_host' || system.agent_type === 'ipmi_network') {
                        const vendor = system.profile_id?.split('/')[0]?.toLowerCase();
                        const vendorIcons: Record<string, string> = {
                          dell: '/icons/brands/dell_logo.svg',
                          supermicro: '/icons/brands/supermicro-computer_logo.svg',
                          asrock: '/icons/brands/asrock_logo.svg',
                          tyan: '/icons/brands/tyan_logo.svg',
                          lenovo: '/icons/brands/lenovo_logo.svg',
                          hp: '/icons/brands/hp_logo.svg',
                        };
                        const src = vendor && vendorIcons[vendor] ? vendorIcons[vendor] : '/icons/bmc-01.png';
                        const title = vendor ? `${vendor} IPMI Agent` : 'IPMI Agent';
                        return (
                          <div className="platform-icon" title={title}>
                            <img src={src} alt={title} style={{ maxWidth: '36px', height: '14px', objectFit: 'contain' }} />
                          </div>
                        );
                      }
                      if (isWindows) {
                        return (
                          <div className="platform-icon windows" title="Windows Agent">
                            <img src="/icons/windows_01.svg" alt="Windows" width="14" height="14" />
                          </div>
                        );
                      }
                      return (
                        <div className="platform-icon linux" title="Linux Agent">
                          <img src="/icons/linux_01.svg" alt="Linux" width="14" height="14" />
                        </div>
                      );
                    };
                    const platformIcon = getFleetIcon();

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
                          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)' }}>
                            {platformIcon}
                            <span>{
                              (system.agent_type === 'ipmi_host' || system.agent_type === 'ipmi_network')
                                ? (system.profile_id?.split('/')[0]?.toUpperCase() || 'IPMI')
                                : isWindows ? 'WINDOWS' : 'LINUX'
                            }</span>
                          </div>
                        </td>
                        <td>
                          <span>{
                            ({
                              os_linux: 'OS Agent Linux',
                              os_windows: 'OS Agent Windows',
                              ipmi_host: 'IPMI Agent Host',
                              ipmi_network: 'IPMI Agent Network',
                              unknown: 'Unknown Agent',
                            } as Record<string, string>)[system.agent_type || ''] || system.agent_type || '-'
                          }</span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-xs)' }}>
                            <span>v{system.agent_version || '0.0.0'}</span>
                            {isOutdated && !isUpdating && (
                              <span className="update-badge" title={`Update to ${targetVersion} available`}>
                                NEW {targetVersion}
                              </span>
                            )}
                            {isDowngrade && !isUpdating && (
                              <span className="update-badge downgrade" title={`Downgrade to ${targetVersion}`}>
                                {targetVersion}
                              </span>
                            )}
                          </div>
                        </td>
                        <td>
                          <span
                            className={`status-tag-v2 ${statusClass}`}
                            title={system.status === 'error' && system.last_error
                              ? `Agent status is currently "ERROR"\n\nReason: ${system.last_error}`
                              : `Agent status is currently "${statusLabel}"`}
                          >
                            <span className="status-dot" />
                            {statusLabel}
                          </span>
                        </td>
                        <td>
                          {isWindows ? (
                            <a
                              href={`${githubRepo}/releases/latest/download/pankha-agent-windows_x64.msi`}
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
                                isPending
                                  ? 'Approve this agent on the dashboard first, then update'
                                  : !hubStatus?.version
                                    ? `Download Stable ${stableVersion || ''} or Unstable ${unstableVersion || ''} to server first`
                                    : (!isOnline
                                      ? 'Agent is offline'
                                      : (isUpdating
                                        ? 'Update in progress...'
                                        : (isDowngrade
                                          ? `Downgrade agent to ${targetVersion}`
                                          : (isOutdated
                                            ? `Click to update agent to ${targetVersion}`
                                            : `Reinstall agent version ${targetVersion}`))))
                              }
                              style={{ display: 'inline-block' }}
                            >
                              <button
                                className={`btn-table-action ${isOutdated ? 'update-needed' : ''} ${isDowngrade ? 'downgrade' : ''}`}
                                onClick={() => onApplyUpdate(system.id)}
                                disabled={isPending || !isOnline || isUpdating || !hubStatus?.version}
                                style={{ pointerEvents: 'auto' }}
                              >
                                {isPending ? 'Approve First' : (isUpdating ? 'Updating...' : (isDowngrade ? 'Downgrade' : (isOutdated ? 'Update Now' : 'Reinstall')))}
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

MaintenanceSection.displayName = 'MaintenanceSection';

export default MaintenanceSection;

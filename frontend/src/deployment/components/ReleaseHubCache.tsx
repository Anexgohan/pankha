import React, { useMemo } from 'react';
import { Bookmark, Zap, Trash2, Download, Check } from 'lucide-react';
import type { HubStatus } from '../../services/api';
import { Select } from '../../components/ui/Select';
import { compareSemver } from '../../utils/version';

export type Channel = 'stable' | 'unstable';

export interface ReleaseInfo {
  tag_name: string;
  body?: string;
  published_at?: string;
}

interface ReleaseHubCacheProps {
  stepNumber: number;
  channel: Channel;
  onChannelChange: (channel: Channel) => void;
  stableReleases: ReleaseInfo[];
  unstableReleases: ReleaseInfo[];
  selectedStableVersion: string;
  selectedUnstableVersion: string;
  onSelectStableVersion: (v: string) => void;
  onSelectUnstableVersion: (v: string) => void;
  hubStatus: HubStatus | null;
  isStaging: boolean;
  onStageVersion: (version: string) => void;
  onClearCache: () => void;
  githubRepo: string;
}

const formatDate = (iso?: string): string => {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toISOString().slice(0, 10);
  } catch {
    return '';
  }
};

const formatRelativeDays = (iso?: string): string => {
  if (!iso) return '';
  try {
    const ms = Date.now() - new Date(iso).getTime();
    const days = Math.floor(ms / (1000 * 60 * 60 * 24));
    if (days <= 0) return 'today';
    if (days === 1) return '1d ago';
    return `${days}d ago`;
  } catch {
    return '';
  }
};

const ReleaseHubCache: React.FC<ReleaseHubCacheProps> = React.memo(({
  stepNumber,
  channel,
  onChannelChange,
  stableReleases,
  unstableReleases,
  selectedStableVersion,
  selectedUnstableVersion,
  onSelectStableVersion,
  onSelectUnstableVersion,
  hubStatus,
  isStaging,
  onStageVersion,
  onClearCache,
  githubRepo,
}) => {
  // Release feed arrives in publish-date order; rank by version instead
  // (beta1 published before alpha4 must still list above it)
  const sortedStable = useMemo(
    () => [...stableReleases].sort((a, b) => compareSemver(b.tag_name, a.tag_name)),
    [stableReleases]
  );
  const sortedUnstable = useMemo(
    () => [...unstableReleases].sort((a, b) => compareSemver(b.tag_name, a.tag_name)),
    [unstableReleases]
  );
  const latestStable = sortedStable[0];
  const latestUnstable = sortedUnstable[0];

  const selectedVersion = channel === 'stable' ? selectedStableVersion : selectedUnstableVersion;
  const hubVersion = hubStatus?.version || null;
  const isSelectedCached = hubVersion === selectedVersion;

  const cachedBinaries: Array<{ id: string; label: string; format: string; iconSrc: string; downloadHref?: string }> = [];
  if (hubStatus?.version) {
    if (hubStatus.files.x64) cachedBinaries.push({ id: 'linux-x64', label: 'linux-x64', format: '.tar.gz', iconSrc: '/icons/linux_01.svg' });
    if (hubStatus.files.arm64) cachedBinaries.push({ id: 'linux-arm64', label: 'linux-arm64', format: '.tar.gz', iconSrc: '/icons/linux_01.svg' });
    if (hubStatus.files.ipmi_x64) cachedBinaries.push({ id: 'ipmi-x64', label: 'ipmi-x64', format: '.tar.gz', iconSrc: '/icons/bmc-01.png' });
    cachedBinaries.push({
      id: 'windows-x64',
      label: 'windows-x64',
      format: '.msi',
      iconSrc: '/icons/windows_01.svg',
      downloadHref: `${githubRepo}/releases/download/${hubStatus.version}/pankha-agent-windows_x64.msi`,
    });
  }

  return (
    <section className="deployment-section step-block">
      <div className="step-header">
        <div className="step-number active">{stepNumber}</div>
        <div className="step-text">
          <div className="step-title">Release &amp; Hub cache</div>
          <div className="step-hint">Pick a channel, fetch the release to the Hub, then deploy from there.</div>
        </div>
      </div>

      <div className="hub-cache-picker-grid">
        <div className="hub-cache-picker-cell">
          <span className="builder-label">Stable version</span>
          <Select
            value={selectedStableVersion || ''}
            onChange={(ver) => {
              if (!ver) return;
              onSelectStableVersion(ver);
              sessionStorage.setItem('pankha-picker-stable', ver);
              if (channel !== 'stable') onChannelChange('stable');
            }}
            options={sortedStable.map(r => ({
              value: r.tag_name,
              label: `${r.tag_name}${hubVersion === r.tag_name ? ' (Ready)' : ''}`,
            }))}
            renderTrigger={() =>
              selectedStableVersion || (latestStable ? latestStable.tag_name : 'No stable releases')
            }
            disabled={isStaging || stableReleases.length === 0}
            className="version-picker"
            ariaLabel="Stable version"
          />
        </div>

        <div className="hub-cache-picker-cell">
          <span className="builder-label">Pre-release version</span>
          <Select
            value={selectedUnstableVersion || ''}
            onChange={(ver) => {
              if (!ver) return;
              onSelectUnstableVersion(ver);
              sessionStorage.setItem('pankha-picker-unstable', ver);
              if (channel !== 'unstable') onChannelChange('unstable');
            }}
            options={sortedUnstable.map(r => ({
              value: r.tag_name,
              label: `${r.tag_name}${hubVersion === r.tag_name ? ' (Ready)' : ''}`,
            }))}
            renderTrigger={() =>
              selectedUnstableVersion || (latestUnstable ? latestUnstable.tag_name : 'No pre-releases')
            }
            disabled={isStaging || unstableReleases.length === 0}
            className="version-picker"
            ariaLabel="Pre-release version"
          />
        </div>
      </div>

      <div className="channel-card-row">
        <button
          type="button"
          className={`channel-card ${channel === 'stable' ? 'active' : ''}`}
          onClick={() => onChannelChange('stable')}
          disabled={!latestStable}
        >
          <div className="channel-card-head">
            <Bookmark size={13} />
            <span className="channel-card-label">Stable</span>
            {channel === 'stable' && <Check size={13} className="channel-card-check" />}
          </div>
          <div className="channel-card-body">
            <span className="channel-card-version">{selectedStableVersion || latestStable?.tag_name || '-'}</span>
            {latestStable?.published_at && (
              <span className="channel-card-date">released {formatDate(latestStable.published_at)} ({formatRelativeDays(latestStable.published_at)})</span>
            )}
          </div>
        </button>

        <button
          type="button"
          className={`channel-card ${channel === 'unstable' ? 'active' : ''} unstable`}
          onClick={() => onChannelChange('unstable')}
          disabled={!latestUnstable}
        >
          <div className="channel-card-head">
            <Zap size={13} />
            <span className="channel-card-label">Pre-release</span>
            {channel === 'unstable' && <Check size={13} className="channel-card-check" />}
          </div>
          <div className="channel-card-body">
            <span className="channel-card-version">{selectedUnstableVersion || latestUnstable?.tag_name || '-'}</span>
            {latestUnstable?.published_at && (
              <span className="channel-card-date">released {formatDate(latestUnstable.published_at)} ({formatRelativeDays(latestUnstable.published_at)})</span>
            )}
          </div>
        </button>
      </div>

      <div className="hub-cache-actions">
        <button
          type="button"
          className="btn-clear-cache"
          onClick={onClearCache}
          disabled={!hubStatus?.version || isStaging}
          title="Clear all cached agent binaries from Hub server"
        >
          <Trash2 size={14} />
          <span>Clear all</span>
        </button>
        <button
          type="button"
          className={`btn-prep-action prep-download-fixed ${channel === 'unstable' ? 'unstable' : 'stable'} ${isStaging ? 'loading' : ''} ${isSelectedCached ? 'current' : ''}`}
          onClick={() => onStageVersion(selectedVersion)}
          disabled={isStaging || isSelectedCached || !selectedVersion}
          title={isSelectedCached
            ? `${channel === 'stable' ? 'Stable' : 'Pre-release'} ${selectedVersion} is already on Hub.`
            : `Download ${channel === 'stable' ? 'Stable' : 'Pre-release'} ${selectedVersion} to Hub.`}
        >
          {isSelectedCached ? <Check size={12} /> : <Download size={12} />}
          <span>
            {isSelectedCached
              ? `${channel === 'stable' ? 'Stable' : 'Pre-release'} on Hub`
              : `Download ${channel === 'stable' ? 'Stable' : 'Pre-release'}`}
          </span>
        </button>
      </div>

      <div className="hub-cache-list-header">
        <span className="builder-label">HUB CACHE</span>
        <span className="hub-cache-meta">
          {cachedBinaries.length} binar{cachedBinaries.length === 1 ? 'y' : 'ies'}
          {hubStatus?.version ? ` . ${hubStatus.version}` : ''}
        </span>
      </div>

      <div className="hub-cache-list">
        {cachedBinaries.length === 0 ? (
          <div className="hub-cache-empty">
            No binaries on Hub yet. Download a release above to populate cache.
          </div>
        ) : (
          cachedBinaries.map(b => (
            <div key={b.id} className="hub-cache-row">
              <div className="hub-cache-row-icon">
                <img src={b.iconSrc} alt="" width="14" height="14" />
              </div>
              <span className="hub-cache-row-label">{b.label}</span>
              <span className="binary-format-pill">{b.format}</span>
              <span className="hub-cache-row-version">{hubStatus?.version}</span>
              <div className="hub-cache-row-actions">
                {b.downloadHref && (
                  <a
                    href={b.downloadHref}
                    className="btn-table-action"
                    download
                    style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                  >
                    <Download size={12} />
                    Download .msi
                  </a>
                )}
                <button
                  type="button"
                  className="hub-cache-row-trash"
                  onClick={onClearCache}
                  title="Clear all cached binaries"
                  disabled={isStaging}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
});

ReleaseHubCache.displayName = 'ReleaseHubCache';

export default ReleaseHubCache;

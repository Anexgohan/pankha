import React from 'react';
import { Server, FolderDown, ExternalLink, Link2, RotateCcw } from 'lucide-react';
import type { DeploymentHubConfig } from '../../services/api';

export type PathMode = 'standard' | 'portable';
export type UrlMode = 'internal' | 'external';

interface InstallConnectionProps {
  stepNumber: number;
  pathMode: PathMode;
  onPathModeChange: (mode: PathMode) => void;
  urlMode: UrlMode;
  onUrlModeChange: (mode: UrlMode) => void;
  hubUrl: string;
  onHubUrlChange: (url: string) => void;
  onHubUrlReset: () => void;
  hubConfig: DeploymentHubConfig | null;
}

const pathHints: Record<PathMode, string> = {
  standard: '/opt/pankha + systemd service',
  portable: 'Installs into the current working directory',
};

const urlHints: Record<UrlMode, string> = {
  internal: 'Clients use the internal Hub address on your LAN',
  external: 'Clients reach the Hub at a public URL',
};

const InstallConnection: React.FC<InstallConnectionProps> = React.memo(({
  stepNumber,
  pathMode,
  onPathModeChange,
  urlMode,
  onUrlModeChange,
  hubUrl,
  onHubUrlChange,
  onHubUrlReset,
  hubConfig,
}) => (
  <section className="deployment-section step-block">
    <div className="step-header">
      <div className="step-number active">{stepNumber}</div>
      <div className="step-text">
        <div className="step-title">Install &amp; connection</div>
        <div className="step-hint">How the agent runs on the host and how it reaches the Hub.</div>
      </div>
    </div>

    <div className="install-connection-grid">
      <div className="builder-group">
        <span className="builder-label">Install mode</span>
        <div className="toggle-presets toggle-presets-stretch">
          <button
            type="button"
            className={`toggle-item toggle-item-stretch ${pathMode === 'standard' ? 'active' : ''}`}
            onClick={() => onPathModeChange('standard')}
          >
            <Server size={14} />
            Standard
          </button>
          <button
            type="button"
            className={`toggle-item toggle-item-stretch ${pathMode === 'portable' ? 'active' : ''}`}
            onClick={() => onPathModeChange('portable')}
          >
            <FolderDown size={14} />
            Portable
          </button>
        </div>
        <div className="field-hint">{pathHints[pathMode]}</div>
      </div>

      <div className="builder-group">
        <span className="builder-label">Connection</span>
        <div className="toggle-presets toggle-presets-stretch">
          <button
            type="button"
            className={`toggle-item toggle-item-stretch ${urlMode === 'internal' ? 'active' : ''}`}
            onClick={() => onUrlModeChange('internal')}
            disabled={!hubConfig?.hubIp}
            title={hubConfig?.hubIp ? `Internal: ${hubConfig.hubIp}:${hubConfig.hubPort}` : 'Internal IP not configured in server settings'}
          >
            <Server size={14} /> Internal
          </button>
          <button
            type="button"
            className={`toggle-item toggle-item-stretch ${urlMode === 'external' ? 'active' : ''}`}
            onClick={() => onUrlModeChange('external')}
          >
            <ExternalLink size={14} /> External
          </button>
        </div>
        <div className="field-hint">{urlHints[urlMode]}</div>
      </div>
    </div>

    <div className="hub-url-group">
      <span className="builder-label"><Link2 size={14} /> Hub URL</span>
      <div className="hub-url-input-wrapper hub-url-input-wrapper-full">
        <input
          type="text"
          className="hub-url-input"
          value={hubUrl}
          onChange={(e) => onHubUrlChange(e.target.value)}
          placeholder="http://192.168.1.100:3000"
        />
        <button
          type="button"
          className="hub-url-reset"
          onClick={onHubUrlReset}
          title={`Reset to ${urlMode} URL`}
        >
          <RotateCcw size={14} />
        </button>
      </div>
      <div className="field-hint">Clients call this URL on every poll.</div>
    </div>
  </section>
));

InstallConnection.displayName = 'InstallConnection';

export default InstallConnection;

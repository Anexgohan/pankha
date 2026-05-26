import React, { useState, useMemo } from 'react';
import { Copy, Check, ExternalLink, FileText, Tag } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import type { Platform, Arch } from './PlatformArchPicker';
import type { Channel, ReleaseInfo } from './ReleaseHubCache';

type Tool = 'wget' | 'curl' | 'powershell';
type WinTool = 'msi' | 'powershell';

interface DeploySummaryProps {
  platform: Platform;
  arch: Arch;
  channel: Channel;
  selectedVersion: string;
  pathMode: 'standard' | 'portable';
  urlMode: 'internal' | 'external';
  hubUrl: string;
  logLevel: string;
  emergency: string;
  failsafe: string;
  agentRate: string;
  fanStep: string;
  hysteresis: string;
  bmcVendorModel: string | null;
  bmcProfileSource: 'catalog' | 'custom' | null;
  isLoadingToken: boolean;
  generateCommand: (tool: Tool) => string;
  onCopy: (tool: Tool) => void;
  copiedType: Tool | null;
  releaseNotes: ReleaseInfo | null;
  githubRepo: string;
}

const platformLabel: Record<Platform, string> = {
  linux: 'Linux',
  windows: 'Windows',
  ipmi: 'IPMI',
};

const platformIconSrc: Record<Platform, string> = {
  linux: '/icons/linux_01.svg',
  windows: '/icons/windows_01.svg',
  ipmi: '/icons/bmc-01.png',
};

const channelLabel: Record<Channel, string> = {
  stable: 'Stable',
  unstable: 'Pre-release',
};

const DeploySummary: React.FC<DeploySummaryProps> = React.memo(({
  platform,
  arch,
  channel,
  selectedVersion,
  pathMode,
  urlMode,
  hubUrl,
  logLevel,
  emergency,
  failsafe,
  agentRate,
  fanStep,
  hysteresis,
  bmcVendorModel,
  bmcProfileSource,
  isLoadingToken,
  generateCommand,
  onCopy,
  copiedType,
  releaseNotes,
  githubRepo,
}) => {
  const [activeTool, setActiveTool] = useState<Tool>('wget');
  const [winTool, setWinTool] = useState<WinTool>('msi');
  const isWindows = platform === 'windows';
  const command = isWindows ? '' : generateCommand(activeTool);
  const winCommand = isWindows
    ? (winTool === 'msi'
        ? 'Direct download cannot be pre-configured, use PowerShell instead.'
        : generateCommand('powershell'))
    : '';
  const installSuffix = isWindows ? 'msi' : pathMode;
  const msiUrl = selectedVersion
    ? `${githubRepo}/releases/download/${selectedVersion}/pankha-agent-windows_x64.msi`
    : `${githubRepo}/releases/latest/download/pankha-agent-windows_x64.msi`;
  const msiFilename = selectedVersion ? `pankha-agent-windows_x64-${selectedVersion}.msi` : 'pankha-agent-windows_x64.msi';

  // ---- Helpers (closure over githubRepo / isLoadingToken) ----

  const formatNotesDate = (iso?: string): string => {
    if (!iso) return '';
    try {
      return new Date(iso).toISOString().slice(0, 10);
    } catch {
      return '';
    }
  };

  // Trim everything from the install-instructions section onward.
  // GitHub release bodies follow this template: changelog -> "# Pankha Fan Control..." -> "## Instructions:" -> install commands.
  // The "Full changelog" link routes users to the full release on GitHub for anything beyond the changelog.
  const trimReleaseBody = (body: string): string => {
    const lines = body.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i].trim();
      if (/^#+\s+Pankha\b/i.test(l)) return lines.slice(0, i).join('\n').trimEnd();
      if (/^#*\s*Instructions:?\s*$/i.test(l)) return lines.slice(0, i).join('\n').trimEnd();
    }
    return body;
  };

  // Memo-cache trimmed body per release tag
  const trimmedBody = useMemo(() => {
    return releaseNotes?.body ? trimReleaseBody(releaseNotes.body) : '';
  }, [releaseNotes?.tag_name, releaseNotes?.body]);

  // ReactMarkdown components map - applies Pankha styling to every block
  const markdownComponents = useMemo(() => ({
    h1: ({ node, ...props }: any) => <div className="rn-h1" {...props} />,
    h2: ({ node, ...props }: any) => <div className="rn-h2" {...props} />,
    h3: ({ node, ...props }: any) => <div className="rn-h3" {...props} />,
    h4: ({ node, ...props }: any) => <div className="rn-h4" {...props} />,
    h5: ({ node, ...props }: any) => <div className="rn-h4" {...props} />,
    h6: ({ node, ...props }: any) => <div className="rn-h4" {...props} />,
    p: ({ node, ...props }: any) => <p className="rn-p" {...props} />,
    ul: ({ node, ...props }: any) => <ul className="rn-list" {...props} />,
    ol: ({ node, ...props }: any) => <ol className="rn-list rn-list-ordered" {...props} />,
    li: ({ node, ...props }: any) => <li className="rn-li" {...props} />,
    a: ({ node, href, ...props }: any) => (
      <a
        className="rn-link"
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        {...props}
      />
    ),
    code: ({ node, className, ...props }: any) => (
      className
        ? <code className={`rn-code-block ${className}`} {...props} />
        : <code className="rn-code" {...props} />
    ),
    pre: ({ node, ...props }: any) => <pre className="rn-pre" {...props} />,
    details: ({ node, ...props }: any) => <details className="rn-details" {...props} />,
    summary: ({ node, ...props }: any) => <summary className="rn-summary" {...props} />,
    hr: () => <hr className="rn-hr" />,
    blockquote: ({ node, ...props }: any) => <blockquote className="rn-blockquote" {...props} />,
    img: () => null, // strip image badges - they would dominate the panel
    table: ({ node, ...props }: any) => <table className="rn-table" {...props} />,
  }), []);

  // Syntax-coloured command. Handles:
  //  - shell comments (# ...)
  //  - "<tool> <flag> <"URL"> | <keyword>" pattern (wget|curl|iwr -> bash|iex)
  const renderCommandLine = (raw: string, skipLoading = false): React.ReactNode => {
    if (!skipLoading && isLoadingToken) return <span className="cmd-placeholder">Generating secure token...</span>;
    if (!raw) return <span className="cmd-placeholder">Configure settings to generate command</span>;
    if (raw.trimStart().startsWith('#')) {
      return <span className="cmd-comment">{raw}</span>;
    }
    const m = raw.match(/^(wget|curl|iwr|Invoke-WebRequest)\s+(\S+)\s+("[^"]+")\s*\|\s*(bash|iex|Invoke-Expression)\s*$/);
    if (!m) return <span className="cmd-fallback">{raw}</span>;
    const [, tool, flags, url, sh] = m;
    return (
      <>
        <span className="cmd-tool">{tool}</span>
        {' '}
        <span className="cmd-flag">{flags}</span>
        {' '}
        <span className="cmd-string">{url}</span>
        {' '}
        <span className="cmd-pipe">|</span>
        {' '}
        <span className="cmd-keyword">{sh}</span>
      </>
    );
  };

  const releaseTagForLink = releaseNotes?.tag_name || selectedVersion;
  const channelBadgeLabel = channel === 'stable' ? 'STABLE' : 'PRE-RELEASE';

  return (
    <div className="deploy-summary-column">
      <aside className={`deploy-summary-panel platform-${platform}`}>
        <div className="deploy-summary-header">
          <span className="deploy-summary-eyebrow">Deploy summary</span>
          <div className="deploy-summary-title">{platformLabel[platform]} . {channelLabel[channel]}</div>
          <div className="deploy-summary-meta">
            {selectedVersion || '-'} . {arch} . {installSuffix}
          </div>
        </div>

        <div className="summary-rows">
          <div className="summary-row">
            <span className="summary-eyebrow">Platform</span>
            <span className="summary-value">
              <img src={platformIconSrc[platform]} alt="" width="14" height="14" />
              <span>{platformLabel[platform]} . {arch}</span>
            </span>
          </div>
          <div className="summary-row">
            <span className="summary-eyebrow">Release</span>
            {selectedVersion ? (
              <span className="summary-value">{channelLabel[channel]} . <span>{selectedVersion}</span></span>
            ) : (
              <span className="summary-value summary-value-unset">Not selected</span>
            )}
          </div>
          {platform === 'ipmi' && bmcProfileSource && (
            <div className="summary-row">
              <span className="summary-eyebrow">BMC profile</span>
              {bmcProfileSource === 'catalog' && !bmcVendorModel ? (
                <span className="summary-value summary-value-unset">Not selected</span>
              ) : (
                <span className="summary-value">
                  {bmcProfileSource === 'catalog' ? bmcVendorModel : 'Custom (bare agent)'}
                </span>
              )}
            </div>
          )}
          <div className="summary-row">
            <span className="summary-eyebrow">Install mode</span>
            <span className="summary-value">
              {isWindows ? 'MSI installer' : (pathMode === 'standard' ? 'Standard (/opt)' : 'Portable (CWD)')}
            </span>
          </div>
          <div className="summary-row">
            <span className="summary-eyebrow">Connection</span>
            <span className="summary-value">
              {urlMode === 'internal' ? 'Internal' : 'External'}
            </span>
          </div>
          <div className="summary-row">
            <span className="summary-eyebrow">Hub URL</span>
            {hubUrl ? (
              <span className="summary-value summary-mono">{hubUrl}</span>
            ) : (
              <span className="summary-value summary-value-unset">Not configured</span>
            )}
          </div>
          <div className="summary-row">
            <span className="summary-eyebrow">Log level</span>
            <span className="summary-value">{logLevel}</span>
          </div>
          <div className="summary-row">
            <span className="summary-eyebrow">Emergency / Failsafe</span>
            <span className="summary-value">{emergency}°C → {failsafe}%</span>
          </div>
          <div className="summary-row">
            <span className="summary-eyebrow">Agent rate</span>
            <span className="summary-value">{agentRate}s</span>
          </div>
          <div className="summary-row">
            <span className="summary-eyebrow">Fan step / Hysteresis</span>
            <span className="summary-value">{fanStep}% / {hysteresis}°C</span>
          </div>
        </div>

        {isWindows ? (
          <div className="deploy-summary-command">
            <div className="deploy-summary-command-header">
              <span className="deploy-summary-eyebrow">Command</span>
              <div className="cmd-tool-switcher" role="tablist" aria-label="Install method">
                <button
                  type="button"
                  role="tab"
                  aria-selected={winTool === 'msi'}
                  className={`cmd-tool-switcher-item ${winTool === 'msi' ? 'active' : ''}`}
                  onClick={() => setWinTool('msi')}
                >
                  Download MSI
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={winTool === 'powershell'}
                  className={`cmd-tool-switcher-item ${winTool === 'powershell' ? 'active' : ''}`}
                  onClick={() => setWinTool('powershell')}
                >
                  PowerShell
                </button>
              </div>
            </div>
            <div className="terminal-container">
              <div className="terminal-header">
                <div className="terminal-dots">
                  <span className="terminal-dot dot-red" />
                  <span className="terminal-dot dot-yellow" />
                  <span className="terminal-dot dot-green" />
                </div>
                <div className="terminal-path">{winTool === 'msi' ? 'C:\\' : 'PS C:\\'}</div>
              </div>
              <div className="terminal-body">
                <span className="command-prompt">{winTool === 'msi' ? '#' : 'PS>'}</span>
                <code className="command-line">
                  {winTool === 'msi'
                    ? <span className="cmd-comment">{winCommand}</span>
                    : renderCommandLine(winCommand, /* skipLoading */ true)}
                </code>
              </div>
            </div>
            {winTool === 'msi' ? (
              <a
                href={msiUrl}
                className="btn-primary-tactical deploy-copy-cta"
                download
                title={msiFilename}
              >
                <img src="/icons/windows_01.svg" alt="" width="16" height="16" />
                <span>Download .MSI</span>
              </a>
            ) : (
              <button
                type="button"
                className={`btn-primary-tactical deploy-copy-cta ${copiedType === 'powershell' ? 'success' : ''}`}
                onClick={() => onCopy('powershell')}
              >
                {copiedType === 'powershell' ? <Check size={16} /> : <Copy size={16} />}
                <span>{copiedType === 'powershell' ? 'Copied' : 'Copy deploy command'}</span>
              </button>
            )}
            <p className="deploy-copy-hint">
              {winTool === 'msi'
                ? 'MSI installs the agent service on this host.'
                : 'Paste in an elevated PowerShell - agent self-registers on first start.'}
            </p>
          </div>
        ) : (
          <div className="deploy-summary-command">
            <div className="deploy-summary-command-header">
              <span className="deploy-summary-eyebrow">Command</span>
              <div className="cmd-tool-switcher" role="tablist" aria-label="Install tool">
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTool === 'wget'}
                  className={`cmd-tool-switcher-item ${activeTool === 'wget' ? 'active' : ''}`}
                  onClick={() => setActiveTool('wget')}
                >
                  wget
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTool === 'curl'}
                  className={`cmd-tool-switcher-item ${activeTool === 'curl' ? 'active' : ''}`}
                  onClick={() => setActiveTool('curl')}
                >
                  curl
                </button>
              </div>
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
                  {renderCommandLine(command)}
                </code>
              </div>
            </div>
            <button
              type="button"
              className={`btn-primary-tactical deploy-copy-cta ${copiedType === activeTool ? 'success' : ''}`}
              onClick={() => onCopy(activeTool)}
              disabled={isLoadingToken || !command}
            >
              {copiedType === activeTool ? <Check size={16} /> : <Copy size={16} />}
              <span>{copiedType === activeTool ? 'Copied' : 'Copy deploy command'}</span>
            </button>
            <p className="deploy-copy-hint">
              Paste on each target node - agent self-registers on first start.
            </p>
          </div>
        )}
      </aside>

      <section className="deployment-section release-notes-panel">
        <div className="release-notes-header">
          <div className="release-notes-header-top">
            <span className="release-notes-eyebrow">
              <FileText size={12} aria-hidden="true" />
              <span>Release notes</span>
            </span>
            {releaseTagForLink && (
              <a
                className="release-notes-full-link"
                href={`${githubRepo}/releases/tag/${releaseTagForLink}`}
                target="_blank"
                rel="noopener noreferrer"
                title={`Open ${releaseTagForLink} on GitHub`}
              >
                <ExternalLink size={12} aria-hidden="true" />
                <span>Full changelog</span>
              </a>
            )}
          </div>
          <div className="release-notes-meta">
            <span className={`release-notes-badge release-notes-badge-${channel}`}>
              <Tag size={10} aria-hidden="true" />
              <span>{channelBadgeLabel}</span>
            </span>
            <span className="release-notes-version">{releaseNotes?.tag_name || selectedVersion || '-'}</span>
            {releaseNotes?.published_at && (
              <>
                <span className="release-notes-divider" aria-hidden="true">·</span>
                <span className="release-notes-date">{formatNotesDate(releaseNotes.published_at)}</span>
              </>
            )}
          </div>
        </div>
        <div className="release-notes-body">
          {trimmedBody ? (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeRaw]}
              components={markdownComponents}
            >
              {trimmedBody}
            </ReactMarkdown>
          ) : (
            <p className="release-notes-empty">Release notes will appear when a version is selected.</p>
          )}
        </div>
      </section>
    </div>
  );
});

DeploySummary.displayName = 'DeploySummary';

export default DeploySummary;

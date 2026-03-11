import React from 'react';
import { Server } from 'lucide-react';

const PANKHA_SITE = 'https://pankha.app';

/**
 * IPMI installer cards — shown when agent mode toggle is set to "IPMI".
 * Reuses .installer-card, .coming-soon-badge, .btn-outline-tactical from deployment.css.
 */
const IpmiInstallerCards: React.FC = React.memo(() => (
  <div className="download-options">
    {/* Host IPMI Agent */}
    <div className="installer-card">
      <h4>
        <Server size={16} /> Host IPMI Agent
        <div className="version-tags-row">
          <span className="version-tag stable">RUST</span>
        </div>
      </h4>
      <p>
        Local BMC agent for servers with /dev/ipmi0 access.
        Supports Supermicro, Dell, and HP via JSON BMC profiles.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
        <div className="coming-soon-badge">
          <span className="badge-dot" />
          CONFIGURE IN DEPLOYMENT AIO BELOW
        </div>
        <p className="subtitle-note">
          Select a BMC profile and generate an install command via the AIO builder.
        </p>
      </div>
      <a
        href={`${PANKHA_SITE}/docs/wiki/agents-ipmi/`}
        target="_blank"
        rel="noopener noreferrer"
        className="btn-outline-tactical"
      >
        <Server size={16} /> DOCUMENTATION
      </a>
    </div>

    {/* Network IPMI Agent — Coming Soon */}
    <div className="installer-card">
      <h4>
        <Server size={16} /> Network IPMI Agent
        <div className="version-tags-row">
          <span className="version-tag">PLANNED</span>
        </div>
      </h4>
      <p>
        Go-based LAN+ agent for remote IPMI management.
        Control servers over the network without local access.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
        <div className="coming-soon-badge">
          <span className="badge-dot" />
          COMING SOON
        </div>
        <p className="subtitle-note">
          Network IPMI agent is planned for a future release.
        </p>
      </div>
    </div>
  </div>
));

export default IpmiInstallerCards;

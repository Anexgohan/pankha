import React from 'react';
import { Check } from 'lucide-react';
import type { HubStatus } from '../../services/api';

export type Platform = 'linux' | 'windows' | 'ipmi';
export type Arch = 'x64' | 'arm64';

interface PlatformArchPickerProps {
  stepNumber: number;
  platform: Platform;
  arch: Arch;
  onPlatformChange: (platform: Platform) => void;
  onArchChange: (arch: Arch) => void;
  hubStatus: HubStatus | null;
}

interface PlatformCardDef {
  id: Platform;
  name: string;
  iconSrc: string;
  iconAlt: string;
  tagline: string;
  footer: string;
  archs: Arch[];
}

const PLATFORMS: PlatformCardDef[] = [
  {
    id: 'linux',
    name: 'Linux',
    iconSrc: '/icons/linux_01.svg',
    iconAlt: 'Linux',
    tagline: 'Systemd service, Rust-based monitoring',
    footer: 'Debian·Ubuntu·Proxmox·RPi',
    archs: ['x64', 'arm64'],
  },
  {
    id: 'windows',
    name: 'Windows',
    iconSrc: '/icons/windows_01.svg',
    iconAlt: 'Windows',
    tagline: 'Native service with Tray App',
    footer: 'Windows 10/11·Self-contained .NET 8.0',
    archs: ['x64'],
  },
  {
    id: 'ipmi',
    name: 'IPMI',
    iconSrc: '/icons/bmc-01.png',
    iconAlt: 'IPMI',
    tagline: 'Out-of-band fan control over BMC',
    footer: 'iDRAC·iLO·IPMI 2.0',
    archs: ['x64'],
  },
];

const isArchCached = (hubStatus: HubStatus | null, platform: Platform, arch: Arch): boolean => {
  if (!hubStatus?.files) return false;
  if (platform === 'ipmi') return arch === 'x64' && hubStatus.files.ipmi_x64;
  if (platform === 'windows') return false;
  if (arch === 'x64') return hubStatus.files.x64;
  if (arch === 'arm64') return hubStatus.files.arm64;
  return false;
};

const PlatformArchPicker: React.FC<PlatformArchPickerProps> = React.memo(({
  stepNumber,
  platform,
  arch,
  onPlatformChange,
  onArchChange,
  hubStatus,
}) => (
  <section className="deployment-section step-block">
    <div className="step-header">
      <div className="step-number active">{stepNumber}</div>
      <div className="step-text">
        <div className="step-title">Platform &amp; architecture</div>
        <div className="step-hint">Pick the agent type and CPU arch - one click does both.</div>
      </div>
    </div>

    <div className="platform-grid">
      {PLATFORMS.map(p => {
        const isActive = platform === p.id;
        return (
          <button
            key={p.id}
            type="button"
            className={`platform-card ${isActive ? 'active' : ''}`}
            onClick={() => {
              onPlatformChange(p.id);
              if (!p.archs.includes(arch)) onArchChange(p.archs[0]);
            }}
          >
            <div className="platform-card-head">
              <div className="platform-card-icon">
                <img src={p.iconSrc} alt={p.iconAlt} width="18" height="18" />
              </div>
              <div className="platform-card-name-block">
                <span className="platform-card-name">{p.name}</span>
                <span className="platform-card-sub">{p.tagline}</span>
              </div>
            </div>

            <div className="arch-chip-row">
              {p.archs.map(a => {
                const chipActive = isActive && arch === a;
                const cached = isArchCached(hubStatus, p.id, a);
                return (
                  <button
                    key={a}
                    type="button"
                    className={`arch-chip ${chipActive ? 'active' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onPlatformChange(p.id);
                      onArchChange(a);
                    }}
                  >
                    {chipActive && <Check size={12} />}
                    <span>{a}</span>
                    {cached && <span className="arch-chip-cached" title="Cached on Hub" />}
                  </button>
                );
              })}
            </div>

            <div className="platform-card-footer">{p.footer}</div>
          </button>
        );
      })}
    </div>
  </section>
));

PlatformArchPicker.displayName = 'PlatformArchPicker';

export default PlatformArchPicker;

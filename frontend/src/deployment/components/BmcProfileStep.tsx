import React from 'react';
import IpmiProfileSelector from './IpmiProfileSelector';
import ProfileBuilder from './ProfileBuilder';

export type ProfileMode = 'catalog' | 'custom';

interface BmcProfileStepProps {
  stepNumber: number;
  profileMode: ProfileMode;
  onProfileModeChange: (mode: ProfileMode) => void;
  selectedProfileId: string | null;
  onProfileSelect: (id: string | null) => void;
  systems: any[];
}

const BmcProfileStep: React.FC<BmcProfileStepProps> = React.memo(({
  stepNumber,
  profileMode,
  onProfileModeChange,
  selectedProfileId,
  onProfileSelect,
  systems,
}) => (
  <section className="deployment-section step-block">
    <div className="step-header">
      <div className="step-number active">{stepNumber}</div>
      <div className="step-text">
        <div className="step-title">BMC profile</div>
        <div className="step-hint">Select a vendor-specific BMC profile or build your own.</div>
      </div>
    </div>

    <div className="builder-group">
      <span className="builder-label">Profile source</span>
      <div className="toggle-presets">
        <button
          type="button"
          className={`toggle-item ${profileMode === 'catalog' ? 'active' : ''}`}
          onClick={() => onProfileModeChange('catalog')}
        >
          Select from Catalog
        </button>
        <button
          type="button"
          className={`toggle-item ${profileMode === 'custom' ? 'active' : ''}`}
          onClick={() => {
            onProfileModeChange('custom');
            onProfileSelect(null);
          }}
        >
          Build Custom Profile
        </button>
      </div>
    </div>

    {profileMode === 'catalog' && (
      <IpmiProfileSelector
        selectedProfileId={selectedProfileId}
        onProfileSelect={onProfileSelect}
      />
    )}

    {profileMode === 'custom' && (
      <ProfileBuilder systems={systems} />
    )}
  </section>
));

BmcProfileStep.displayName = 'BmcProfileStep';

export default BmcProfileStep;

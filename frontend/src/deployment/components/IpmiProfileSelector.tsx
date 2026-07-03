import React, { useState, useEffect } from 'react';
import { Check, AlertCircle } from 'lucide-react';
import { getProfileCatalog, type ProfileCatalog, type ProfileCatalogEntry } from '../../services/api';
import { formatModelFamily } from '../../utils/formatters';
import { Select } from '../../components/ui/Select';

interface IpmiProfileSelectorProps {
  selectedProfileId: string | null;
  onProfileSelect: (profileId: string | null) => void;
}

/**
 * BMC Profile selector for IPMI deployment.
 * Fetches catalog from backend, shows vendor/model dropdowns + match preview.
 */
const IpmiProfileSelector: React.FC<IpmiProfileSelectorProps> = ({ selectedProfileId, onProfileSelect }) => {
  const [catalog, setCatalog] = useState<ProfileCatalog | null>(null);
  const [selectedVendor, setSelectedVendor] = useState<string>('');
  const [selectedModel, setSelectedModel] = useState<ProfileCatalogEntry | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getProfileCatalog()
      .then(setCatalog)
      .catch(() => setError('Failed to load BMC profiles'));
  }, []);

  const vendors = catalog?.vendors || [];
  const models = vendors.find(v => v.name === selectedVendor)?.models || [];

  const handleVendorChange = (vendor: string) => {
    setSelectedVendor(vendor);
    setSelectedModel(null);
    onProfileSelect(null);
  };

  const handleModelChange = (profileId: string) => {
    const model = models.find(m => m.profile_id === profileId) || null;
    setSelectedModel(model);
    onProfileSelect(profileId);
  };

  const getTierLabel = (model: ProfileCatalogEntry) =>
    model.profile_tier === 'official' ? 'Official' : 'Experimental';
  const getTierClassName = (model: ProfileCatalogEntry) =>
    model.profile_tier === 'official' ? 'status-tag current' : 'status-tag outdated';

  if (error) {
    return (
      <div className="profile-error">
        <AlertCircle size={14} />
        <span>{error}</span>
      </div>
    );
  }

  return (
    <>
      <div className="profile-selector-row">
        <div className="builder-group">
          <span className="builder-label">Vendor</span>
          <Select
            value={selectedVendor}
            onChange={handleVendorChange}
            options={[
              { value: '', label: 'Select vendor...' },
              ...vendors.map(v => ({ value: v.name, label: v.name })),
            ]}
            className="profile-select"
            ariaLabel="Vendor"
          />
        </div>

        <div className="builder-group">
          <span className="builder-label">Model</span>
          <Select
            value={selectedProfileId || ''}
            onChange={handleModelChange}
            options={[
              { value: '', label: 'Select model...' },
              ...models.map(m => ({
                value: m.profile_id,
                label: `${formatModelFamily(m.model_family) || m.profile_id.split('/')[1]} [${getTierLabel(m)}${m.is_monitor_only ? ', Monitor-only' : ''}]`,
              })),
            ]}
            disabled={!selectedVendor}
            className="profile-select"
            ariaLabel="Model"
          />
        </div>
      </div>

      {selectedModel && (
        <div className="profile-match-card">
          <div className="profile-match-header">
            <Check size={14} />
            <span>Profile Matched: {selectedModel.profile_id}</span>
          </div>
          <div className="profile-match-details">
            <div className="profile-match-row">
              <span className="profile-detail-label">Zones</span>
              <span>{selectedModel.is_monitor_only ? 'Monitor-only (no write zones)' : selectedModel.zones.map(z => z.name).join(', ')}</span>
            </div>
            <div className="profile-match-row">
              <span className="profile-detail-label">Speed Type</span>
              <span>{selectedModel.is_monitor_only ? 'Not applicable' : selectedModel.speed_translation_type}</span>
            </div>
            <div className="profile-match-row">
              <span className="profile-detail-label">Read Speed</span>
              <span>{selectedModel.has_read_speed ? 'Supported' : 'Not available'}</span>
            </div>
            <div className="profile-match-row">
              <span className="profile-detail-label">Tier</span>
              <span className={getTierClassName(selectedModel)}>
                {getTierLabel(selectedModel)}
              </span>
            </div>
            <div className="profile-match-row">
              <span className="profile-detail-label">Control</span>
              <span>{selectedModel.is_monitor_only ? 'Monitor-only' : 'Fan control'}</span>
            </div>
            <div className="profile-match-row">
              <span className="profile-detail-label">Author</span>
              <span>{selectedModel.author}</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default IpmiProfileSelector;

import React, { useState, useEffect } from 'react';
import { Check, AlertCircle } from 'lucide-react';
import { getProfileCatalog, type ProfileCatalog, type ProfileCatalogEntry } from '../../services/api';
import { formatModelFamily } from '../../utils/formatters';

interface BmcProfilePickerProps {
  selectedProfileId: string | null;
  onProfileSelect: (profileId: string | null) => void;
  disabled?: boolean;
}

/**
 * Per-system BMC profile picker used inside SystemCard.
 * Reuses system-card design language (fan-control-row + control-label +
 * stealth-select-wrapper). Data/cascade logic mirrors the deployment-page
 * IpmiProfileSelector but renders inline-per-row instead of two-up.
 */
const BmcProfilePicker: React.FC<BmcProfilePickerProps> = ({
  selectedProfileId,
  onProfileSelect,
  disabled = false,
}) => {
  const [catalog, setCatalog] = useState<ProfileCatalog | null>(null);
  const [selectedVendor, setSelectedVendor] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getProfileCatalog()
      .then(setCatalog)
      .catch(() => setError('Failed to load BMC profiles'));
  }, []);

  // When selectedProfileId changes externally (e.g. current system profile),
  // derive the vendor so the Model dropdown is prepopulated correctly.
  useEffect(() => {
    if (!catalog || !selectedProfileId) return;
    const owningVendor = catalog.vendors.find(v =>
      v.models.some(m => m.profile_id === selectedProfileId)
    );
    if (owningVendor && owningVendor.name !== selectedVendor) {
      setSelectedVendor(owningVendor.name);
    }
  }, [catalog, selectedProfileId, selectedVendor]);

  const vendors = catalog?.vendors || [];
  const models = vendors.find(v => v.name === selectedVendor)?.models || [];
  const selectedModel: ProfileCatalogEntry | null =
    models.find(m => m.profile_id === selectedProfileId) || null;

  const handleVendorChange = (vendor: string) => {
    setSelectedVendor(vendor);
    onProfileSelect(null);
  };

  const handleModelChange = (profileId: string) => {
    onProfileSelect(profileId || null);
  };

  const getTierLabel = (model: ProfileCatalogEntry) =>
    model.profile_tier === 'official' ? 'Official' : 'Experimental';
  const getTierClassName = (model: ProfileCatalogEntry) =>
    model.profile_tier === 'official' ? 'status-tag current' : 'status-tag outdated';

  const renderModelLabel = (m: ProfileCatalogEntry) => {
    const base = formatModelFamily(m.model_family) || m.profile_id.split('/')[1];
    const tags = `${getTierLabel(m)}${m.is_monitor_only ? ', Monitor-only' : ''}`;
    return `${base} [${tags}]`;
  };

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
      <div className="fan-controls">
        <div className="fan-control-row">
          <label className="control-label">Vendor:</label>
          <div className="stealth-select-wrapper">
            <div className="select-display">
              {selectedVendor || 'Select vendor...'}
            </div>
            <select
              className="select-engine"
              value={selectedVendor}
              onChange={(e) => handleVendorChange(e.target.value)}
              disabled={disabled}
            >
              <option value="">Select vendor...</option>
              {vendors.map(v => (
                <option key={v.name} value={v.name}>{v.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="fan-control-row">
          <label className="control-label">Model:</label>
          <div className="stealth-select-wrapper">
            <div className="select-display">
              {selectedModel ? renderModelLabel(selectedModel) : 'Select model...'}
            </div>
            <select
              className="select-engine"
              value={selectedProfileId || ''}
              onChange={(e) => handleModelChange(e.target.value)}
              disabled={disabled || !selectedVendor}
            >
              <option value="">Select model...</option>
              {models.map(m => (
                <option key={m.profile_id} value={m.profile_id}>
                  {renderModelLabel(m)}
                </option>
              ))}
            </select>
          </div>
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
              <span>
                {selectedModel.is_monitor_only
                  ? 'Monitor-only (no write zones)'
                  : selectedModel.zones.map(z => z.name).join(', ')}
              </span>
            </div>
            <div className="profile-match-row">
              <span className="profile-detail-label">Speed Type</span>
              <span>
                {selectedModel.is_monitor_only ? 'Not applicable' : selectedModel.speed_translation_type}
              </span>
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

export default BmcProfilePicker;

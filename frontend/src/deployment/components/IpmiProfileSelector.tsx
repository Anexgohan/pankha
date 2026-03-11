import React, { useState, useEffect } from 'react';
import { Check, AlertCircle } from 'lucide-react';
import { getProfileCatalog, type ProfileCatalog, type ProfileCatalogEntry } from '../../services/api';

interface IpmiProfileSelectorProps {
  selectedProfileId: string | null;
  onProfileSelect: (profileId: string | null) => void;
}

/**
 * BMC Profile selector for IPMI deployment.
 * Fetches catalog from backend, shows vendor/model dropdowns + match preview.
 * Reuses .builder-group, .builder-label, .stealth-select-wrapper from existing CSS.
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
          <div className="stealth-select-wrapper profile-select-wrapper">
            <select
              className="select-engine"
              value={selectedVendor}
              onChange={(e) => handleVendorChange(e.target.value)}
            >
              <option value="">Select vendor...</option>
              {vendors.map(v => (
                <option key={v.name} value={v.name}>{v.name}</option>
              ))}
            </select>
            <div className="select-display">
              {selectedVendor || 'Select vendor...'}
            </div>
          </div>
        </div>

        <div className="builder-group">
          <span className="builder-label">Model</span>
          <div className="stealth-select-wrapper profile-select-wrapper">
            <select
              className="select-engine"
              value={selectedProfileId || ''}
              onChange={(e) => handleModelChange(e.target.value)}
              disabled={!selectedVendor}
            >
              <option value="">Select model...</option>
              {models.map(m => (
                <option key={m.profile_id} value={m.profile_id}>
                  {m.model_family.join(', ') || m.profile_id.split('/')[1]}
                </option>
              ))}
            </select>
            <div className="select-display">
              {selectedModel
                ? (selectedModel.model_family.join(', ') || selectedModel.profile_id.split('/')[1])
                : 'Select model...'}
            </div>
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
              <span>{selectedModel.zones.map(z => z.name).join(', ')}</span>
            </div>
            <div className="profile-match-row">
              <span className="profile-detail-label">Speed Type</span>
              <span>{selectedModel.speed_translation_type}</span>
            </div>
            <div className="profile-match-row">
              <span className="profile-detail-label">Read Speed</span>
              <span>{selectedModel.has_read_speed ? 'Supported' : 'Not available'}</span>
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

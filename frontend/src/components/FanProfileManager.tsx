import React, { useState, useEffect } from 'react';
import {
  getFanProfiles,
  getFanProfileStats,
  deleteFanProfile
} from '../services/fanProfilesApi';
import type {
  FanProfile,
  FanProfileStats
} from '../services/fanProfilesApi';
import FanProfileEditor from './FanProfileEditor';
import FanCurveChart from './FanCurveChart';
import ProfileImportExport from './ProfileImportExport';

const FanProfileManager: React.FC = () => {
  const [profiles, setProfiles] = useState<FanProfile[]>([]);
  const [stats, setStats] = useState<FanProfileStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<FanProfile | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [showImportExport, setShowImportExport] = useState(false);
  const [showSelectionCheckboxes, setShowSelectionCheckboxes] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [profilesData, statsData] = await Promise.all([
        getFanProfiles(),
        getFanProfileStats()
      ]);
      
      setProfiles(profilesData);
      setStats(statsData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load fan profiles');
      console.error('Error loading fan profile data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateProfile = () => {
    setSelectedProfile(null);
    setIsCreating(true);
    setShowEditor(true);
  };

  const handleEditProfile = (profile: FanProfile) => {
    setSelectedProfile(profile);
    setIsCreating(false);
    setShowEditor(true);
  };

  const handleDuplicateProfile = (profile: FanProfile) => {
    // Create a new profile based on the selected one
    const duplicatedProfile: FanProfile = {
      ...profile,
      id: 0, // Will be assigned by backend
      profile_name: `${profile.profile_name} (Copy)`,
      created_by: undefined,
      is_global: false, // Duplicates are not global by default
      assignments: [], // Clear assignments
    };

    setSelectedProfile(duplicatedProfile);
    setIsCreating(true);
    setShowEditor(true);
  };

  const handleDeleteProfile = async (profileId: number) => {
    const profile = profiles.find(p => p.id === profileId);
    if (!profile) return;

    if (!confirm(`Are you sure you want to delete the "${profile.profile_name}" profile? This action cannot be undone.`)) {
      return;
    }

    try {
      await deleteFanProfile(profileId);
      await loadData(); // Reload data
    } catch (err) {
      alert('Failed to delete profile: ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
  };

  const handleCloseEditor = () => {
    setShowEditor(false);
    setSelectedProfile(null);
    setIsCreating(false);
  };

  const handleProfileSaved = () => {
    handleCloseEditor();
    loadData(); // Reload data
  };

  const getProfileTypeIcon = (type: string) => {
    switch (type) {
      case 'silent': return '🔇';
      case 'balanced': return '⚖️';
      case 'performance': return '🚀';
      case 'custom': return '⚙️';
      default: return '📊';
    }
  };

  const getProfileTypeColor = (type: string) => {
    switch (type) {
      case 'silent': return '#4CAF50';
      case 'balanced': return '#FF9800';
      case 'performance': return '#F44336';
      case 'custom': return '#2196F3';
      default: return '#9E9E9E';
    }
  };

  if (loading) {
    return (
      <div className="fan-profile-manager loading">
        <div className="loading-spinner">
          <div className="spinner"></div>
          <p>Loading fan profiles...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="fan-profile-manager error">
        <div className="error-message">
          <h2>Error Loading Fan Profiles</h2>
          <p>{error}</p>
          <button onClick={loadData} className="retry-button">
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fan-profile-manager">
      <div className="profile-manager-header">
        <div className="header-title">
          <h2>Fan Profile Management</h2>
          <p>Create and manage custom fan curves for automatic temperature-based control</p>
        </div>
        <div className="header-actions">
          <button
            onClick={() => setShowSelectionCheckboxes(!showSelectionCheckboxes)}
            className={`selection-toggle-button ${showSelectionCheckboxes ? 'active' : ''}`}
          >
            {showSelectionCheckboxes ? '✅ Selection Mode' : '☑️ Select Profiles'}
          </button>
          <button
            onClick={() => setShowImportExport(!showImportExport)}
            className={`import-export-button ${showImportExport ? 'active' : ''}`}
          >
            📁 Import & Export
          </button>
          <button onClick={handleCreateProfile} className="create-profile-button">
            ➕ Create New Profile
          </button>
        </div>
      </div>

      {showImportExport && (
        <ProfileImportExport
          profiles={profiles}
          onImportComplete={loadData}
        />
      )}

      {stats && (
        <div className="profile-stats">
          <div className="stat-card">
            <div className="stat-value">{stats.total_profiles}</div>
            <div className="stat-label">Total Profiles</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.global_profiles}</div>
            <div className="stat-label">Global Profiles</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.active_assignments}</div>
            <div className="stat-label">Active Assignments</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.profiles_by_type.custom}</div>
            <div className="stat-label">Custom Profiles</div>
          </div>
        </div>
      )}

      <div className="profiles-grid">
        {profiles.map(profile => (
          <div key={profile.id} className="profile-card">
            <div className="profile-header">
              {showSelectionCheckboxes && (
                <div className="profile-checkbox">
                  <input
                    type="checkbox"
                    name="profile-select"
                    value={profile.id}
                    className="profile-select-checkbox"
                  />
                </div>
              )}
              <div className="profile-title">
                <span
                  className="profile-icon"
                  style={{ color: getProfileTypeColor(profile.profile_type) }}
                >
                  {getProfileTypeIcon(profile.profile_type)}
                </span>
                <div className="profile-info">
                  <h3>{profile.profile_name}</h3>
                  <span className="profile-type">{profile.profile_type}</span>
                </div>
              </div>
              <div className="profile-actions">
                <button
                  onClick={() => handleEditProfile(profile)}
                  className="action-button edit-button"
                  title="Edit profile"
                >
                  ✏️
                </button>
                <button
                  onClick={() => handleDuplicateProfile(profile)}
                  className="action-button duplicate-button"
                  title="Duplicate profile"
                >
                  📋
                </button>
                <button
                  onClick={() => handleDeleteProfile(profile.id)}
                  className="action-button delete-button"
                  title="Delete profile"
                >
                  ❌
                </button>
              </div>
            </div>

            {profile.description && (
              <p className="profile-description">{profile.description}</p>
            )}

            <div className="profile-details">
              <div className="detail-item">
                <span className="label">Curve Points:</span>
                <span className="value">{profile.curve_points?.length || 0}</span>
              </div>
              <div className="detail-item">
                <span className="label">Assignments:</span>
                <span className="value">{profile.assignments?.length || 0}</span>
              </div>
              <div className="detail-item">
                <span className="label">Global:</span>
                <span className="value">{profile.is_global ? 'Yes' : 'No'}</span>
              </div>
            </div>

            {profile.curve_points && profile.curve_points.length > 0 && (
              <div className="profile-curve-preview">
                <FanCurveChart
                  curvePoints={profile.curve_points}
                  width={420}
                  height={200}
                  showLabels={true}
                />
              </div>
            )}

            <div className="profile-badges">
              {profile.is_global && (
                <span className="badge global">Global</span>
              )}
              {profile.is_active && (
                <span className="badge active">Active</span>
              )}
              {profile.created_by === 'system' && (
                <span className="badge system">System Default</span>
              )}
            </div>
          </div>
        ))}

        {profiles.length === 0 && (
          <div className="no-profiles">
            <h3>No Fan Profiles Found</h3>
            <p>Create your first fan profile to get started with automatic temperature-based fan control.</p>
            <button onClick={handleCreateProfile} className="create-first-profile-button">
              ➕ Create Your First Profile
            </button>
          </div>
        )}
      </div>

      {showEditor && (
        <FanProfileEditor
          profile={selectedProfile}
          isCreating={isCreating}
          onClose={handleCloseEditor}
          onSave={handleProfileSaved}
        />
      )}
    </div>
  );
};

export default FanProfileManager;
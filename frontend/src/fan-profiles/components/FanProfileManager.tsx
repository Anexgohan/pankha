import React, { useState, useEffect } from 'react';
import {
  VolumeX,
  Scale,
  Rocket,
  Settings,
  Plus,
  FileUp,
  Copy,
  Trash2,
  Edit3,
  Library,
  Box,
  LayoutGrid,
  CheckSquare
} from 'lucide-react';
import {
  getFanProfiles,
  getFanProfileStats,
  deleteFanProfile,
  downloadFanProfilesExport
} from '../../services/fanProfilesApi';
import type {
  FanProfile,
  FanProfileStats
} from '../../services/fanProfilesApi';
import FanProfileEditor from './FanProfileEditor';
import FanCurveChart from './FanCurveChart';
import ProfileImportExport from './ProfileImportExport';
import { toast } from '../../utils/toast';

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
      toast.error('Failed to delete profile: ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
  };

  const handleExportSingle = async (profileId: number) => {
    try {
      await downloadFanProfilesExport({
        profile_ids: [profileId],
        include_system_profiles: true
      });
      toast.success('Profile exported successfully');
    } catch (err) {
      toast.error('Export failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
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
      case 'silent': return <VolumeX size={18} />;
      case 'balanced': return <Scale size={18} />;
      case 'performance': return <Rocket size={18} />;
      case 'custom': return <Settings size={18} />;
      default: return <Box size={18} />;
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
            {showSelectionCheckboxes ? <CheckSquare size={16} /> : <LayoutGrid size={16} />}
            <span>{showSelectionCheckboxes ? 'Selection Mode' : 'Select Profiles'}</span>
          </button>
          <button
            onClick={() => setShowImportExport(!showImportExport)}
            className={`import-export-button ${showImportExport ? 'active' : ''}`}
          >
            <Library size={16} />
            <span>Import & Export</span>
          </button>
          <button onClick={handleCreateProfile} className="create-profile-button">
            <Plus size={16} />
            <span>Create New Profile</span>
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
                  <h3 className="profile-name-text">{profile.profile_name}</h3>
                </div>
              </div>
              <div className="profile-actions">
                <button
                  onClick={() => handleExportSingle(profile.id)}
                  className="action-button export-button"
                  title="Export profile"
                >
                  <FileUp size={16} />
                </button>
                <button
                  onClick={() => handleEditProfile(profile)}
                  className="action-button edit-button"
                  title="Edit profile"
                >
                  <Edit3 size={16} />
                </button>
                <button
                  onClick={() => handleDuplicateProfile(profile)}
                  className="action-button duplicate-button"
                  title="Duplicate profile"
                >
                  <Copy size={16} />
                </button>
                <button
                  onClick={() => handleDeleteProfile(profile.id)}
                  className="action-button delete-button"
                  title="Delete profile"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>

            {profile.curve_points && profile.curve_points.length > 0 && (
              <div 
                className="profile-curve-preview clickable-graph" 
                onClick={() => handleEditProfile(profile)}
                title="Click to edit profile"
              >
                <FanCurveChart
                  curvePoints={profile.curve_points}
                  height={200}
                  showLabels={true}
                  assignmentsCount={profile.assignments?.length || 0}
                  tooltipOnly={true}
                />
              </div>
            )}

            {profile.description && (
              <p className="profile-description">{profile.description}</p>
            )}

            <div className="profile-badges">
              <span className={`badge type-${profile.profile_type.toLowerCase()}`}>
                {profile.profile_type}
              </span>
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
              <Plus size={18} />
              <span>Create Your First Profile</span>
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
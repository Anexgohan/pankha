import React, { useState, useRef, useEffect } from 'react';
import {
  downloadFanProfilesExport,
  importFanProfiles,
  getDefaultProfiles,
  loadDefaultProfiles
} from '../services/fanProfilesApi';
import type {
  ImportFanProfilesRequest,
  ImportResult,
  DefaultProfileInfo
} from '../services/fanProfilesApi';
import { getImportStatusColor } from '../utils/statusColors';
import { toast } from '../utils/toast';

interface ProfileImportExportProps {
  profiles: any[];
  onImportComplete: () => void;
}

const ProfileImportExport: React.FC<ProfileImportExportProps> = ({ onImportComplete }) => {
  const [isExporting, setIsExporting] = useState(false);
  const [isLoadingDefaults, setIsLoadingDefaults] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [showDefaultsDialog, setShowDefaultsDialog] = useState(false);
  const [resolveConflicts, setResolveConflicts] = useState<'skip' | 'rename' | 'overwrite'>('rename');
  const [defaultResolveConflicts, setDefaultResolveConflicts] = useState<'skip' | 'rename' | 'overwrite'>('skip');
  const [makeGlobal, setMakeGlobal] = useState(false);
  const [defaultProfiles, setDefaultProfiles] = useState<DefaultProfileInfo[]>([]);
  const [selectedDefaults, setSelectedDefaults] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch default profiles when dialog opens
  useEffect(() => {
    if (showDefaultsDialog) {
      fetchDefaultProfiles();
    }
  }, [showDefaultsDialog]);

  const fetchDefaultProfiles = async () => {
    try {
      const defaults = await getDefaultProfiles();
      setDefaultProfiles(defaults);
      // Pre-select profiles that don't exist yet
      const notExisting = defaults.filter(p => !p.exists_in_db).map(p => p.profile_name);
      setSelectedDefaults(new Set(notExisting));
    } catch (error) {
      console.error('Failed to fetch default profiles:', error);
      toast.error('Failed to fetch default profiles: ' + (error instanceof Error ? error.message : 'Unknown error'));
    }
  };

  const handleExportAll = async () => {
    try {
      setIsExporting(true);
      await downloadFanProfilesExport({ include_system_profiles: true });
    } catch (error) {
      console.error('Export failed:', error);
      toast.error('Export failed: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportSelected = async () => {
    try {
      const selectedProfileIds = Array.from(document.querySelectorAll('input[name="profile-select"]:checked'))
        .map((checkbox) => parseInt((checkbox as HTMLInputElement).value));

      if (selectedProfileIds.length === 0) {
        toast.error('Please select at least one profile to export');
        return;
      }

      setIsExporting(true);
      await downloadFanProfilesExport({
        profile_ids: selectedProfileIds,
        include_system_profiles: true
      });
    } catch (error) {
      console.error('Export failed:', error);
      toast.error('Export failed: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setIsExporting(false);
    }
  };

  const handleRestoreAllDefaults = async () => {
    try {
      setIsLoadingDefaults(true);
      const result = await loadDefaultProfiles({
        resolve_conflicts: 'skip'
      });
      setImportResult(result);
      if (result.imported_count > 0) {
        onImportComplete();
      }
    } catch (error) {
      console.error('Restore defaults failed:', error);
      toast.error('Restore defaults failed: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setIsLoadingDefaults(false);
    }
  };

  const handleLoadSelectedDefaults = async () => {
    try {
      if (selectedDefaults.size === 0) {
        toast.error('Please select at least one profile to load');
        return;
      }

      setIsLoadingDefaults(true);
      const result = await loadDefaultProfiles({
        profile_names: Array.from(selectedDefaults),
        resolve_conflicts: defaultResolveConflicts
      });
      setImportResult(result);
      setShowDefaultsDialog(false);
      if (result.imported_count > 0) {
        onImportComplete();
      }
    } catch (error) {
      console.error('Load defaults failed:', error);
      toast.error('Load defaults failed: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setIsLoadingDefaults(false);
    }
  };

  const toggleDefaultSelection = (profileName: string) => {
    setSelectedDefaults(prev => {
      const newSet = new Set(prev);
      if (newSet.has(profileName)) {
        newSet.delete(profileName);
      } else {
        newSet.add(profileName);
      }
      return newSet;
    });
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const data = JSON.parse(content);

        // Validate the file format
        if (!data.format || data.format !== 'pankha-fan-profiles') {
          throw new Error('Invalid file format. Expected Pankha fan profiles export.');
        }

        if (!data.profiles || !Array.isArray(data.profiles)) {
          throw new Error('Invalid file format. Expected profiles array.');
        }

        processImport(data.profiles);
      } catch (error) {
        console.error('File processing error:', error);
        toast.error('Failed to process file: ' + (error instanceof Error ? error.message : 'Invalid file format'));
      }
    };
    reader.readAsText(file);
  };

  const processImport = async (profilesToImport: any[]) => {
    try {
      setImportResult(null);

      const request: ImportFanProfilesRequest = {
        profiles: profilesToImport,
        resolve_conflicts: resolveConflicts,
        make_global: makeGlobal
      };

      const result = await importFanProfiles(request);
      setImportResult(result);

      if (result.success && result.imported_count > 0) {
        onImportComplete();
      }
    } catch (error) {
      console.error('Import failed:', error);
      toast.error('Import failed: ' + (error instanceof Error ? error.message : 'Unknown error'));
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'imported': return '✅';
      case 'skipped': return '⏭️';
      case 'error': return '❌';
      default: return '❓';
    }
  };

  return (
    <div className="profile-import-export">
      <div className="import-export-header">
        <h3>Import & Export Profiles</h3>
        <p>Share your fan profiles between systems or create backups</p>
      </div>

      <div className="import-export-actions">
        <div className="action-row">
          <button
            onClick={handleExportAll}
            disabled={isExporting}
            className="export-button all-button"
          >
            {isExporting ? '⏳ Exporting...' : '📤 Export All Profiles'}
          </button>
          <button
            onClick={handleRestoreAllDefaults}
            disabled={isLoadingDefaults}
            className="default-button restore-all-button"
          >
            {isLoadingDefaults ? '⏳ Loading...' : '🔄 Restore All Defaults'}
          </button>
          <button
            onClick={() => setShowImportDialog(true)}
            className="import-button"
          >
            📥 Import Profiles from File
          </button>
        </div>
        <div className="action-row">
          <button
            onClick={handleExportSelected}
            disabled={isExporting}
            className="export-button selected-button"
          >
            {isExporting ? '⏳ Exporting...' : '📤 Export Selected'}
          </button>
          <button
            onClick={() => setShowDefaultsDialog(true)}
            className="default-button load-defaults-button"
          >
            📋 Load Default Profiles
          </button>
        </div>
        <p className="action-hint">
          💡 Select profiles using checkboxes on the cards, then export selected. Use defaults buttons to restore factory profiles.
        </p>
      </div>

      {/* Load Defaults Dialog */}
      {showDefaultsDialog && (
        <div className="import-dialog-overlay">
          <div className="import-dialog">
            <div className="dialog-header">
              <h3>Load Default Profiles</h3>
              <button
                onClick={() => setShowDefaultsDialog(false)}
                className="close-button"
              >
                ✕
              </button>
            </div>

            <div className="dialog-content">
              <p className="dialog-description">
                Select which default profiles to load. Profiles already in your library are marked.
              </p>
              
              <div className="defaults-list">
                {defaultProfiles.map((profile) => (
                  <div key={profile.profile_name} className="default-profile-item">
                    <label className="default-profile-label">
                      <input
                        type="checkbox"
                        checked={selectedDefaults.has(profile.profile_name)}
                        onChange={() => toggleDefaultSelection(profile.profile_name)}
                      />
                      <span className="profile-info">
                        <span className="profile-name">{profile.profile_name}</span>
                        {profile.exists_in_db && (
                          <span className="exists-badge">Already exists</span>
                        )}
                      </span>
                    </label>
                    {profile.description && (
                      <p className="profile-description">{profile.description}</p>
                    )}
                  </div>
                ))}
              </div>

              <div className="import-options">
                <div className="option-group">
                  <label>If profile already exists:</label>
                  <select
                    value={defaultResolveConflicts}
                    onChange={(e) => setDefaultResolveConflicts(e.target.value as any)}
                  >
                    <option value="skip">Skip (don't import)</option>
                    <option value="rename">Rename (add suffix)</option>
                    <option value="overwrite">Overwrite (replace existing)</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="dialog-footer">
              <button
                onClick={() => setShowDefaultsDialog(false)}
                className="cancel-button"
              >
                Cancel
              </button>
              <button
                onClick={handleLoadSelectedDefaults}
                disabled={isLoadingDefaults || selectedDefaults.size === 0}
                className="confirm-button"
              >
                {isLoadingDefaults ? '⏳ Loading...' : `Load ${selectedDefaults.size} Profile${selectedDefaults.size !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import from File Dialog */}
      {showImportDialog && (
        <div className="import-dialog-overlay">
          <div className="import-dialog">
            <div className="dialog-header">
              <h3>Import Fan Profiles</h3>
              <button
                onClick={() => setShowImportDialog(false)}
                className="close-button"
              >
                ✕
              </button>
            </div>

            <div className="dialog-content">
              <div className="file-upload-section">
                <label htmlFor="file-input" className="file-upload-label">
                  📁 Choose Export File
                </label>
                <input
                  ref={fileInputRef}
                  id="file-input"
                  type="file"
                  accept=".json"
                  onChange={handleFileSelect}
                  style={{ display: 'none' }}
                />
                <p className="file-upload-hint">
                  Select a JSON file exported from Pankha
                </p>
              </div>

              <div className="import-options">
                <h4>Import Options</h4>

                <div className="option-group">
                  <label>If profile already exists:</label>
                  <select
                    value={resolveConflicts}
                    onChange={(e) => setResolveConflicts(e.target.value as any)}
                  >
                    <option value="skip">Skip (don't import)</option>
                    <option value="rename">Rename (add suffix)</option>
                    <option value="overwrite">Overwrite (replace existing)</option>
                  </select>
                </div>

                <div className="option-group checkbox-group">
                  <label>
                    <input
                      type="checkbox"
                      checked={makeGlobal}
                      onChange={(e) => setMakeGlobal(e.target.checked)}
                    />
                    Make imported profiles globally available
                  </label>
                </div>
              </div>
            </div>

            <div className="dialog-footer">
              <button
                onClick={() => setShowImportDialog(false)}
                className="cancel-button"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {importResult && (
        <div className="import-result">
          <div className="result-header">
            <h4>Import Results</h4>
            <button
              onClick={() => setImportResult(null)}
              className="close-button"
            >
              ✕
            </button>
          </div>

          <div className="result-summary">
            <div className="summary-stats">
              <span className="stat imported">
                ✅ {importResult.imported_count} imported
              </span>
              <span className="stat skipped">
                ⏭️ {importResult.skipped_count} skipped
              </span>
              <span className="stat error">
                ❌ {importResult.error_count} errors
              </span>
            </div>
          </div>

          {importResult.profiles.length > 0 && (
            <div className="result-details">
              <h5>Profile Details:</h5>
              <div className="profile-results-list">
                {importResult.profiles.map((profile, index) => (
                  <div key={index} className="profile-result-item">
                    <span
                      className="status-icon"
                      style={{ color: getImportStatusColor(profile.status) }}
                    >
                      {getStatusIcon(profile.status)}
                    </span>
                    <span className="profile-name">{profile.name}</span>
                    {profile.message && (
                      <span className="status-message">({profile.message})</span>
                    )}
                    {profile.new_id && (
                      <span className="new-id">ID: {profile.new_id}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ProfileImportExport;
import React, { useState, useRef } from 'react';
import {
  downloadFanProfilesExport,
  importFanProfiles
} from '../services/fanProfilesApi';
import type {
  ImportFanProfilesRequest,
  ImportResult
} from '../services/fanProfilesApi';

interface ProfileImportExportProps {
  profiles: any[];
  onImportComplete: () => void;
}

const ProfileImportExport: React.FC<ProfileImportExportProps> = ({ onImportComplete }) => {
  const [isExporting, setIsExporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [resolveConflicts, setResolveConflicts] = useState<'skip' | 'rename' | 'overwrite'>('rename');
  const [makeGlobal, setMakeGlobal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExportAll = async () => {
    try {
      setIsExporting(true);
      await downloadFanProfilesExport({ include_system_profiles: true });
    } catch (error) {
      console.error('Export failed:', error);
      alert('Export failed: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportSelected = async () => {
    try {
      const selectedProfileIds = Array.from(document.querySelectorAll('input[name="profile-select"]:checked'))
        .map((checkbox) => parseInt((checkbox as HTMLInputElement).value));

      if (selectedProfileIds.length === 0) {
        alert('Please select at least one profile to export');
        return;
      }

      setIsExporting(true);
      await downloadFanProfilesExport({
        profile_ids: selectedProfileIds,
        include_system_profiles: true
      });
    } catch (error) {
      console.error('Export failed:', error);
      alert('Export failed: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setIsExporting(false);
    }
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
        alert('Failed to process file: ' + (error instanceof Error ? error.message : 'Invalid file format'));
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
      alert('Import failed: ' + (error instanceof Error ? error.message : 'Unknown error'));
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

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'imported': return '#4CAF50';
      case 'skipped': return '#FF9800';
      case 'error': return '#F44336';
      default: return '#9E9E9E';
    }
  };

  return (
    <div className="profile-import-export">
      <div className="import-export-header">
        <h3>Import & Export Profiles</h3>
        <p>Share your fan profiles between systems or create backups</p>
      </div>

      <div className="import-export-actions">
        <div className="export-section">
          <h4>Export Profiles</h4>
          <div className="export-buttons">
            <button
              onClick={handleExportAll}
              disabled={isExporting}
              className="export-button all-button"
            >
              {isExporting ? '⏳ Exporting...' : '📤 Export All Profiles'}
            </button>
            <button
              onClick={handleExportSelected}
              disabled={isExporting}
              className="export-button selected-button"
            >
              {isExporting ? '⏳ Exporting...' : '📤 Export Selected'}
            </button>
          </div>
          <p className="export-hint">
            💡 Select profiles using the checkboxes on the cards, then export selected profiles.
          </p>
        </div>

        <div className="import-section">
          <h4>Import Profiles</h4>
          <button
            onClick={() => setShowImportDialog(true)}
            className="import-button"
          >
            📥 Import Profiles from File
          </button>
          <p className="import-hint">
            💡 Import fan profiles exported from another Pankha system.
          </p>
        </div>
      </div>

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
                      style={{ color: getStatusColor(profile.status) }}
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
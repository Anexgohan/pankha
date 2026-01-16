import React, { useState, useRef, useEffect } from 'react';
import {
  downloadFanProfilesExport,
  importFanProfiles,
  getDefaultProfiles,
  loadDefaultProfiles
} from '../../services/fanProfilesApi';
import type {
  ImportResult,
  DefaultProfileInfo
} from '../../services/fanProfilesApi';
import {
  FileDown,
  RefreshCw,
  FileJson,
  CheckCircle2,
  SkipForward,
  AlertCircle,
  X,
  Plus
} from 'lucide-react';
import { getImportStatusColor } from '../../utils/statusColors';
import { toast } from '../../utils/toast';

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
      toast.success('All profiles exported successfully');
    } catch (error) {
      console.error('Export failed:', error);
      toast.error('Export failed: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportSelected = async () => {
    try {
      const selectedProfileIds = Array.from(document.querySelectorAll('.profile-select-checkbox:checked'))
        .map((checkbox) => parseInt((checkbox as HTMLInputElement).value));

      if (selectedProfileIds.length === 0) {
        toast.error('Please select at least one profile using checkboxes');
        return;
      }

      setIsExporting(true);
      await downloadFanProfilesExport({
        profile_ids: selectedProfileIds,
        include_system_profiles: true
      });
      toast.success(`${selectedProfileIds.length} profiles exported`);
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
      toast.success('System default profiles restored');
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
      toast.success(`${result.imported_count} default profiles loaded`);
    } catch (error) {
      console.error('Load defaults failed:', error);
      toast.error('Load defaults failed: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setIsLoadingDefaults(false);
    }
  };

  const toggleDefaultSelection = (profileName: string) => {
    setSelectedDefaults((prev: Set<string>) => {
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
        if (!data.format || data.format !== 'pankha-fan-profiles') {
          throw new Error('Invalid file format: Expected Pankha fan profiles export.');
        }
        processImport(data.profiles);
      } catch (error) {
        toast.error('Failed to process file: ' + (error instanceof Error ? error.message : 'Invalid JSON format'));
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const processImport = async (profilesToImport: any[]) => {
    try {
      setImportResult(null);
      const result = await importFanProfiles({
        profiles: profilesToImport,
        resolve_conflicts: resolveConflicts,
        make_global: makeGlobal
      });
      setImportResult(result);
      if (result.success && result.imported_count > 0) {
        onImportComplete();
      }
    } catch (error) {
      toast.error('Import failed: ' + (error instanceof Error ? error.message : 'Unknown error'));
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'imported': return <CheckCircle2 size={14} />;
      case 'skipped': return <SkipForward size={14} />;
      case 'error': return <AlertCircle size={14} />;
      default: return null;
    }
  };

  return (
    <div className="profile-import-export glass-panel">
      <div className="import-export-header">
        <h3>Management Console</h3>
        <p>System-wide profile orchestration and library synchronization</p>
      </div>

      <div className="import-export-actions">
        <div className="management-grid">
          {/* Section: Data Portability */}
          <div className="management-section">
            <h4 className="section-label">Data Portability</h4>
            <div className="button-group">
              <button
                onClick={handleExportAll}
                disabled={isExporting}
                className="action-pill primary"
              >
                {isExporting ? <RefreshCw size={16} className="spin" /> : <FileDown size={16} />}
                <span>{isExporting ? 'Exporting...' : 'Export All Profiles'}</span>
              </button>
              <button
                onClick={handleExportSelected}
                disabled={isExporting}
                className="action-pill"
              >
                {isExporting ? <RefreshCw size={16} className="spin" /> : <Plus size={16} />}
                <span>{isExporting ? 'Exporting...' : 'Export Selected'}</span>
              </button>
            </div>
          </div>

          {/* Section: Library Initialization */}
          <div className="management-section">
            <h4 className="section-label">Library Initialization</h4>
            <div className="button-group">
              <button
                onClick={handleRestoreAllDefaults}
                disabled={isLoadingDefaults}
                className="action-pill highlight"
              >
                {isLoadingDefaults ? <RefreshCw size={16} className="spin" /> : <RefreshCw size={16} />}
                <span>{isLoadingDefaults ? 'Loading...' : 'Restore All Defaults'}</span>
              </button>
              <button
                onClick={() => setShowDefaultsDialog(true)}
                className="action-pill"
              >
                <Plus size={16} />
                <span>Load Default Profiles...</span>
              </button>
              <button
                onClick={() => setShowImportDialog(true)}
                className="action-pill"
              >
                <FileJson size={16} />
                <span>Import From File...</span>
              </button>
            </div>
          </div>
        </div>
        
        <p className="action-hint">
          <b>Note:</b> Selection-based export requires choosing profiles via checkboxes on the library cards.
        </p>
      </div>

      {/* Defaults Library Dialog */}
      {showDefaultsDialog && (
        <div className="standard-dialog-overlay">
          <div className="standard-dialog">
            <div className="dialog-header">
              <h3>System Defaults Library</h3>
              <button onClick={() => setShowDefaultsDialog(false)} className="close-btn"><X size={18} /></button>
            </div>
            <div className="dialog-content">
              <div className="defaults-list">
                {defaultProfiles.map((profile: DefaultProfileInfo) => (
                  <div key={profile.profile_name} className="default-item">
                    <label className="checkbox-wrap">
                      <input
                        type="checkbox"
                        checked={selectedDefaults.has(profile.profile_name)}
                        onChange={() => toggleDefaultSelection(profile.profile_name)}
                      />
                      <div className="item-meta">
                        <span className="profile-name">{profile.profile_name}</span>
                        {profile.exists_in_db && <span className="status-tag">In Library</span>}
                        {profile.description && <p className="desc">{profile.description}</p>}
                      </div>
                    </label>
                  </div>
                ))}
              </div>
              <div className="dialog-options">
                <label>Conflict Resolution Strategy:</label>
                <select value={defaultResolveConflicts} onChange={(e) => setDefaultResolveConflicts(e.target.value as any)}>
                  <option value="skip">Keep Existing (Skip)</option>
                  <option value="rename">Keep Both (Rename)</option>
                  <option value="overwrite">Replace Existing (Overwrite)</option>
                </select>
              </div>
            </div>
            <div className="dialog-footer">
              <button onClick={() => setShowDefaultsDialog(false)} className="btn-cancel">Cancel</button>
              <button onClick={handleLoadSelectedDefaults} disabled={isLoadingDefaults || selectedDefaults.size === 0} className="btn-confirm">
                {isLoadingDefaults ? 'Initializing...' : `Load ${selectedDefaults.size} Profiles`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* File Import Dialog */}
      {showImportDialog && (
        <div className="standard-dialog-overlay">
          <div className="standard-dialog">
            <div className="dialog-header">
              <h3>Import Profile Set</h3>
              <button onClick={() => setShowImportDialog(false)} className="close-btn"><X size={18} /></button>
            </div>
            <div className="dialog-content">
              <div className="file-drop-zone" onClick={() => fileInputRef.current?.click()}>
                <div className="drop-icon"><FileJson size={32} /></div>
                <div className="drop-text">Click to browse for .json export files</div>
                <input ref={fileInputRef} type="file" accept=".json" onChange={handleFileSelect} style={{ display: 'none' }} />
              </div>
              <div className="dialog-options">
                <div className="option-row">
                  <label>Duplication Strategy:</label>
                  <select value={resolveConflicts} onChange={(e) => setResolveConflicts(e.target.value as any)}>
                    <option value="skip">Skip Internal Conflicts</option>
                    <option value="rename">Automatic Renaming</option>
                    <option value="overwrite">System Overwrite</option>
                  </select>
                </div>
                <div className="option-row checkbox">
                  <input type="checkbox" id="global-import" checked={makeGlobal} onChange={(e) => setMakeGlobal(e.target.checked)} />
                  <label htmlFor="global-import">Grant Global Access to Imported Profiles</label>
                </div>
              </div>
            </div>
            <div className="dialog-footer">
              <button onClick={() => setShowImportDialog(false)} className="btn-cancel">Dismiss</button>
            </div>
          </div>
        </div>
      )}

      {importResult && (
        <div className="import-result-summary">
          <div className="result-header">
            <h4>Import Summary</h4>
            <button onClick={() => setImportResult(null)} className="close-btn"><X size={18} /></button>
          </div>
          <div className="stats-row">
            <div className="stat success"><span><CheckCircle2 size={14} /></span> {importResult.imported_count} Successful</div>
            <div className="stat skip"><span><SkipForward size={14} /></span> {importResult.skipped_count} Skipped</div>
            <div className="stat error"><span><AlertCircle size={14} /></span> {importResult.error_count} Faults</div>
          </div>
          {importResult.profiles.length > 0 && (
            <div className="import-details-log">
              {importResult.profiles.map((profile: any, index: number) => (
                <div key={index} className="log-entry">
                  <span className="status-bullet" style={{ color: getImportStatusColor(profile.status) }}>
                    {getStatusIcon(profile.status)}
                  </span>
                  <span className="target-name">{profile.name}</span>
                  {profile.message && <span className="log-msg"> — {profile.message}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ProfileImportExport;
import React, { useState, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom';
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
import { Select } from '../../components/ui/Select';

type ConflictStrategy = 'skip' | 'rename' | 'overwrite';

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
  const [resolveConflicts, setResolveConflicts] = useState<ConflictStrategy>('rename');
  const [defaultResolveConflicts, setDefaultResolveConflicts] = useState<ConflictStrategy>('skip');
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
        make_global: true
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
                title="Export all profiles to a JSON file"
              >
                {isExporting ? <RefreshCw size={16} className="spin" /> : <FileDown size={16} />}
                <span>{isExporting ? 'Exporting...' : 'Export All Profiles'}</span>
              </button>
              <button
                onClick={handleExportSelected}
                disabled={isExporting}
                className="action-pill"
                title="Export currently selected profiles to a JSON file"
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
                title="Reset library to system default fan curves"
              >
                {isLoadingDefaults ? <RefreshCw size={16} className="spin" /> : <RefreshCw size={16} />}
                <span>{isLoadingDefaults ? 'Loading...' : 'Restore All System Defaults'}</span>
              </button>
              <button
                onClick={() => setShowDefaultsDialog(true)}
                className="action-pill"
                title="Select specific system defaults to load into your library"
              >
                <Plus size={16} />
                <span>Load Default Profiles...</span>
              </button>
              <button
                onClick={() => setShowImportDialog(true)}
                className="action-pill"
                title="Upload profiles from a previously exported JSON file"
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

      {/* Defaults Library Dialog and Import Profile Set Dialog
       *
       * Both are rendered into document.body via portals because the parent
       * `.profile-import-export` panel has `backdrop-filter: blur(12px)`,
       * which in modern browsers establishes a containing block for
       * `position: fixed` descendants. Without the portal, the overlay
       * would be scoped to the panel's box (not the viewport) and its
       * z-index battle would happen against the panel's siblings instead
       * of against the whole page, leaving it visually trapped under
       * adjacent panels. createPortal escapes the React tree without
       * changing event bubbling semantics, so the close handlers keep
       * working unchanged.
       */}
      {showDefaultsDialog && ReactDOM.createPortal(
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
                    <label className="item-label">
                      <input
                        type="checkbox"
                        checked={selectedDefaults.has(profile.profile_name)}
                        onChange={() => toggleDefaultSelection(profile.profile_name)}
                      />
                      <div className="item-info">
                        <div className="item-main">
                          <span className="profile-name">{profile.profile_name}</span>
                          {profile.exists_in_db && <span className="existing-badge">In Library</span>}
                        </div>
                        {profile.description && <p className="profile-desc">{profile.description}</p>}
                      </div>
                    </label>
                  </div>
                ))}
              </div>
              <div className="dialog-options">
                <label>Conflict Resolution Strategy:</label>
                <Select<ConflictStrategy>
                  value={defaultResolveConflicts}
                  onChange={setDefaultResolveConflicts}
                  options={[
                    { value: 'skip', label: 'Keep Existing (Skip)' },
                    { value: 'rename', label: 'Keep Both (Rename)' },
                    { value: 'overwrite', label: 'Replace Existing (Overwrite)' },
                  ]}
                  width={240}
                  ariaLabel="Conflict resolution strategy"
                />
              </div>
            </div>
            <div className="dialog-footer">
              <button onClick={() => setShowDefaultsDialog(false)} className="btn-cancel">Cancel</button>
              <button onClick={handleLoadSelectedDefaults} disabled={isLoadingDefaults || selectedDefaults.size === 0} className="btn-confirm">
                {isLoadingDefaults ? 'Initializing...' : `Load ${selectedDefaults.size} Profiles`}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* File Import Dialog - portaled to document.body for the same
       * containing-block reason as the Defaults Library Dialog above. */}
      {showImportDialog && ReactDOM.createPortal(
        <div className="standard-dialog-overlay">
          <div className="standard-dialog">
            <div className="dialog-header">
              <h3>Import Profile Set</h3>
              <button onClick={() => setShowImportDialog(false)} className="close-btn"><X size={18} /></button>
            </div>
            <div className="dialog-content">
              <div className="file-drop-area" onClick={() => fileInputRef.current?.click()}>
                <div className="drop-zone-content">
                  <div className="drop-icon"><FileJson size={32} /></div>
                  <div className="drop-label">Click to browse for .json export files</div>
                </div>
                <input ref={fileInputRef} type="file" accept=".json" onChange={handleFileSelect} style={{ display: 'none' }} />
              </div>
              <div className="dialog-options">
                <div className="option-row">
                  <label>Duplication Strategy:</label>
                  <Select<ConflictStrategy>
                    value={resolveConflicts}
                    onChange={setResolveConflicts}
                    options={[
                      { value: 'skip', label: 'Skip Internal Conflicts' },
                      { value: 'rename', label: 'Automatic Renaming' },
                      { value: 'overwrite', label: 'System Overwrite' },
                    ]}
                    width={240}
                    ariaLabel="Duplication strategy"
                  />
                </div>
              </div>
            </div>
            <div className="dialog-footer">
              <button onClick={() => setShowImportDialog(false)} className="btn-cancel">Dismiss</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {importResult && (
        <div className="import-results">
          <div className="results-header">
            <h4>Import Summary</h4>
            <div className="summary-pills">
              <div className="pill success"><CheckCircle2 size={14} /> {importResult.imported_count} Successful</div>
              <div className="pill skip"><SkipForward size={14} /> {importResult.skipped_count} Skipped</div>
              <div className="pill error"><AlertCircle size={14} /> {importResult.error_count} Faults</div>
            </div>
            <button onClick={() => setImportResult(null)} className="clear-results" title="Dismiss"><X size={18} /></button>
          </div>
          {importResult.profiles.length > 0 && (
            <div className="results-list">
              {importResult.profiles.map((profile: any, index: number) => (
                <div key={index} className="result-line">
                  <span className="line-icon" style={{ color: getImportStatusColor(profile.status) }}>
                    {getStatusIcon(profile.status)}
                  </span>
                  <span className="line-name">{profile.name}</span>
                  {profile.message && <span className="line-message"> - {profile.message}</span>}
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
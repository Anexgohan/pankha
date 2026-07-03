import React, { useState, useEffect } from 'react';
import { Plus, Check, X, Rocket, SlidersHorizontal, ChartLine, Thermometer, AlertTriangle } from 'lucide-react';
import {
  createFanProfile,
  updateFanProfile,
  getFanProfiles
} from '../../services/fanProfilesApi';
import type {
  FanProfile,
  CreateFanProfileRequest,
  UpdateFanProfileRequest
} from '../../services/fanProfilesApi';
import {
  getFanProfileTypes,
  createFanProfileType,
  deleteFanProfileType,
  updateFanProfileTypeColor
} from '../../services/fanProfileTypesApi';
import type { FanProfileType } from '../../services/fanProfileTypesApi';
import FanCurveChart from './FanCurveChart';
import FanProfileColorPicker from './FanProfileColorPicker';
import { toast } from '../../utils/toast';
import { Select } from '../../components/ui/Select';

interface FanProfileEditorProps {
  profile?: FanProfile | null;
  isCreating: boolean;
  onClose: () => void;
  onSave: () => void;
}

interface CurvePoint {
  temperature: number;
  fan_speed: number;
}

const FanProfileEditor: React.FC<FanProfileEditorProps> = ({
  profile,
  isCreating,
  onClose,
  onSave
}) => {
  const [profileName, setProfileName] = useState('');
  const [description, setDescription] = useState('');
  const [profileType, setProfileType] = useState<string>('custom');
  const [curvePoints, setCurvePoints] = useState<CurvePoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availableProfiles, setAvailableProfiles] = useState<FanProfile[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');

  // Profile type catalog (system + user types from fan_profile_types table).
  // Loaded once on mount and refreshed after add/delete.
  const [profileTypes, setProfileTypes] = useState<FanProfileType[]>([]);
  // Inline "add new type" state. When true, the dropdown is replaced by a
  // text input + accept/cancel icon buttons. Kept inline (no modal) to match
  // the existing sidebar editing patterns.
  const [addingType, setAddingType] = useState(false);
  const [newTypeName, setNewTypeName] = useState('');
  // Default color for the inline add picker - a neutral mid-grey so the user
  // picks something intentional rather than accidentally accepting a tinted
  // default that clashes with the system palette.
  const [newTypeColor, setNewTypeColor] = useState('#9E9E9E');
  // Local override while the user is dragging in the picker for an *existing*
  // type. The committed value lives in `profileTypes` (refreshed via PATCH on
  // Done); this state just lets the trigger swatch follow the drag live.
  // `null` means "no override - show the committed color from profileTypes".
  const [pendingTypeColor, setPendingTypeColor] = useState<string | null>(null);

  // Load available profiles for template selection
  useEffect(() => {
    const loadProfiles = async () => {
      try {
        const profiles = await getFanProfiles();
        setAvailableProfiles(profiles);
      } catch (err) {
        console.error('Failed to load profiles for templates:', err);
      }
    };

    if (isCreating) {
      loadProfiles();
    }
  }, [isCreating]);

  // Load profile type catalog. Always needed (both create + edit paths show
  // the type dropdown).
  useEffect(() => {
    refreshProfileTypes();
  }, []);

  const refreshProfileTypes = async () => {
    try {
      const types = await getFanProfileTypes();
      setProfileTypes(types);
    } catch (err) {
      console.error('Failed to load profile types:', err);
    }
  };

  const handleStartAddType = () => {
    setNewTypeName('');
    setNewTypeColor('#9E9E9E');
    setAddingType(true);
  };

  const handleCancelAddType = () => {
    setAddingType(false);
    setNewTypeName('');
  };

  const handleConfirmAddType = async () => {
    const trimmed = newTypeName.trim();
    if (!trimmed) {
      handleCancelAddType();
      return;
    }
    try {
      const created = await createFanProfileType(trimmed, newTypeColor);
      await refreshProfileTypes();
      // Auto-select the newly created type so the user sees the effect
      // immediately.
      setProfileType(created.name);
      setAddingType(false);
      setNewTypeName('');
      toast.success(`Added profile type "${created.name}"`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add profile type');
    }
  };

  // Delete the currently-selected type. Wired to the [-] button. Blocked for
  // system types (the button is disabled), and for user types still in use
  // (server returns 409 - we translate to a friendly toast).
  const handleDeleteType = async () => {
    const selected = profileTypes.find(t => t.name === profileType);
    if (!selected || selected.is_system) return;

    if (!confirm(`Delete profile type "${selected.name}"? This cannot be undone.`)) {
      return;
    }

    const result = await deleteFanProfileType(selected.name);
    if (result.ok) {
      toast.success(`Deleted profile type "${selected.name}"`);
      // Fall back to 'custom' which is always present (is_system).
      setProfileType('custom');
      await refreshProfileTypes();
    } else if (result.reason === 'in_use') {
      toast.error(
        `Cannot delete "${selected.name}" - ${result.in_use_count} profile${result.in_use_count === 1 ? '' : 's'} still use${result.in_use_count === 1 ? 's' : ''} this type.`
      );
    } else {
      toast.error(result.message);
    }
  };

  const selectedTypeIsSystem =
    profileTypes.find(t => t.name === profileType)?.is_system ?? true;

  // Recolor handlers for the *existing*-type swatch. `pendingTypeColor` is
  // the live drag state shown in the trigger; onDone PATCHes the backend and
  // clears the override (the picker then reads the new color from the
  // refreshed profileTypes catalog), onCancel just drops the override.
  const selectedTypeColor =
    profileTypes.find(t => t.name === profileType)?.color || '#9E9E9E';

  const handleRecolorChange = (color: string) => {
    setPendingTypeColor(color);
  };

  const handleRecolorDone = async () => {
    if (!profileType || pendingTypeColor === null) {
      setPendingTypeColor(null);
      return;
    }
    try {
      await updateFanProfileTypeColor(profileType, pendingTypeColor);
      await refreshProfileTypes();
      toast.success(`Updated color for "${profileType}"`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update color');
    } finally {
      setPendingTypeColor(null);
    }
  };

  const handleRecolorCancel = () => {
    setPendingTypeColor(null);
  };

  useEffect(() => {
    if (profile) {
      // Load profile data whether creating (duplicate) or editing.
      // For duplicates (profile && isCreating), reflect the source in the
      // template dropdown so the user can see what they're cloning from and
      // freely switch to another template - same control surface, just
      // pre-selected. The editor never sends `profile.id` back as an update;
      // isCreating=true always routes through createFanProfile.
      setProfileName(profile.profile_name);
      setDescription(profile.description || '');
      setProfileType(profile.profile_type);
      setCurvePoints(
        profile.curve_points?.map(p => ({
          temperature: p.temperature,
          fan_speed: p.fan_speed
        })) || []
      );
      if (isCreating && profile.id) {
        setSelectedTemplateId(profile.id.toString());
      }
    } else if (isCreating) {
      // Default starter shape for "Create New Profile" - minimal 4-point curve.
      // Kept intentionally sparse so the user shapes it themselves rather than
      // editing a presumptuous default.
      setProfileName('');
      setDescription('');
      setProfileType('custom');
      setCurvePoints([
        { temperature: 0, fan_speed: 0 },
        { temperature: 40, fan_speed: 30 },
        { temperature: 60, fan_speed: 55 },
        { temperature: 80, fan_speed: 100 }
      ]);
    }
  }, [profile, isCreating]);

  const handleAddPoint = () => {
    const newTemp = curvePoints.length > 0 
      ? Math.max(...curvePoints.map(p => p.temperature)) + 10 
      : 40;
    const newSpeed = curvePoints.length > 0 
      ? curvePoints[curvePoints.length - 1].fan_speed 
      : 50;

    setCurvePoints([...curvePoints, { temperature: newTemp, fan_speed: newSpeed }]);
  };

  const handleAddPointAt = (temperature: number, fanSpeed: number) => {
    const newPoints = [...curvePoints, { temperature, fan_speed: fanSpeed }];
    // Sort immediately to maintain stable indices
    setCurvePoints(newPoints.sort((a, b) => a.temperature - b.temperature));
  };

  const handleRemovePoint = (index: number) => {
    if (curvePoints.length <= 2) {
      toast.error('A fan curve must have at least 2 points');
      return;
    }
    setCurvePoints(curvePoints.filter((_, i) => i !== index));
  };


  const handlePointChange = (index: number, temperature: number, fanSpeed: number) => {
    const newPoints = [...curvePoints];
    newPoints[index] = { temperature, fan_speed: fanSpeed };
    // Don't sort during drag - keep points in their current positions
    // Sorting will happen when drag ends
    setCurvePoints(newPoints);
  };

  const handleDragEnd = () => {
    // Re-sort points after drag completes
    setCurvePoints(prev => [...prev].sort((a, b) => a.temperature - b.temperature));
  };

  const handleTemplateSelection = (templateId: string) => {
    setSelectedTemplateId(templateId);

    if (!templateId) {
      // Reset to the starter shape (matches the initial state above).
      setCurvePoints([
        { temperature: 0, fan_speed: 0 },
        { temperature: 40, fan_speed: 30 },
        { temperature: 60, fan_speed: 55 },
        { temperature: 80, fan_speed: 100 }
      ]);
      setProfileType('custom');
      return;
    }

    const template = availableProfiles.find(p => p.id === parseInt(templateId));
    if (template && template.curve_points) {
      setCurvePoints(
        template.curve_points.map(p => ({
          temperature: p.temperature,
          fan_speed: p.fan_speed
        }))
      );
      setProfileType(template.profile_type);
    }
  };

  const validateForm = (): boolean => {
    if (!profileName.trim()) {
      setError('Profile name is required');
      return false;
    }
    
    if (curvePoints.length < 2) {
      setError('Fan curve must have at least 2 points');
      return false;
    }
    
    // Check for duplicate temperatures
    const temperatures = curvePoints.map(p => p.temperature);
    const uniqueTemperatures = new Set(temperatures);
    if (uniqueTemperatures.size !== temperatures.length) {
      setError('Fan curve cannot have duplicate temperature points');
      return false;
    }
    
    // Validate ranges
    for (const point of curvePoints) {
      if (point.temperature < 0 || point.temperature > 150) {
        setError('Temperature must be between 0°C and 150°C');
        return false;
      }
      if (point.fan_speed < 0 || point.fan_speed > 100) {
        setError('Fan speed must be between 0% and 100%');
        return false;
      }
    }
    
    setError(null);
    return true;
  };

  const handleSave = async () => {
    if (!validateForm()) return;
    
    setLoading(true);
    setError(null);
    
    try {
      if (isCreating) {
        const request: CreateFanProfileRequest = {
          profile_name: profileName.trim(),
          description: description.trim() || undefined,
          profile_type: profileType,
          is_global: true,
          curve_points: curvePoints.sort((a, b) => a.temperature - b.temperature)
        };
        
        await createFanProfile(request);
      } else {
        const request: UpdateFanProfileRequest = {
          profile_name: profileName.trim(),
          description: description.trim() || undefined,
          curve_points: curvePoints.sort((a, b) => a.temperature - b.temperature)
        };
        
        await updateFanProfile(profile!.id, request);
      }
      
      onSave();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save profile');
    } finally {
      setLoading(false);
    }
  };

  // Add index tracking for the callbacks
  const sortedWithIndices = curvePoints.map((point, index) => ({
    ...point,
    originalIndex: index
  }));

  return (
    <div className="fan-profile-editor-overlay">
      <div className="fan-profile-editor">
        <div className="editor-header">
          <h2>{isCreating ? 'Create New Fan Profile' : `Edit ${profile?.profile_name}`}</h2>
          <button onClick={onClose} className="close-button">×</button>
        </div>

        <div className="editor-body">
          <div className="editor-main">
            <div className="chart-container">
              <FanCurveChart
                curvePoints={sortedWithIndices.map((p, i) => ({
                  id: i,
                  profile_id: 0,
                  temperature: p.temperature,
                  fan_speed: p.fan_speed,
                  point_order: i + 1,
                  created_at: ''
                }))}
                width={720}
                height={480}
                showLabels={true}
                interactive={true}
                onPointChange={(sortedIndex, temperature, fanSpeed) => {
                  const originalIndex = sortedWithIndices[sortedIndex].originalIndex;
                  handlePointChange(originalIndex, temperature, fanSpeed);
                }}
                onPointRemove={(sortedIndex) => {
                  const originalIndex = sortedWithIndices[sortedIndex].originalIndex;
                  handleRemovePoint(originalIndex);
                }}
                onPointAdd={handleAddPointAt}
                onDragEnd={handleDragEnd}
              />
            </div>

            <div className="chart-controls">
              <button 
                type="button"
                onClick={handleAddPoint}
                className="control-button add-point"
                disabled={loading}
              >
                <Plus size={14} /> Add Point
              </button>
              <div className="curve-info">
                <span><ChartLine size={12} /> {curvePoints.length} points</span>
                <span><Thermometer size={12} /> {Math.min(...curvePoints.map(p => p.temperature))}°C - {Math.max(...curvePoints.map(p => p.temperature))}°C</span>
              </div>
            </div>
          </div>

          <aside className="editor-sidebar">
            {/* Quick Start Segment */}
            <div className="sidebar-group">
              <h3><Rocket size={12} /> Quick Start</h3>
              <div className="form-group">
                <label htmlFor="templateSelect">Template</label>
                <Select
                  id="templateSelect"
                  className="template-dropdown"
                  value={selectedTemplateId}
                  onChange={handleTemplateSelection}
                  options={[
                    { value: '', label: 'Starter Curve' },
                    ...availableProfiles.map((template) => ({
                      value: String(template.id),
                      label: template.profile_name,
                    })),
                  ]}
                />
              </div>
            </div>

            {/* Profile Details Segment */}
            <div className="sidebar-group fill">
              <h3><SlidersHorizontal size={12} /> Configuration</h3>
              <div className="form-group">
                <label htmlFor="profileName">Profile Name</label>
                <input
                  id="profileName"
                  type="text"
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                  placeholder="Profile Name"
                  disabled={loading}
                />
              </div>

              <div className="form-group">
                <label htmlFor="profileType">Profile Type</label>
                <div className="profile-type-row">
                  {addingType ? (
                    <>
                      <input
                        id="newTypeName"
                        type="text"
                        value={newTypeName}
                        onChange={(e) => setNewTypeName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleConfirmAddType();
                          if (e.key === 'Escape') handleCancelAddType();
                        }}
                        placeholder="new-type-name"
                        autoFocus
                        disabled={loading}
                      />
                      <FanProfileColorPicker
                        color={newTypeColor}
                        onChange={setNewTypeColor}
                        label="Badge color"
                      />
                      <button
                        type="button"
                        onClick={handleConfirmAddType}
                        className="action-button edit-button"
                        title="Save new type"
                        disabled={loading}
                      >
                        <Check size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={handleCancelAddType}
                        className="action-button delete-button"
                        title="Cancel"
                        disabled={loading}
                      >
                        <X size={16} />
                      </button>
                    </>
                  ) : (
                    <>
                      <Select
                        id="profileType"
                        value={profileType}
                        onChange={setProfileType}
                        disabled={loading}
                        options={[
                          ...profileTypes.map(t => ({ value: t.name, label: t.name })),
                          // Deleted-since type: keep a row so the trigger doesn't blank
                          ...(profileType && !profileTypes.some(t => t.name === profileType)
                            ? [{ value: profileType, label: profileType }]
                            : []),
                        ]}
                      />
                      {/* Always-visible swatch for the selected type. Opens the
                          picker; PATCHes on Done, reverts on Cancel. Works for
                          both system and user types - recoloring is cosmetic. */}
                      <FanProfileColorPicker
                        color={pendingTypeColor ?? selectedTypeColor}
                        onChange={handleRecolorChange}
                        onDone={handleRecolorDone}
                        onCancel={handleRecolorCancel}
                        label="Badge color"
                      />
                      <button
                        type="button"
                        onClick={handleStartAddType}
                        className="action-button edit-button"
                        title="Add a new profile type"
                        disabled={loading}
                      >
                        <Plus size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={handleDeleteType}
                        className="action-button delete-button"
                        title={
                          selectedTypeIsSystem
                            ? 'System profile types cannot be deleted'
                            : 'Delete this profile type'
                        }
                        disabled={loading || selectedTypeIsSystem}
                      >
                        <X size={16} />
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="description">Description</label>
                <textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Optional description..."
                  rows={10}
                  disabled={loading}
                />
              </div>
            </div>

            {/* Manual Points Info (Optional enhancement later) */}
          </aside>
        </div>

        {error && (
          <div className="editor-error">
            <AlertTriangle size={18} className="error-icon" />
            {error}
          </div>
        )}

        <div className="editor-footer">
          <button 
            onClick={onClose} 
            className="cancel-button"
            disabled={loading}
          >
            Cancel
          </button>
          <button 
            onClick={handleSave} 
            className="save-button"
            disabled={loading}
          >
            {loading ? 'Saving...' : (isCreating ? 'Create Profile' : 'Save Changes')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default FanProfileEditor;
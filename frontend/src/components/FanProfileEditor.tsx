import React, { useState, useEffect } from 'react';
import {
  createFanProfile,
  updateFanProfile,
  getFanProfiles
} from '../services/fanProfilesApi';
import type {
  FanProfile,
  CreateFanProfileRequest,
  UpdateFanProfileRequest
} from '../services/fanProfilesApi';
import FanCurveChart from './FanCurveChart';
import { toast } from '../utils/toast';

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
  const [profileType, setProfileType] = useState<'silent' | 'balanced' | 'performance' | 'custom'>('custom');
  const [isGlobal, setIsGlobal] = useState(true);
  const [curvePoints, setCurvePoints] = useState<CurvePoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availableProfiles, setAvailableProfiles] = useState<FanProfile[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');

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

  useEffect(() => {
    if (profile) {
      // Load profile data whether creating (duplicate) or editing
      setProfileName(profile.profile_name);
      setDescription(profile.description || '');
      setProfileType(profile.profile_type);
      setIsGlobal(profile.is_global);
      setCurvePoints(
        profile.curve_points?.map(p => ({
          temperature: p.temperature,
          fan_speed: p.fan_speed
        })) || []
      );
    } else if (isCreating) {
      // Only use default curve when creating from scratch (no profile provided)
      setProfileName('');
      setDescription('');
      setProfileType('custom');
      setIsGlobal(true);
      setCurvePoints([
        { temperature: 30, fan_speed: 25 },
        { temperature: 40, fan_speed: 35 },
        { temperature: 50, fan_speed: 50 },
        { temperature: 60, fan_speed: 65 },
        { temperature: 70, fan_speed: 80 },
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
      // Reset to default curve
      setCurvePoints([
        { temperature: 30, fan_speed: 25 },
        { temperature: 40, fan_speed: 35 },
        { temperature: 50, fan_speed: 50 },
        { temperature: 60, fan_speed: 65 },
        { temperature: 70, fan_speed: 80 },
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
          is_global: isGlobal,
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

        <div className="editor-content">
          {/* Step 1: Quick Start with Template */}
          <div className="profile-builder-step">
            <div className="step-header">
              <h3>🚀 Quick Start</h3>
              <p>Start from an existing profile template or create from scratch</p>
            </div>

            <div className="template-selector">
              <div className="form-group">
                <label htmlFor="templateSelect">Choose a Starting Template</label>
                <select
                  id="templateSelect"
                  className="template-dropdown"
                  value={selectedTemplateId}
                  onChange={(e) => handleTemplateSelection(e.target.value)}
                  disabled={!isCreating}
                >
                  <option value="">Default Balanced Curve (New)</option>
                  {availableProfiles.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.profile_name} ({template.curve_points?.length || 0} points)
                    </option>
                  ))}
                </select>
              </div>

              {selectedTemplateId && (() => {
                const selectedTemplate = availableProfiles.find(p => p.id === parseInt(selectedTemplateId));
                return selectedTemplate ? (
                  <div className="template-info">
                    <p>
                      <strong>📋 Using template:</strong> {selectedTemplate.profile_name}
                      {selectedTemplate.description && ` - ${selectedTemplate.description}`}
                    </p>
                  </div>
                ) : null;
              })()}
            </div>
          </div>

          {/* Step 2: Interactive Chart Editor */}
          <div className="profile-builder-step">
            <div className="step-header">
              <h3>🎯 Fine-tune Your Curve</h3>
              <p>Drag points on the chart to customize the fan curve for your needs</p>
            </div>

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
                height={450}
                showLabels={true}
                interactive={true}
                onPointChange={(sortedIndex, temperature, fanSpeed) => {
                  // Map sorted index back to original unsorted index
                  const originalIndex = sortedWithIndices[sortedIndex].originalIndex;
                  handlePointChange(originalIndex, temperature, fanSpeed);
                }}
                onPointRemove={(sortedIndex) => {
                  // Map sorted index back to original unsorted index
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
                ➕ Add Point
              </button>
              <div className="curve-info">
                <span>📊 {curvePoints.length} points</span>
                <span>🌡️ {Math.min(...curvePoints.map(p => p.temperature))}°C - {Math.max(...curvePoints.map(p => p.temperature))}°C</span>
              </div>
            </div>
          </div>

          {/* Step 3: Profile Details */}
          <div className="profile-builder-step">
            <div className="step-header">
              <h3>📝 Profile Details</h3>
              <p>Give your profile a name and configure settings</p>
            </div>
            
            <div className="profile-details">
              <div className="form-group">
                <label htmlFor="profileName">Profile Name *</label>
                <input
                  id="profileName"
                  type="text"
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                  placeholder="My Custom Fan Profile"
                  disabled={loading}
                />
              </div>

              <div className="form-group checkbox-group">
                <label>
                  <input
                    type="checkbox"
                    checked={isGlobal}
                    onChange={(e) => setIsGlobal(e.target.checked)}
                    disabled={loading}
                  />
                  Make Global (available to all systems)
                </label>
              </div>

              <div className="form-group">
                <label htmlFor="description">Description (Optional)</label>
                <textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe when to use this profile..."
                  rows={2}
                  disabled={loading}
                />
              </div>
            </div>
          </div>
        </div>

        {error && (
          <div className="editor-error">
            <span className="error-icon">⚠️</span>
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
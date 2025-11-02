import React, { useState, useEffect } from 'react';
import type { FanReading, SensorReading } from '../types/api';
import type { FanProfile } from '../services/fanProfilesApi';
import './BulkEditPanel.css';

interface BulkEditPanelProps {
  fans: FanReading[];
  sensors: SensorReading[];
  profiles: FanProfile[];
  onApply: (fanIds: string[], sensorId?: string, profileId?: number) => Promise<void>;
  getSensorDisplayName: (id: string, name: string, label: string) => string;
  getFanDisplayName: (id: string, name: string, label: string) => string;
  highestTemperature: number | null;
  isOpen: boolean;
  onClose: () => void;
}

/**
 * BulkEditPanel - Production-ready bulk fan editor
 * - Desktop: Slides from right as side panel
 * - Mobile/Tablet: Slides from bottom as bottom sheet
 * - Touch-friendly with proper mobile UX
 */
export const BulkEditPanel: React.FC<BulkEditPanelProps> = ({
  fans,
  sensors,
  profiles,
  onApply,
  getSensorDisplayName,
  getFanDisplayName,
  highestTemperature,
  isOpen,
  onClose
}) => {
  const [selectedFanIds, setSelectedFanIds] = useState<Set<string>>(new Set());
  const [bulkSensorId, setBulkSensorId] = useState<string>('');
  const [bulkProfileId, setBulkProfileId] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Reset state when panel closes
  useEffect(() => {
    if (!isOpen) {
      setSelectedFanIds(new Set());
      setBulkSensorId('');
      setBulkProfileId(undefined);
    }
  }, [isOpen]);

  // Handle ESC key to close
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  const handleToggleFan = (fanId: string) => {
    const newSet = new Set(selectedFanIds);
    if (newSet.has(fanId)) {
      newSet.delete(fanId);
    } else {
      newSet.add(fanId);
    }
    setSelectedFanIds(newSet);
  };

  const handleSelectAll = () => {
    if (selectedFanIds.size === fans.length) {
      setSelectedFanIds(new Set());
    } else {
      setSelectedFanIds(new Set(fans.map(f => f.id)));
    }
  };

  const handleApply = async () => {
    if (selectedFanIds.size === 0) {
      alert('Please select at least one fan');
      return;
    }

    if (!bulkSensorId && !bulkProfileId) {
      alert('Please select a Control Sensor or Fan Profile to apply');
      return;
    }

    try {
      setLoading(true);
      await onApply(
        Array.from(selectedFanIds),
        bulkSensorId || undefined,
        bulkProfileId
      );
      onClose();
    } catch (error) {
      alert('Failed to apply changes: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="bulk-edit-backdrop" onClick={onClose} />

      {/* Panel */}
      <div className={`bulk-edit-panel ${isMobile ? 'mobile' : 'desktop'}`}>
        {/* Mobile: Drag Handle */}
        {isMobile && (
          <div className="bulk-edit-drag-handle">
            <div className="drag-indicator" />
          </div>
        )}

        {/* Header */}
        <div className="bulk-edit-header">
          <h3>Bulk Edit Fans</h3>
          <button
            className="bulk-edit-close"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Content - Scrollable */}
        <div className="bulk-edit-content">
          {/* Master Controls */}
          <div className="bulk-edit-section">
            <h4 className="section-title">Master Controls</h4>

            <div className="control-group">
              <label htmlFor="bulk-sensor">Set Control Sensor:</label>
              <select
                id="bulk-sensor"
                className="bulk-edit-select"
                value={bulkSensorId}
                onChange={(e) => setBulkSensorId(e.target.value)}
              >
                <option value="">Don't change</option>
                <option value="__highest__">
                  🔥 Highest ({highestTemperature?.toFixed(1) || '0.0'}°C)
                </option>
                <option disabled>────────────────────</option>
                <option disabled>(Sensors)</option>
                {sensors.map((sensor) => (
                  <option key={sensor.id} value={sensor.id}>
                    {getSensorDisplayName(sensor.id, sensor.name, sensor.label)} ({sensor.temperature.toFixed(1)}°C)
                  </option>
                ))}
              </select>
            </div>

            <div className="control-group">
              <label htmlFor="bulk-profile">Set Fan Profile:</label>
              <select
                id="bulk-profile"
                className="bulk-edit-select"
                value={bulkProfileId || ''}
                onChange={(e) => setBulkProfileId(e.target.value ? parseInt(e.target.value) : undefined)}
              >
                <option value="">Don't change</option>
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.profile_name} ({profile.profile_type})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Fan Selection */}
          <div className="bulk-edit-section">
            <div className="section-header">
              <h4 className="section-title">Select Fans</h4>
              <button
                className="select-all-btn"
                onClick={handleSelectAll}
              >
                {selectedFanIds.size === fans.length ? '☑ Deselect All' : '☐ Select All'}
              </button>
            </div>

            <div className="fan-list">
              {fans.map((fan) => {
                const isSelected = selectedFanIds.has(fan.id);
                return (
                  <div
                    key={fan.id}
                    className={`fan-item ${isSelected ? 'selected' : ''}`}
                    onClick={() => handleToggleFan(fan.id)}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => handleToggleFan(fan.id)}
                      className="fan-checkbox"
                    />
                    <div className="fan-details">
                      <div className="fan-name">
                        🌀 {getFanDisplayName(fan.id, fan.name, fan.label)}
                      </div>
                      <div className="fan-id">{fan.id}</div>
                      <div className="fan-stats">
                        Current: {fan.rpm} RPM | {fan.speed}%
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer - Fixed */}
        <div className="bulk-edit-footer">
          <button
            className="btn btn-secondary"
            onClick={onClose}
            disabled={loading}
          >
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={handleApply}
            disabled={loading || selectedFanIds.size === 0}
          >
            {loading ? 'Applying...' : `Apply to ${selectedFanIds.size} fan(s)`}
          </button>
        </div>
      </div>
    </>
  );
};

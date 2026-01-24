import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { FanReading, SensorReading } from '../../types/api';
import type { FanProfile } from '../../services/fanProfilesApi';
import { sortSensorGroupIds } from '../../utils/sensorUtils';
import { formatTemperature } from '../../utils/formatters';
import { toast } from '../../utils/toast';
import { 
  X, 
  CheckSquare, 
  Square, 
  Fan 
} from 'lucide-react';
import '../styles/bulk-edit-panel.css';

interface BulkEditPanelProps {
  fans: FanReading[];
  sensors: SensorReading[];
  profiles: FanProfile[];
  onApply: (fanIds: string[], sensorId?: string, profileId?: number) => Promise<void>;
  getSensorDisplayName: (id: string, name: string, label: string) => string;
  getFanDisplayName: (id: string, name: string, label: string) => string;
  getChipDisplayName: (chipId: string) => string;
  groupSensorsByChip: (sensors: SensorReading[]) => Record<string, SensorReading[]>;
  highestTemperature: number | null;
  isOpen: boolean;
  anchorRect: DOMRect | null;
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
  getChipDisplayName,
  groupSensorsByChip,
  highestTemperature,
  isOpen,
  anchorRect,
  onClose
}) => {
  const [selectedFanIds, setSelectedFanIds] = useState<Set<string>>(new Set());
  const [bulkSensorId, setBulkSensorId] = useState<string>('');
  const [bulkProfileId, setBulkProfileId] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [panelStyles, setPanelStyles] = useState<React.CSSProperties>({});
  const panelRef = useRef<HTMLDivElement>(null);

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Calculate position contextually
  useLayoutEffect(() => {
    if (!isOpen || isMobile || !anchorRect || !panelRef.current) {
      setPanelStyles({});
      return;
    }

    const panelWidth = panelRef.current.offsetWidth;
    const gap = 12;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Default: Align to right side of card
    let left = anchorRect.right + gap;
    
    // If overflows right, try placing it to the left of the card
    if (left + panelWidth > viewportWidth - 10) {
      left = anchorRect.left - panelWidth - gap;
      
      // Safety: If it overflows left now, clamp to edge
      if (left < 10) {
        left = 10;
      }
    }

    // Vertical positioning: Align tops, then clamp to viewport
    const panelHeight = panelRef.current.offsetHeight;
    let top = anchorRect.top;
    
    // Ensure the whole panel is visible vertically
    if (top + panelHeight > viewportHeight - 10) {
      top = viewportHeight - panelHeight - 10;
    }
    
    // Never go above safety margin
    if (top < 10) top = 10;

    setPanelStyles({
      position: 'fixed',
      top: `${top}px`,
      left: `${left}px`,
      margin: 0,
      transform: 'none'
      // Width is handled by CSS to allow fit-content to work correctly
    });
  }, [isOpen, isMobile, anchorRect]);

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
      toast.error('Please select at least one fan');
      return;
    }

    if (!bulkSensorId && !bulkProfileId) {
      toast.error('Please select a Control Sensor or Fan Profile to apply');
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
      toast.error('Failed to apply changes: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div className={`bulk-edit-modal-root ${anchorRect && !isMobile ? 'contextual' : ''}`}>
      <div className="bulk-edit-backdrop" onClick={onClose} />
      <div className="bulk-edit-modal-container" onClick={(e) => e.stopPropagation()} style={panelStyles}>
        <div ref={panelRef} className={`bulk-edit-panel ${isMobile ? 'mobile' : 'desktop'}`}>
          {isMobile && (
            <div className="bulk-edit-drag-handle">
              <div className="drag-indicator" />
            </div>
          )}

          <div className="bulk-edit-header">
            <h3>Bulk Edit Fans</h3>
            <button
              className="bulk-edit-close"
              onClick={onClose}
              aria-label="Close"
            >
              <X size={20} />
            </button>
          </div>

          <div className="bulk-edit-content">
            <div className="bulk-edit-section">
              <h4 className="section-title">Master Controls</h4>

              <div className="control-group" title="The sensor used to control the speed of selected fans">
                <label htmlFor="bulk-sensor">Set Control Sensor:</label>
                <select
                  id="bulk-sensor"
                  className="bulk-edit-select"
                  value={bulkSensorId}
                  onChange={(e) => setBulkSensorId(e.target.value)}
                >
                  <option value="">Don't change</option>
                  <option value="__highest__">
                    Highest ({formatTemperature(highestTemperature, '0.0°C')})
                  </option>
                  <option disabled>────────────────────</option>

                  {(() => {
                    const sensorGroups = groupSensorsByChip(sensors);
                    const sortedGroupIds = sortSensorGroupIds(Object.keys(sensorGroups));
                    const groupsWithMultipleSensors = sortedGroupIds.filter(
                      groupId => sensorGroups[groupId].length > 1
                    );

                    if (groupsWithMultipleSensors.length === 0) return null;

                    return (
                      <>
                        <option disabled>(Groups)</option>
                        {groupsWithMultipleSensors.map(groupId => {
                          const groupSensors = sensorGroups[groupId];
                          const highestTemp = Math.max(...groupSensors.map(s => s.temperature));
                          return (
                            <option
                              key={`group-${groupId}`}
                              value={`__group__${groupId}`}
                              title="Selecting a group uses the Highest Temperature of that group"
                            >
                              {getChipDisplayName(groupId)} ({formatTemperature(highestTemp)})
                            </option>
                          );
                        })}
                        <option disabled>────────────────────</option>
                      </>
                    );
                  })()}

                  <option disabled>(Sensors)</option>
                  {sensors.map((sensor) => (
                    <option key={sensor.id} value={sensor.id}>
                      {getSensorDisplayName(sensor.id, sensor.name, sensor.label)} ({formatTemperature(sensor.temperature)})
                    </option>
                  ))}
                </select>
              </div>

              <div className="control-group" title="The behavior curve or manual speed to apply to selected fans">
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

            <div className="bulk-edit-section">
              <div className="section-header">
                <h4 className="section-title">Select Fans</h4>
                <button
                  className="select-all-btn"
                  onClick={handleSelectAll}
                >
                  {selectedFanIds.size === fans.length ? (
                    <><CheckSquare size={14} /> Deselect All</>
                  ) : (
                    <><Square size={14} /> Select All</>
                  )}
                </button>
              </div>

              <div className="fan-list">
                {fans.map((fan) => {
                  const isSelected = selectedFanIds.has(fan.id);
                  return (
                    <div
                      key={fan.id}
                      className={`bulk-edit-fan-item ${isSelected ? 'selected' : ''}`}
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
                          <Fan size={16} className={isSelected ? 'animate-fan-spin' : ''} /> {getFanDisplayName(fan.id, fan.name, fan.label)}
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
      </div>
    </div>,
    document.body
  );
};

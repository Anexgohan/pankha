import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { FanReading, SensorReading } from '../../types/api';
import type { FanProfile } from '../../services/fanProfilesApi';
import { sortSensorGroupIds, deriveSensorGroupId } from '../../utils/sensorUtils';
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

// Format zone ID for display (e.g., "cpu_zone" → "Cpu Zone") - matches SystemCard.formatZoneName
const formatZoneName = (zoneId: string): string => {
  return zoneId.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
};

/**
 * BulkEditPanel - Production-ready bulk fan editor
 * - Desktop: Slides from right as side panel
 * - Mobile/Tablet: Slides from bottom as bottom sheet
 * - Touch-friendly with proper mobile UX
 * - Zone-aware: IPMI agents render zone-grouped layout (zone = selection unit)
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
  const [selectedZoneIds, setSelectedZoneIds] = useState<Set<string>>(new Set());
  const [bulkSensorId, setBulkSensorId] = useState<string>('');
  const [bulkProfileId, setBulkProfileId] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [panelStyles, setPanelStyles] = useState<React.CSSProperties>({});
  const panelRef = useRef<HTMLDivElement>(null);

  // Zone detection - same pattern as SystemCard L1346
  const hasZones = fans.some(f => f.zone);

  // Build zone groups when zones are present - same pattern as SystemCard L1350-1354
  const zoneGroups = React.useMemo(() => {
    if (!hasZones) return new Map<string, FanReading[]>();
    const groups = new Map<string, FanReading[]>();
    for (const fan of fans) {
      const z = fan.zone || '__ungrouped__';
      if (!groups.has(z)) groups.set(z, []);
      groups.get(z)!.push(fan);
    }
    return groups;
  }, [fans, hasZones]);

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
      setSelectedZoneIds(new Set());
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

  // --- OS Agent handlers (per-fan) ---

  const handleToggleFan = (fanId: string) => {
    const newSet = new Set(selectedFanIds);
    if (newSet.has(fanId)) {
      newSet.delete(fanId);
    } else {
      newSet.add(fanId);
    }
    setSelectedFanIds(newSet);
  };

  const handleSelectAllFans = () => {
    if (selectedFanIds.size === fans.length) {
      setSelectedFanIds(new Set());
    } else {
      setSelectedFanIds(new Set(fans.map(f => f.id)));
    }
  };

  // --- IPMI Agent handlers (per-zone) ---

  const handleToggleZone = (zoneId: string) => {
    const newSet = new Set(selectedZoneIds);
    if (newSet.has(zoneId)) {
      newSet.delete(zoneId);
    } else {
      newSet.add(zoneId);
    }
    setSelectedZoneIds(newSet);
  };

  const handleSelectAllZones = () => {
    const allZoneIds = Array.from(zoneGroups.keys());
    if (selectedZoneIds.size === allZoneIds.length) {
      setSelectedZoneIds(new Set());
    } else {
      setSelectedZoneIds(new Set(allZoneIds));
    }
  };

  // Collect all fan IDs from selected zones
  const getSelectedZoneFanIds = (): string[] => {
    const fanIds: string[] = [];
    for (const zoneId of selectedZoneIds) {
      const zoneFans = zoneGroups.get(zoneId);
      if (zoneFans) {
        for (const fan of zoneFans) {
          fanIds.push(fan.id);
        }
      }
    }
    return fanIds;
  };

  // --- Shared apply handler ---

  const handleApply = async () => {
    const fanIds = hasZones ? getSelectedZoneFanIds() : Array.from(selectedFanIds);
    const selectionCount = hasZones ? selectedZoneIds.size : selectedFanIds.size;
    const selectionUnit = hasZones ? 'zone' : 'fan';

    if (selectionCount === 0) {
      toast.error(`Please select at least one ${selectionUnit}`);
      return;
    }

    if (!bulkSensorId && !bulkProfileId) {
      toast.error('Please select a Control Sensor or Fan Profile to apply');
      return;
    }

    try {
      setLoading(true);
      await onApply(fanIds, bulkSensorId || undefined, bulkProfileId);
      onClose();
    } catch (error) {
      toast.error('Failed to apply changes: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  // --- Sensor dropdown (shared between OS and IPMI) ---
  const renderSensorDropdown = () => (
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
        {[...sensors].sort((a, b) => {
          const groupA = deriveSensorGroupId(a);
          const groupB = deriveSensorGroupId(b);
          if (groupA !== groupB) return groupA.localeCompare(groupB);
          return a.id.localeCompare(b.id);
        }).map((sensor) => (
          <option key={sensor.id} value={sensor.id}>
            {getSensorDisplayName(sensor.id, sensor.name, sensor.label)} ({formatTemperature(sensor.temperature)})
          </option>
        ))}
      </select>
    </div>
  );

  // --- Profile dropdown (shared between OS and IPMI) ---
  const renderProfileDropdown = () => (
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
            {profile.profile_name} ({profile.created_by === 'system' ? 'default' : 'custom'})
          </option>
        ))}
      </select>
    </div>
  );

  // --- Zone-grouped fan list (IPMI agents) ---
  const renderZoneList = () => {
    const allZoneIds = Array.from(zoneGroups.keys());
    return (
      <div className="bulk-edit-section">
        <div className="section-header">
          <h4 className="section-title">Select Zones</h4>
          <button
            className="select-all-btn"
            onClick={handleSelectAllZones}
          >
            {selectedZoneIds.size === allZoneIds.length ? (
              <><CheckSquare size={14} /> Deselect All</>
            ) : (
              <><Square size={14} /> Select All</>
            )}
          </button>
        </div>

        <div className="fan-list">
          {allZoneIds.map((zoneId) => {
            const zoneFans = zoneGroups.get(zoneId) || [];
            const isSelected = selectedZoneIds.has(zoneId);
            return (
              <div
                key={zoneId}
                className={`bulk-edit-zone-item ${isSelected ? 'selected' : ''}`}
                onClick={() => handleToggleZone(zoneId)}
              >
                <div className="zone-header-row">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => handleToggleZone(zoneId)}
                    className="fan-checkbox"
                  />
                  <span className="zone-name">{formatZoneName(zoneId)}</span>
                  <span className="zone-fan-count">{zoneFans.length} fans</span>
                </div>
                <div className="zone-members">
                  {zoneFans.map((fan) => (
                    <div key={fan.id} className="zone-member-row">
                      <Fan size={14} />
                      <span className="zone-member-name">{getFanDisplayName(fan.id, fan.name, fan.label)}</span>
                      <span className="zone-member-stats">{fan.rpm} RPM</span>
                      <span className="zone-member-speed">{fan.speed}%</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // --- Per-fan list (OS agents) ---
  const renderFanList = () => (
    <div className="bulk-edit-section">
      <div className="section-header">
        <h4 className="section-title">Select Fans</h4>
        <button
          className="select-all-btn"
          onClick={handleSelectAllFans}
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
  );

  // --- Selection count for footer ---
  const selectionCount = hasZones ? selectedZoneIds.size : selectedFanIds.size;
  const selectionUnit = hasZones ? 'zone' : 'fan';

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
            <h3>{hasZones ? 'Bulk Edit Zones' : 'Bulk Edit Fans'}</h3>
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
              {renderSensorDropdown()}
              {renderProfileDropdown()}
            </div>

            {hasZones ? renderZoneList() : renderFanList()}
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
              disabled={loading || selectionCount === 0}
            >
              {loading ? 'Applying...' : `Apply to ${selectionCount} ${selectionUnit}(s)`}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

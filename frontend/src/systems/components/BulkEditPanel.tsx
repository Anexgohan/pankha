import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { FanReading } from '../../types/api';
import { useContextualPanel } from '../hooks/useContextualPanel';
import { toast } from '../../utils/toast';
import { Select } from '../../components/ui/Select';
import type { SelectGroup, SelectOption } from '../../components/ui/Select';
import { NO_PROFILE } from './profileSelectOptions';
import { renderSensorTrigger, renderSensorOption } from './sensorSelectOptions';
import {
  X,
  CheckSquare,
  Square,
  Fan
} from 'lucide-react';
import '../styles/bulk-edit-panel.css';

interface BulkEditPanelProps {
  fans: FanReading[];
  onApply: (fanIds: string[], sensorId?: string, profileId?: number) => Promise<void>;
  getFanDisplayName: (id: string, name: string, label: string) => string;
  // Option lists + renderers built by SystemCard - same content as the
  // per-fan Control Sensor / Fan Profile dropdowns, "" row = "Don't change"
  sensorOptions: SelectGroup<string>[];
  profileOptions: SelectGroup<number>[];
  profileRenderers: {
    renderTrigger: (selected: SelectOption<number> | null) => React.ReactNode;
    renderOption: (
      opt: SelectOption<number>,
      state: { active: boolean; selected: boolean }
    ) => React.ReactNode;
  };
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
  onApply,
  getFanDisplayName,
  sensorOptions,
  profileOptions,
  profileRenderers,
  isOpen,
  anchorRect,
  onClose
}) => {
  const [selectedFanIds, setSelectedFanIds] = useState<Set<string>>(new Set());
  const [selectedZoneIds, setSelectedZoneIds] = useState<Set<string>>(new Set());
  const [bulkSensorId, setBulkSensorId] = useState<string>('');
  const [bulkProfileId, setBulkProfileId] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const { isMobile, panelStyles, panelRef, contextual } = useContextualPanel(isOpen, anchorRect, onClose);

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

  // Reset state when panel closes
  useEffect(() => {
    if (!isOpen) {
      setSelectedFanIds(new Set());
      setSelectedZoneIds(new Set());
      setBulkSensorId('');
      setBulkProfileId(undefined);
    }
  }, [isOpen]);

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
      <Select
        id="bulk-sensor"
        value={bulkSensorId}
        onChange={setBulkSensorId}
        options={sensorOptions}
        renderTrigger={renderSensorTrigger}
        renderOption={renderSensorOption}
        searchable
        menuMaxHeight={320}
        ariaLabel="Set Control Sensor"
      />
    </div>
  );

  // --- Profile dropdown (shared between OS and IPMI) ---
  const renderProfileDropdown = () => (
    <div className="control-group" title="The behavior curve or manual speed to apply to selected fans">
      <label htmlFor="bulk-profile">Set Fan Profile:</label>
      <Select
        id="bulk-profile"
        value={bulkProfileId ?? NO_PROFILE}
        onChange={(v) => setBulkProfileId(v === NO_PROFILE ? undefined : v)}
        options={profileOptions}
        renderTrigger={profileRenderers.renderTrigger}
        renderOption={profileRenderers.renderOption}
        searchable
        ariaLabel="Set Fan Profile"
      />
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
    <div className={`bulk-edit-modal-root ${contextual ? 'contextual' : ''}`}>
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

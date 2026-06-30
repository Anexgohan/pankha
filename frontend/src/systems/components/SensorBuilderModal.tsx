import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, CheckSquare, Square } from 'lucide-react';
import type { SensorReading, VirtualSensor } from '../../types/api';
import { useContextualPanel } from '../hooks/useContextualPanel';
import { getValues } from '../../utils/uiOptions';
import {
  groupSensorsByChip,
  sortSensorGroupIds,
  computeAggregate,
  fuzzyMatch,
  type SensorAggregateOp,
} from '../../utils/sensorUtils';
import { getSensorDisplayName } from '../../utils/displayNames';
import { formatTemperature } from '../../utils/formatters';
import { createVirtualSensor, updateVirtualSensor } from '../../services/virtualSensorsApi';
import { toast } from '../../utils/toast';
import '../styles/bulk-edit-panel.css';
import '../styles/virtual-sensor-modals.css';

interface OperationOption {
  value: SensorAggregateOp;
  label: string;
  cleanLabel?: string;
  description?: string;
}

interface SensorBuilderModalProps {
  systemId: number;
  sensors: SensorReading[]; // the system's sensors; only real ones can be members
  editing?: VirtualSensor | null; // present => edit mode
  anchorRect: DOMRect | null; // card rect for contextual side-anchored positioning
  getChipDisplayName: (chipId: string, chipSensors?: SensorReading[]) => string;
  onClose: () => void;
  onSaved: () => void; // parent reloads its virtual sensors
}

/**
 * Create or edit a virtual sensor: name it, pick an operation, and choose at
 * least two member sensors. Reuses the Bulk Edit modal frame so it matches the
 * dashboard's other popups. Live-previews the combined value.
 */
const SensorBuilderModal: React.FC<SensorBuilderModalProps> = ({
  systemId,
  sensors,
  editing,
  anchorRect,
  getChipDisplayName,
  onClose,
  onSaved,
}) => {
  const operationOptions = getValues('virtualSensorOperation') as unknown as OperationOption[];

  const { isMobile, panelStyles, panelRef, contextual } = useContextualPanel(true, anchorRect, onClose);
  const [name, setName] = useState(editing?.name ?? '');
  const [operation, setOperation] = useState<SensorAggregateOp>(editing?.operation ?? 'max');
  const [selected, setSelected] = useState<Set<number>>(
    new Set((editing?.members ?? []).map((m) => m.sensor_id))
  );
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);

  // Members are real sensors only (have a DB id); never other virtual sensors.
  const realSensors = sensors.filter((s) => s.dbId != null && !s.isVirtual);
  const visibleSensors = realSensors.filter(
    (s) => fuzzyMatch(search, getSensorDisplayName(s.id, s.name, s.label)) || fuzzyMatch(search, s.id)
  );
  const groups = groupSensorsByChip(visibleSensors);
  const groupIds = sortSensorGroupIds(Object.keys(groups));

  const toggle = (dbId: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(dbId)) next.delete(dbId);
      else next.add(dbId);
      return next;
    });
  };

  // Select / deselect every (currently visible) member of a chip group at once.
  const toggleGroup = (chipId: string) => {
    const ids = (groups[chipId] ?? []).map((s) => s.dbId).filter((id): id is number => id != null);
    const allSelected = ids.length > 0 && ids.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
  };

  const selectedOption = operationOptions.find((o) => o.value === operation);
  const opLabel = selectedOption?.cleanLabel ?? selectedOption?.label ?? operation;

  const selectedTemps = realSensors
    .filter((s) => s.dbId != null && selected.has(s.dbId))
    .map((s) => s.temperature);
  const previewValue = computeAggregate(operation, selectedTemps);

  const trimmedName = name.trim();
  const valid = trimmedName.length > 0 && selected.size >= 2;

  const handleSave = async () => {
    if (!valid || saving) return;
    setSaving(true);
    try {
      const sensor_ids = [...selected];
      if (editing) {
        await updateVirtualSensor(editing.id, { name: trimmedName, operation, sensor_ids });
        toast.success('Virtual sensor updated');
      } else {
        await createVirtualSensor({ system_id: systemId, name: trimmedName, operation, sensor_ids });
        toast.success('Virtual sensor created');
      }
      onSaved();
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save virtual sensor');
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className={`bulk-edit-modal-root ${contextual ? 'contextual' : ''}`}>
      <div className="bulk-edit-backdrop" onClick={onClose} />
      <div className="bulk-edit-modal-container" onClick={(e) => e.stopPropagation()} style={panelStyles}>
        <div ref={panelRef} className={`bulk-edit-panel vs-panel ${isMobile ? 'mobile' : 'desktop'}`}>
          {isMobile && (
            <div className="bulk-edit-drag-handle">
              <div className="drag-indicator" />
            </div>
          )}
          <div className="bulk-edit-header">
            <h3>{editing ? 'Edit virtual sensor' : 'New virtual sensor'}</h3>
            <button className="bulk-edit-close" onClick={onClose} aria-label="Close">
              <X size={20} />
            </button>
          </div>

          <div className="bulk-edit-content">
            <div className="bulk-edit-section">
              <div className="form-group">
                <label htmlFor="vs-name">Name</label>
                <input
                  id="vs-name"
                  type="text"
                  value={name}
                  placeholder="e.g. Intake group"
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                />
              </div>
            </div>

            <div className="bulk-edit-section">
              <h4 className="section-title">Operation</h4>
              <select
                className="bulk-edit-select"
                value={operation}
                onChange={(e) => setOperation(e.target.value as SensorAggregateOp)}
              >
                {operationOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              {selectedOption?.description && <p className="vs-op-desc">{selectedOption.description}</p>}
            </div>

            <div className="bulk-edit-section">
              <h4 className="section-title">Sensors</h4>
              {realSensors.length === 0 ? (
                <p className="vs-op-desc">No sensors available on this system yet.</p>
              ) : (
                <>
                  <div className="form-group">
                    <input
                      type="text"
                      value={search}
                      placeholder="Search sensors"
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                  {groupIds.map((chipId) => {
                    const ids = groups[chipId].map((s) => s.dbId).filter((id): id is number => id != null);
                    const allSelected = ids.length > 0 && ids.every((id) => selected.has(id));
                    return (
                  <div key={chipId}>
                    <div className="vs-group-label">
                      <span>{getChipDisplayName(chipId, groups[chipId])}</span>
                      <button type="button" className="vs-group-select" onClick={() => toggleGroup(chipId)}>
                        {allSelected ? 'Deselect group' : 'Select group'}
                      </button>
                    </div>
                    {groups[chipId].map((s) => {
                      const isSel = s.dbId != null && selected.has(s.dbId);
                      return (
                        <button
                          key={s.id}
                          type="button"
                          className={`vs-member-row ${isSel ? 'selected' : ''}`}
                          onClick={() => s.dbId != null && toggle(s.dbId)}
                        >
                          {isSel ? <CheckSquare size={16} /> : <Square size={16} />}
                          <span className="vs-member-name">
                            {getSensorDisplayName(s.id, s.name, s.label)}
                          </span>
                          <span className="vs-member-temp">{formatTemperature(s.temperature)}</span>
                        </button>
                      );
                    })}
                  </div>
                    );
                  })}
                </>
              )}
            </div>

            <div className="bulk-edit-section">
              {valid && previewValue != null ? (
                <span className="vs-preview">
                  Preview: {opLabel} of {selected.size} = {formatTemperature(previewValue)}
                </span>
              ) : (
                <span className="vs-preview-empty">Name it and pick at least 2 sensors.</span>
              )}
            </div>
          </div>

          <div className="bulk-edit-footer">
            <button className="btn btn-secondary" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={handleSave} disabled={!valid || saving}>
              {saving ? 'Saving...' : editing ? 'Save changes' : 'Create virtual sensor'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default SensorBuilderModal;

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, CheckSquare, Square } from 'lucide-react';
import type { SensorReading, VirtualSensor } from '../../types/api';
import { getValues } from '../../utils/uiOptions';
import {
  groupSensorsByChip,
  sortSensorGroupIds,
  computeAggregate,
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
  getChipDisplayName,
  onClose,
  onSaved,
}) => {
  const operationOptions = getValues('virtualSensorOperation') as unknown as OperationOption[];

  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [name, setName] = useState(editing?.name ?? '');
  const [operation, setOperation] = useState<SensorAggregateOp>(editing?.operation ?? 'max');
  const [selected, setSelected] = useState<Set<number>>(
    new Set((editing?.members ?? []).map((m) => m.sensor_id))
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Members are real sensors only (have a DB id); never other virtual sensors.
  const realSensors = sensors.filter((s) => s.dbId != null && !s.isVirtual);
  const groups = groupSensorsByChip(realSensors);
  const groupIds = sortSensorGroupIds(Object.keys(groups));

  const toggle = (dbId: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(dbId)) next.delete(dbId);
      else next.add(dbId);
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
    <div className="bulk-edit-modal-root">
      <div className="bulk-edit-backdrop" onClick={onClose} />
      <div className="bulk-edit-modal-container">
        <div className={`bulk-edit-panel ${isMobile ? 'mobile' : 'desktop'}`}>
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
                groupIds.map((chipId) => (
                  <div key={chipId}>
                    <div className="vs-group-label">{getChipDisplayName(chipId, groups[chipId])}</div>
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
                ))
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

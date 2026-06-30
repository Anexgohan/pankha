import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, Pencil, Trash2, Eye, EyeOff } from 'lucide-react';
import type { SensorReading, VirtualSensor } from '../../types/api';
import type { VirtualSensorRow } from '../hooks/useVirtualSensors';
import { useContextualPanel } from '../hooks/useContextualPanel';
import { getValues } from '../../utils/uiOptions';
import { groupSensorsByChip, sortSensorGroupIds, fuzzyMatch } from '../../utils/sensorUtils';
import { getSensorDisplayName } from '../../utils/displayNames';
import { formatTemperature } from '../../utils/formatters';
import { InlineEdit } from '../../components/InlineEdit';
import {
  deleteVirtualSensor,
  getVirtualSensorUsage,
  type VirtualSensorUsage,
} from '../../services/virtualSensorsApi';
import { toast } from '../../utils/toast';
import '../styles/bulk-edit-panel.css';
import '../styles/virtual-sensor-modals.css';

interface ManageSensorsModalProps {
  sensors: SensorReading[]; // real sensors (current_temperatures)
  virtualRows: VirtualSensorRow[];
  anchorRect: DOMRect | null; // card rect for contextual side-anchored positioning
  isSensorHidden: (id: string) => boolean;
  onToggleSensorVisibility: (id: string, dbId?: number) => void;
  onRenameSensor: (dbId: number, label: string) => Promise<void>;
  getChipDisplayName: (chipId: string, chipSensors?: SensorReading[]) => string;
  onNewVirtual: () => void;
  onEditVirtual: (vs: VirtualSensor) => void;
  onVirtualDeleted: () => void; // reload virtual sensors after a delete
  onClose: () => void;
}

/**
 * Centralized sensor management: create/edit/delete virtual sensors, and
 * show/hide or rename real sensors. Reuses the Bulk Edit modal frame and the
 * existing InlineEdit for renaming.
 */
const ManageSensorsModal: React.FC<ManageSensorsModalProps> = ({
  sensors,
  virtualRows,
  anchorRect,
  isSensorHidden,
  onToggleSensorVisibility,
  onRenameSensor,
  getChipDisplayName,
  onNewVirtual,
  onEditVirtual,
  onVirtualDeleted,
  onClose,
}) => {
  const { isMobile, panelStyles, panelRef, contextual } = useContextualPanel(true, anchorRect, onClose);
  const [search, setSearch] = useState('');
  const [confirm, setConfirm] = useState<{ vs: VirtualSensor; fans: VirtualSensorUsage[] } | null>(null);
  const [busy, setBusy] = useState(false);

  // op value -> clean label (Max / Avg / Middle), sourced from ui-options.
  const opLabel = useMemo(() => {
    const opts = getValues('virtualSensorOperation') as unknown as { value: string; cleanLabel?: string; label: string }[];
    const map: Record<string, string> = {};
    for (const o of opts) map[o.value] = o.cleanLabel ?? o.label;
    return map;
  }, []);

  // List ALL sensors (including hidden); hidden state is shown per-row via the toggle.
  const realSensors = sensors.filter((s) => s.dbId != null && !s.isVirtual);
  const filtered = realSensors.filter(
    (s) => fuzzyMatch(search, getSensorDisplayName(s.id, s.name, s.label)) || fuzzyMatch(search, s.id)
  );
  const groups = groupSensorsByChip(filtered);
  const groupIds = sortSensorGroupIds(Object.keys(groups));

  const askDelete = async (vs: VirtualSensor) => {
    setBusy(true);
    try {
      const fans = await getVirtualSensorUsage(vs.id);
      setConfirm({ vs, fans });
    } catch {
      setConfirm({ vs, fans: [] });
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!confirm || busy) return;
    setBusy(true);
    try {
      await deleteVirtualSensor(confirm.vs.id);
      toast.success(`Deleted "${confirm.vs.name}"`);
      setConfirm(null);
      onVirtualDeleted();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete virtual sensor');
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <>
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
              <h3>Manage sensors</h3>
              <button className="bulk-edit-close" onClick={onClose} aria-label="Close">
                <X size={20} />
              </button>
            </div>

            <div className="bulk-edit-content">
              {/* Virtual sensors */}
              <div className="bulk-edit-section">
                <div className="vs-manage-toolbar">
                  <h4 className="section-title">Virtual sensors</h4>
                  <button className="vs-new-btn" onClick={onNewVirtual}>
                    <Plus size={14} /> New
                  </button>
                </div>
                {virtualRows.length === 0 ? (
                  <p className="vs-op-desc">None yet. Combine sensors, like the hotter of CPU and NVMe.</p>
                ) : (
                  virtualRows.map(({ def, reading }) => (
                    <div key={def.id} className="vs-manage-row">
                      <img src="/icons/transistor-01.png" width={20} height={20} alt="Virtual sensor" />
                      <span className="vs-member-name">{def.name}</span>
                      <span className="vs-op-badge">{opLabel[def.operation] ?? def.operation}</span>
                      <span className="vs-member-temp">
                        {Number.isNaN(reading.temperature) ? '-' : formatTemperature(reading.temperature)}
                      </span>
                      <button className="vs-icon-btn" onClick={() => onEditVirtual(def)} aria-label="Edit" title="Edit">
                        <Pencil size={16} />
                      </button>
                      <button className="vs-icon-btn danger" onClick={() => askDelete(def)} disabled={busy} aria-label="Delete" title="Delete">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))
                )}
              </div>

              {/* Real sensors */}
              <div className="bulk-edit-section">
                <h4 className="section-title">Sensors</h4>
                <div className="form-group">
                  <input
                    type="text"
                    value={search}
                    placeholder="Search sensors"
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                {groupIds.map((chipId) => (
                  <div key={chipId}>
                    <div className="vs-group-label">{getChipDisplayName(chipId, groups[chipId])}</div>
                    {groups[chipId].map((s) => {
                      const hidden = isSensorHidden(s.id);
                      return (
                        <div key={s.id} className="vs-manage-row">
                          <button
                            className="vs-icon-btn"
                            onClick={() => onToggleSensorVisibility(s.id, s.dbId)}
                            aria-label={hidden ? 'Show sensor' : 'Hide sensor'}
                            title={hidden ? 'Show sensor' : 'Hide sensor'}
                          >
                            {hidden ? <EyeOff size={16} /> : <Eye size={16} />}
                          </button>
                          <span className="vs-member-name">
                            <InlineEdit
                              value={getSensorDisplayName(s.id, s.name, s.label)}
                              hardwareId={s.id}
                              showHardwareId={false}
                              onSave={async (v) => {
                                if (s.dbId != null) await onRenameSensor(s.dbId, v);
                              }}
                            />
                          </span>
                          <span className="vs-member-temp">{formatTemperature(s.temperature)}</span>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>

            <div className="bulk-edit-footer">
              <button className="btn btn-primary" onClick={onClose}>Done</button>
            </div>
          </div>
        </div>
      </div>

      {/* Delete confirmation */}
      {confirm && (
        <div className="bulk-edit-modal-root">
          <div className="bulk-edit-backdrop" onClick={() => !busy && setConfirm(null)} />
          <div className="bulk-edit-modal-container">
            <div className={`bulk-edit-panel vs-panel ${isMobile ? 'mobile' : 'desktop'}`}>
              <div className="bulk-edit-header">
                <h3>Delete "{confirm.vs.name}"?</h3>
                <button className="bulk-edit-close" onClick={() => !busy && setConfirm(null)} aria-label="Close">
                  <X size={20} />
                </button>
              </div>
              <div className="bulk-edit-content">
                {confirm.fans.length > 0 ? (
                  <>
                    <p>This virtual sensor controls {confirm.fans.length} fan(s):</p>
                    <ul className="vs-delete-fans">
                      {confirm.fans.map((f, i) => (
                        <li key={i}>{f.fan} ({f.system})</li>
                      ))}
                    </ul>
                    <p className="vs-op-desc">
                      Deleting unassigns their control sensor; those fans fall back to no control sensor.
                    </p>
                  </>
                ) : (
                  <p>This virtual sensor isn't used by any fan.</p>
                )}
              </div>
              <div className="bulk-edit-footer">
                <button className="btn btn-secondary" onClick={() => setConfirm(null)} disabled={busy}>Cancel</button>
                <button className="btn btn-primary" onClick={confirmDelete} disabled={busy}>
                  {busy ? 'Deleting...' : confirm.fans.length > 0 ? 'Delete & unassign' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>,
    document.body
  );
};

export default ManageSensorsModal;

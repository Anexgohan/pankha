import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, Pencil, Trash2, Eye, EyeOff } from 'lucide-react';
import type { SensorReading, VirtualSensor, SensorOrderMaps } from '../../types/api';
import type { VirtualSensorRow } from '../hooks/useVirtualSensors';
import { useContextualPanel } from '../hooks/useContextualPanel';
import { getValues } from '../../utils/uiOptions';
import { groupSensorsByChip, sortSensorGroupIds, compareSensorGroups, fuzzyMatch } from '../../utils/sensorUtils';
import { sortByOrder, moveInOrder } from '../../utils/ordering';
import { getSensorDisplayName } from '../../utils/displayNames';
import { formatTemperature } from '../../utils/formatters';
import { InlineEdit } from '../../components/InlineEdit';
import { ReorderArrows } from './ReorderArrows';
import { deleteVirtualSensor, getVirtualSensorUsage } from '../../services/virtualSensorsApi';
import { toast } from '../../utils/toast';
import '../styles/bulk-edit-panel.css';
import '../styles/virtual-sensor-modals.css';

interface ManageSensorsModalProps {
  sensors: SensorReading[]; // real sensors (current_temperatures)
  virtualRows: VirtualSensorRow[];
  sensorOrder: SensorOrderMaps;
  onReorderSensors: (orderedSensorIds: number[]) => void; // within one chip group
  onReorderGroups: (orderedGroupNames: string[]) => void; // incl the '__virtual__' group
  onReorderVirtual: (orderedIds: number[]) => void;
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

const VIRTUAL_GROUP = '__virtual__';

/**
 * Centralized sensor management: create/edit/delete virtual sensors, show/hide or
 * rename real sensors, and reorder groups / sensors / virtual sensors with up-down
 * arrows (no drag-and-drop). Groups + the virtual group render in one ordered list,
 * matching the dashboard. Reordering is disabled while a search filter is active.
 */
const ManageSensorsModal: React.FC<ManageSensorsModalProps> = ({
  sensors,
  virtualRows,
  sensorOrder,
  onReorderSensors,
  onReorderGroups,
  onReorderVirtual,
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
  const reorderable = search.trim() === '';

  // Native confirm() like the rest of the app; lists the fans that get unassigned.
  const handleDeleteVirtual = async (vs: VirtualSensor) => {
    let usageNote = '';
    try {
      const fans = await getVirtualSensorUsage(vs.id);
      if (fans.length > 0) {
        usageNote =
          `\n\nControl sensor for ${fans.length} fan(s):\n` +
          fans.map((f) => `- ${f.fan} (${f.system})`).join('\n') +
          `\n\nThey will fall back to no control sensor.`;
      }
    } catch { /* best-effort usage info */ }

    if (!confirm(`Delete the "${vs.name}" virtual sensor?${usageNote}\n\nThis action cannot be undone.`)) return;
    try {
      await deleteVirtualSensor(vs.id);
      toast.success(`Deleted "${vs.name}"`);
      onVirtualDeleted();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete virtual sensor');
    }
  };

  // op value -> clean label (Max / Avg / Middle), sourced from ui-options.
  const opLabel = useMemo(() => {
    const opts = getValues('virtualSensorOperation') as unknown as { value: string; cleanLabel?: string; label: string }[];
    const map: Record<string, string> = {};
    for (const o of opts) map[o.value] = o.cleanLabel ?? o.label;
    return map;
  }, []);

  // Canonical ordered group list (hardware chips + the virtual group), matching the
  // dashboard. Built from the full sensor set so group order is stable under search.
  const realSensors = sensors.filter((s) => s.dbId != null && !s.isVirtual);
  const groupsByChip = groupSensorsByChip(realSensors);
  type GroupEntry =
    | { kind: 'hw'; name: string; sensors: SensorReading[] }
    | { kind: 'virtual'; name: string };
  const groupEntries: GroupEntry[] = sortSensorGroupIds(Object.keys(groupsByChip)).map((chipId) => ({
    kind: 'hw',
    name: chipId,
    sensors: groupsByChip[chipId],
  }));
  if (virtualRows.length > 0) groupEntries.push({ kind: 'virtual', name: VIRTUAL_GROUP });
  const orderedGroups = sortByOrder(
    groupEntries,
    (g) => sensorOrder.groups[g.name],
    (a, b) => (a.kind === 'virtual' ? 1 : b.kind === 'virtual' ? -1 : compareSensorGroups(a.name, b.name)),
  );
  const groupNames = orderedGroups.map((g) => g.name);

  const moveGroup = (name: string, dir: 'up' | 'down') => onReorderGroups(moveInOrder(groupNames, name, dir));
  const moveSensorInGroup = (chipId: string, dbId: number, dir: 'up' | 'down') => {
    const ordered = sortByOrder(
      groupsByChip[chipId],
      (s) => (s.dbId != null ? sensorOrder.sensors[s.dbId] : undefined),
    )
      .map((s) => s.dbId)
      .filter((id): id is number => id != null);
    onReorderSensors(moveInOrder(ordered, dbId, dir));
  };
  const moveVirtual = (id: number, dir: 'up' | 'down') => {
    // virtualRows already arrive ordered by sort_order from the API.
    onReorderVirtual(moveInOrder(virtualRows.map((r) => r.def.id), id, dir));
  };

  const renderHardwareGroup = (chipId: string, groupSensors: SensorReading[], gi: number) => {
    const ordered = sortByOrder(
      groupSensors,
      (s) => (s.dbId != null ? sensorOrder.sensors[s.dbId] : undefined),
    );
    const rows = ordered.filter(
      (s) => fuzzyMatch(search, getSensorDisplayName(s.id, s.name, s.label)) || fuzzyMatch(search, s.id),
    );
    if (rows.length === 0) return null; // hide groups with nothing matching the search
    return (
      <div key={chipId} className="vs-group">
        <div className="vs-group-label">
          {reorderable && (
            <ReorderArrows
              onMove={(d) => moveGroup(chipId, d)}
              canMoveUp={gi > 0}
              canMoveDown={gi < orderedGroups.length - 1}
              label={getChipDisplayName(chipId, groupSensors)}
            />
          )}
          <span>{getChipDisplayName(chipId, groupSensors)}</span>
        </div>
        {rows.map((s, si) => {
          const hidden = isSensorHidden(s.id);
          return (
            <div key={s.id} className="vs-manage-row">
              {reorderable && (
                <ReorderArrows
                  onMove={(d) => moveSensorInGroup(chipId, s.dbId as number, d)}
                  canMoveUp={si > 0}
                  canMoveDown={si < rows.length - 1}
                  label={getSensorDisplayName(s.id, s.name, s.label)}
                />
              )}
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
    );
  };

  const renderVirtualGroup = (gi: number) => {
    const rows = virtualRows.filter(({ def }) => fuzzyMatch(search, def.name));
    if (rows.length === 0) return null;
    return (
      <div key="virtual" className="vs-group">
        <div className="vs-group-label">
          {reorderable && (
            <ReorderArrows
              onMove={(d) => moveGroup(VIRTUAL_GROUP, d)}
              canMoveUp={gi > 0}
              canMoveDown={gi < orderedGroups.length - 1}
              label="Virtual Sensors"
            />
          )}
          <span>Virtual Sensors</span>
        </div>
        {rows.map(({ def, reading }, si) => (
          <div key={def.id} className="vs-manage-row">
            {reorderable && (
              <ReorderArrows
                onMove={(d) => moveVirtual(def.id, d)}
                canMoveUp={si > 0}
                canMoveDown={si < rows.length - 1}
                label={def.name}
              />
            )}
            <img src="/icons/motion-sensor-01.png" width={20} height={20} alt="Virtual sensor" />
            <span className="vs-member-name">{def.name}</span>
            <span className="vs-op-badge">{opLabel[def.operation] ?? def.operation}</span>
            <span className="vs-member-temp">
              {Number.isNaN(reading.temperature) ? '-' : formatTemperature(reading.temperature)}
            </span>
            <button className="vs-icon-btn" onClick={() => onEditVirtual(def)} aria-label="Edit" title="Edit">
              <Pencil size={16} />
            </button>
            <button className="vs-icon-btn danger" onClick={() => handleDeleteVirtual(def)} aria-label="Delete" title="Delete">
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>
    );
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
            <h3>Manage sensors</h3>
            <button className="bulk-edit-close" onClick={onClose} aria-label="Close">
              <X size={20} />
            </button>
          </div>

          <div className="bulk-edit-content">
            <div className="bulk-edit-section vs-manage-list">
              <div className="vs-manage-toolbar">
                <h4 className="section-title">Sensors</h4>
                <button className="vs-new-btn" onClick={onNewVirtual}>
                  <Plus size={14} /> New virtual
                </button>
              </div>
              <div className="form-group">
                <input
                  type="text"
                  value={search}
                  placeholder="Search sensors"
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              {!reorderable && <p className="vs-op-desc">Clear the search to reorder.</p>}
              {orderedGroups.map((g, gi) =>
                g.kind === 'virtual' ? renderVirtualGroup(gi) : renderHardwareGroup(g.name, g.sensors, gi),
              )}
            </div>
          </div>

          <div className="bulk-edit-footer">
            <button className="btn btn-primary" onClick={onClose}>Done</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default ManageSensorsModal;

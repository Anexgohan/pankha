import React from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';

interface ReorderArrowsProps {
  onMove: (dir: 'up' | 'down') => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  label?: string; // for aria labels, e.g. the row/group name
}

/**
 * Up/down reorder control (no drag-and-drop, per project convention). Shared by the
 * sensor / group / virtual-sensor rows in the Manage Sensors modal. Disabled at the ends.
 */
export const ReorderArrows: React.FC<ReorderArrowsProps> = ({ onMove, canMoveUp, canMoveDown, label }) => (
  <span className="vs-reorder">
    <button
      type="button"
      className="vs-icon-btn vs-reorder-btn"
      onClick={() => onMove('up')}
      disabled={!canMoveUp}
      aria-label={label ? `Move ${label} up` : 'Move up'}
      title="Move up"
    >
      <ChevronUp size={14} />
    </button>
    <button
      type="button"
      className="vs-icon-btn vs-reorder-btn"
      onClick={() => onMove('down')}
      disabled={!canMoveDown}
      aria-label={label ? `Move ${label} down` : 'Move down'}
      title="Move down"
    >
      <ChevronDown size={14} />
    </button>
  </span>
);

export default ReorderArrows;

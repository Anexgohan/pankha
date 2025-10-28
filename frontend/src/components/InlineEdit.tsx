import React, { useState, useEffect, useRef } from 'react';
import './InlineEdit.css';

interface InlineEditProps {
  value: string;
  hardwareId: string;
  onSave: (newValue: string) => Promise<void>;
  placeholder?: string;
  className?: string;
}

export const InlineEdit: React.FC<InlineEditProps> = ({
  value,
  hardwareId,
  onSave,
  placeholder = 'Click to edit',
  className = ''
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  useEffect(() => {
    setEditValue(value);
  }, [value]);

  const handleDoubleClick = () => {
    setIsEditing(true);
    setError(null);
  };

  const handleSave = async () => {
    if (editValue.trim() === '') {
      setError('Label cannot be empty');
      return;
    }

    if (editValue === value) {
      setIsEditing(false);
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      await onSave(editValue.trim());
      setIsEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setEditValue(value);
    setIsEditing(false);
    setError(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave();
    } else if (e.key === 'Escape') {
      handleCancel();
    }
  };

  const handleBlur = () => {
    // Small delay to allow clicking save/cancel buttons
    setTimeout(() => {
      if (isEditing && !isSaving) {
        handleSave();
      }
    }, 150);
  };

  if (isEditing) {
    return (
      <div className={`inline-edit-container editing ${className}`}>
        <input
          ref={inputRef}
          type="text"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          className="inline-edit-input"
          maxLength={255}
          disabled={isSaving}
        />
        <div className="inline-edit-actions">
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="inline-edit-save"
            title="Save (Enter)"
          >
            ✓
          </button>
          <button
            onClick={handleCancel}
            disabled={isSaving}
            className="inline-edit-cancel"
            title="Cancel (Esc)"
          >
            ✗
          </button>
        </div>
        {error && <div className="inline-edit-error">{error}</div>}
        <div className="inline-edit-hardware-id">{hardwareId}</div>
      </div>
    );
  }

  return (
    <div
      className={`inline-edit-container ${className}`}
      onDoubleClick={handleDoubleClick}
      title={`Double-click to edit\nHardware ID: ${hardwareId}`}
    >
      <span className="inline-edit-value">
        {value || placeholder}
        <span className="inline-edit-icon">✏️</span>
      </span>
      <div className="inline-edit-hardware-id">{hardwareId}</div>
    </div>
  );
};

import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import '../styles/fan-profile-color-picker.css';

interface FanProfileColorPickerProps {
  color: string;
  onChange: (color: string) => void;
  onDone?: () => void;
  onCancel?: () => void;
  label?: string;
  presets?: { name: string; color: string }[];
}

/**
 * Fan Profile Color Picker
 *
 * A fan-profile-specific copy of settings/components/ColorPicker.tsx. The
 * source picker has a hex-text label next to the swatch in its trigger; this
 * variant drops that label so the trigger is a pure swatch (the popup keeps
 * the hex input internally, so no functionality is lost).
 *
 * Class names use the `fpc-` prefix so this component can ship its own
 * styles without colliding with the settings picker if both ever render on
 * the same page.
 *
 * Two callbacks beyond the standard `onChange`:
 *  - `onDone`   fires when the user clicks Done and accepts the picked color
 *  - `onCancel` fires after the picker has restored the initial color
 * Callers wire `onDone` to backend persistence (PATCH) so the wire-write
 * happens once per commit rather than once per drag tick.
 */
const FanProfileColorPicker: React.FC<FanProfileColorPickerProps> = ({
  color,
  onChange,
  onDone,
  onCancel,
  label,
  presets,
}) => {
  const [hsv, setHsv] = useState({ h: 0, s: 0, v: 0 });
  const [isOpen, setIsOpen] = useState(false);
  const [initialColor, setInitialColor] = useState(color);
  const [dropdownPos, setDropdownPos] = useState<React.CSSProperties>({});
  const pickerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const svAreaRef = useRef<HTMLDivElement>(null);
  const hueSliderRef = useRef<HTMLDivElement>(null);

  // Convert Hex to HSV
  const hexToHsv = (hex: string) => {
    let r = 0, g = 0, b = 0;
    if (hex.length === 4) {
      r = parseInt(hex[1] + hex[1], 16);
      g = parseInt(hex[2] + hex[2], 16);
      b = parseInt(hex[3] + hex[3], 16);
    } else if (hex.length === 7) {
      r = parseInt(hex.substring(1, 3), 16);
      g = parseInt(hex.substring(3, 5), 16);
      b = parseInt(hex.substring(5, 7), 16);
    }
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0, v = max;
    const d = max - min;
    s = max === 0 ? 0 : d / max;
    if (max !== min) {
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }
    return { h: h * 360, s: s * 100, v: v * 100 };
  };

  // Convert HSV to Hex
  const hsvToHex = (h: number, s: number, v: number) => {
    h /= 360; s /= 100; v /= 100;
    let r = 0, g = 0, b = 0;
    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const t = v * (1 - (1 - f) * s);
    switch (i % 6) {
      case 0: r = v, g = t, b = p; break;
      case 1: r = q, g = v, b = p; break;
      case 2: r = p, g = v, b = t; break;
      case 3: r = p, g = q, b = v; break;
      case 4: r = t, g = p, b = v; break;
      case 5: r = v, g = p, b = q; break;
    }
    const toHex = (n: number) => {
      const hex = Math.round(n * 255).toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    };
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
  };

  // Initialize HSV from prop
  useEffect(() => {
    setHsv(hexToHsv(color));
  }, [color]);

  // Handle click outside to close (treats as Cancel - revert + notify)
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        if (isOpen) {
          onChange(initialColor);
          onCancel?.();
        }
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, initialColor, onChange, onCancel]);

  // Viewport-aware positioning - mirrors settings/ColorPicker (BulkEditPanel
  // pattern). Anchors to the trigger rect, prefers below + right-aligned,
  // flips above if the bottom would overflow, then clamps so the dropdown
  // stays fully on-screen. visibility:hidden until first compute lands so it
  // never flashes at its default off-screen position.
  useLayoutEffect(() => {
    if (!isOpen) {
      setDropdownPos({});
      return;
    }
    const compute = () => {
      const trigger = triggerRef.current;
      const dropdown = pickerRef.current?.querySelector<HTMLDivElement>('.fpc-dropdown');
      if (!trigger || !dropdown) return;
      const r = trigger.getBoundingClientRect();
      const panelWidth = dropdown.offsetWidth;
      const panelHeight = dropdown.offsetHeight;
      const vv = (window as Window & { visualViewport?: VisualViewport }).visualViewport;
      const viewportWidth = vv?.width ?? window.innerWidth;
      const viewportHeight = vv?.height ?? window.innerHeight;
      const gap = 8;
      const edge = 10;

      let left = r.right - panelWidth;
      if (left < edge) left = r.left;
      if (left + panelWidth > viewportWidth - edge) left = viewportWidth - panelWidth - edge;
      if (left < edge) left = edge;

      const spaceBelow = viewportHeight - r.bottom - gap - edge;
      const spaceAbove = r.top - gap - edge;
      let top: number;
      let maxHeight: number;
      if (panelHeight <= spaceBelow) {
        top = r.bottom + gap;
        maxHeight = spaceBelow;
      } else if (panelHeight <= spaceAbove) {
        top = r.top - panelHeight - gap;
        maxHeight = spaceAbove;
      } else if (spaceBelow >= spaceAbove) {
        top = r.bottom + gap;
        maxHeight = spaceBelow;
      } else {
        top = edge;
        maxHeight = spaceAbove;
      }

      setDropdownPos({
        position: 'fixed',
        top,
        left,
        right: 'auto',
        bottom: 'auto',
        maxHeight,
        overflowY: 'auto',
        visibility: 'visible',
      });
    };
    compute();
    window.addEventListener('resize', compute);
    window.addEventListener('scroll', compute, true);
    const vv = (window as Window & { visualViewport?: VisualViewport }).visualViewport;
    vv?.addEventListener('resize', compute);
    return () => {
      window.removeEventListener('resize', compute);
      window.removeEventListener('scroll', compute, true);
      vv?.removeEventListener('resize', compute);
    };
  }, [isOpen]);

  const handleSvChange = useCallback((e: React.MouseEvent | React.TouchEvent | MouseEvent | TouchEvent) => {
    if (!svAreaRef.current) return;
    const rect = svAreaRef.current.getBoundingClientRect();
    const x = 'touches' in e ? e.touches[0].clientX : (e as MouseEvent).clientX;
    const y = 'touches' in e ? e.touches[0].clientY : (e as MouseEvent).clientY;

    let s = ((x - rect.left) / rect.width) * 100;
    let v = (1 - (y - rect.top) / rect.height) * 100;

    s = Math.max(0, Math.min(100, s));
    v = Math.max(0, Math.min(100, v));

    const newHsv = { ...hsv, s, v };
    setHsv(newHsv);
    onChange(hsvToHex(newHsv.h, newHsv.s, newHsv.v));
  }, [hsv, onChange]);

  const handleHueChange = useCallback((e: React.MouseEvent | React.TouchEvent | MouseEvent | TouchEvent) => {
    if (!hueSliderRef.current) return;
    const rect = hueSliderRef.current.getBoundingClientRect();
    const x = 'touches' in e ? e.touches[0].clientX : (e as MouseEvent).clientX;

    let h = ((x - rect.left) / rect.width) * 360;
    h = Math.max(0, Math.min(360, h));

    const newHsv = { ...hsv, h };
    setHsv(newHsv);
    onChange(hsvToHex(newHsv.h, newHsv.s, newHsv.v));
  }, [hsv, onChange]);

  const startDrag = (type: 'sv' | 'hue') => {
    const moveHandler = type === 'sv' ? handleSvChange : handleHueChange;
    const upHandler = () => {
      document.removeEventListener('mousemove', moveHandler);
      document.removeEventListener('mouseup', upHandler);
      document.removeEventListener('touchmove', moveHandler);
      document.removeEventListener('touchend', upHandler);
    };
    document.addEventListener('mousemove', moveHandler);
    document.addEventListener('mouseup', upHandler);
    document.addEventListener('touchmove', moveHandler);
    document.addEventListener('touchend', upHandler);
  };

  return (
    <div className="fpc-container" ref={pickerRef}>
      <div
        className="fpc-trigger"
        ref={triggerRef}
        onClick={() => {
          if (!isOpen) setInitialColor(color);
          setIsOpen(!isOpen);
        }}
        style={{ '--current-color': color, touchAction: 'manipulation' } as React.CSSProperties}
        title="Edit badge color"
      >
        <div className="fpc-trigger-preview" />
      </div>

      {isOpen && (
        <div
          className="fpc-dropdown fpc-glass-panel fpc-animate-in"
          style={{ visibility: 'hidden', ...dropdownPos }}
        >
          <div className="fpc-header">
            {label && <div className="fpc-label">{label}</div>}
            {presets && (
              <div className="fpc-presets">
                {presets.map(p => (
                  <button
                    key={p.color}
                    className={`fpc-preset-swatch ${color === p.color ? 'active' : ''}`}
                    style={{ backgroundColor: p.color } as React.CSSProperties}
                    onClick={() => onChange(p.color)}
                    title={p.name}
                  />
                ))}
              </div>
            )}
          </div>

          <div
            className="fpc-sv-area"
            ref={svAreaRef}
            onMouseDown={(e) => { handleSvChange(e); startDrag('sv'); }}
            onTouchStart={(e) => { handleSvChange(e); startDrag('sv'); }}
            style={{ backgroundColor: `hsl(${hsv.h}, 100%, 50%)` }}
          >
            <div className="fpc-sv-gradient fpc-sv-white" />
            <div className="fpc-sv-gradient fpc-sv-black" />
            <div
              className="fpc-sv-pointer"
              style={{
                left: `${hsv.s}%`,
                top: `${100 - hsv.v}%`
              }}
            />
          </div>

          <div
            className="fpc-hue-slider"
            ref={hueSliderRef}
            onMouseDown={(e) => { handleHueChange(e); startDrag('hue'); }}
            onTouchStart={(e) => { handleHueChange(e); startDrag('hue'); }}
          >
            <div className="fpc-hue-track" />
            <div
              className="fpc-hue-pointer"
              style={{ left: `${(hsv.h / 360) * 100}%` }}
            />
          </div>

          <div className="fpc-controls">
            <div className="fpc-hex-manual">
              <input
                type="text"
                value={color}
                onChange={(e) => {
                  const val = e.target.value;
                  if (/^#[0-9A-F]{0,6}$/i.test(val)) {
                    onChange(val);
                  }
                }}
                onBlur={() => {
                  if (color.length < 7) {
                    onChange(hsvToHex(hsv.h, hsv.s, hsv.v));
                  }
                }}
              />
            </div>
            <div className="fpc-actions">
              <button
                className="fpc-cancel-btn"
                onClick={() => {
                  onChange(initialColor);
                  setIsOpen(false);
                  onCancel?.();
                }}
              >
                Cancel
              </button>
              <button
                className="fpc-done-btn"
                onClick={() => {
                  setIsOpen(false);
                  onDone?.();
                }}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FanProfileColorPicker;

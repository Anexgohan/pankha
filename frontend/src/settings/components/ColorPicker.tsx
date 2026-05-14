import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import '../styles/settings.css';

interface ColorPickerProps {
  color: string;
  onChange: (color: string) => void;
  label?: string;
  presets?: { name: string; color: string }[];
}

/**
 * Professional custom color picker
 * Features:
 * - Saturation/Value (SV) selection 2D area
 * - Hue selection 1D slider
 * - Real-time preview
 * - Tactile, glassmorphism design
 * - Integrated tactical presets
 */
const ColorPicker: React.FC<ColorPickerProps> = ({ color, onChange, label, presets }) => {
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

  // Handle click outside to close
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Viewport-aware positioning — anchors to the trigger rect, prefers below
  // and right-aligned, flips above if the bottom would overflow, then clamps
  // so the dropdown stays fully on-screen. Sets max-height so its inner
  // content scrolls when it can't fully fit either way. Same pattern as
  // BulkEditPanel.tsx L92. Held visibility:hidden until first compute lands
  // so the dropdown never paints at its CSS-default off-screen position.
  useLayoutEffect(() => {
    if (!isOpen) {
      setDropdownPos({});
      return;
    }
    const compute = () => {
      const trigger = triggerRef.current;
      const dropdown = pickerRef.current?.querySelector<HTMLDivElement>('.picker-dropdown');
      if (!trigger || !dropdown) return;
      const r = trigger.getBoundingClientRect();
      const panelWidth = dropdown.offsetWidth;
      const panelHeight = dropdown.offsetHeight;
      const vv = (window as Window & { visualViewport?: VisualViewport }).visualViewport;
      const viewportWidth = vv?.width ?? window.innerWidth;
      const viewportHeight = vv?.height ?? window.innerHeight;
      const gap = 8;
      const edge = 10;

      // Horizontal: right-align to trigger; flip to left-align if right
      // would overflow the left edge; clamp inside viewport.
      let left = r.right - panelWidth;
      if (left < edge) left = r.left;
      if (left + panelWidth > viewportWidth - edge) left = viewportWidth - panelWidth - edge;
      if (left < edge) left = edge;

      // Vertical: prefer below; flip above if bottom would overflow and
      // above has more room; otherwise pin to the edge with scroll.
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
    <div className="custom-color-picker-container" ref={pickerRef}>
      <div
        className="picker-trigger"
        ref={triggerRef}
        onClick={() => {
          if (!isOpen) setInitialColor(color);
          setIsOpen(!isOpen);
        }}
        style={{ '--current-color': color, touchAction: 'manipulation' } as React.CSSProperties}
      >
        <div className="trigger-preview" />
        <span className="trigger-hex">{color}</span>
      </div>

      {isOpen && (
        <div
          className="picker-dropdown glass-panel animate-in"
          style={{ visibility: 'hidden', ...dropdownPos }}
        >
          <div className="picker-header">
            {label && <div className="picker-label">{label}</div>}
            {presets && (
              <div className="picker-presets">
                {presets.map(p => (
                  <button
                    key={p.color}
                    className={`picker-preset-swatch ${color === p.color ? 'active' : ''}`}
                    style={{ backgroundColor: p.color } as React.CSSProperties}
                    onClick={() => onChange(p.color)}
                    title={p.name}
                  />
                ))}
              </div>
            )}
          </div>
          
          <div 
            className="sv-area" 
            ref={svAreaRef}
            onMouseDown={(e) => { handleSvChange(e); startDrag('sv'); }}
            onTouchStart={(e) => { handleSvChange(e); startDrag('sv'); }}
            style={{ backgroundColor: `hsl(${hsv.h}, 100%, 50%)` }}
          >
            <div className="sv-gradient sv-white" />
            <div className="sv-gradient sv-black" />
            <div 
              className="sv-pointer"
              style={{ 
                left: `${hsv.s}%`, 
                top: `${100 - hsv.v}%` 
              }}
            />
          </div>

          <div 
            className="hue-slider" 
            ref={hueSliderRef}
            onMouseDown={(e) => { handleHueChange(e); startDrag('hue'); }}
            onTouchStart={(e) => { handleHueChange(e); startDrag('hue'); }}
          >
            <div className="hue-track" />
            <div 
              className="hue-pointer"
              style={{ left: `${(hsv.h / 360) * 100}%` }}
            />
          </div>

          <div className="picker-controls">
             <div className="hex-manual">
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
             <div className="picker-actions">
                <button 
                  className="cancel-btn" 
                  onClick={() => {
                    onChange(initialColor);
                    setIsOpen(false);
                  }}
                >
                  Cancel
                </button>
                <button className="done-btn" onClick={() => setIsOpen(false)}>Done</button>
             </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ColorPicker;

import React, { useCallback, useRef } from 'react';

export interface ThresholdValues {
  caution: number;
  warning: number;
  critical: number;
}

export interface ThresholdColors {
  normal: string;
  caution: string;
  warning: string;
  critical: string;
}

interface Props {
  values: ThresholdValues;
  colors: ThresholdColors;
  onChange: (next: ThresholdValues) => void;
  min?: number;
  max?: number;
  readOnly?: boolean;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

const ThresholdStrip: React.FC<Props> = ({
  values,
  colors,
  onChange,
  min = 0,
  max = 110,
  readOnly = false,
}) => {
  const trackRef = useRef<HTMLDivElement>(null);

  const visualMax = max;
  const pct = (v: number) => (clamp(v, min, visualMax) - min) / (visualMax - min) * 100;

  const handleDrag = useCallback(
    (key: keyof ThresholdValues) => (e: React.PointerEvent) => {
      if (readOnly) return;
      e.preventDefault();
      const track = trackRef.current;
      if (!track) return;
      track.setPointerCapture(e.pointerId);

      const move = (ev: PointerEvent) => {
        const rect = track.getBoundingClientRect();
        const x = ev.clientX - rect.left;
        let v = Math.round(min + (x / rect.width) * (visualMax - min));
        if (key === 'caution') v = clamp(v, min + 1, values.warning - 1);
        if (key === 'warning') v = clamp(v, values.caution + 1, values.critical - 1);
        if (key === 'critical') v = clamp(v, values.warning + 1, visualMax);
        onChange({ ...values, [key]: v });
      };
      const up = () => {
        track.removeEventListener('pointermove', move);
        track.removeEventListener('pointerup', up);
        track.removeEventListener('pointercancel', up);
      };
      track.addEventListener('pointermove', move);
      track.addEventListener('pointerup', up);
      track.addEventListener('pointercancel', up);
    },
    [values, onChange, min, visualMax, readOnly],
  );

  const gradient = `linear-gradient(90deg,
    ${colors.normal} 0%,
    ${colors.normal} ${pct(values.caution)}%,
    ${colors.caution} ${pct(values.caution)}%,
    ${colors.caution} ${pct(values.warning)}%,
    ${colors.warning} ${pct(values.warning)}%,
    ${colors.warning} ${pct(values.critical)}%,
    ${colors.critical} ${pct(values.critical)}%,
    ${colors.critical} 100%)`;

  return (
    <div className={`threshold-strip${readOnly ? ' read-only' : ''}`}>
      <div
        ref={trackRef}
        className="threshold-strip-track"
        style={{ background: gradient }}
      >
        {[20, 40, 60, 80, 100].map((tick) => (
          <span
            key={tick}
            className="threshold-strip-tick"
            style={{ left: `${pct(tick)}%` }}
            aria-hidden
          >
            {tick}&deg;
          </span>
        ))}
        {(['caution', 'warning', 'critical'] as const).map((k) => (
          <div
            key={k}
            className="threshold-strip-handle"
            style={{ left: `${pct(values[k])}%`, ['--handle-color' as string]: colors[k] } as React.CSSProperties}
            onPointerDown={handleDrag(k)}
            role="slider"
            aria-label={`${k} threshold`}
            aria-valuemin={min}
            aria-valuemax={visualMax}
            aria-valuenow={values[k]}
            aria-disabled={readOnly}
          >
            <span className="threshold-strip-grip" />
            <span className="threshold-strip-label">{values[k]}&deg;</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ThresholdStrip;

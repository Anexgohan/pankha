import React, { useMemo, useState, useRef, useId } from 'react';
import { useDashboardSettings } from '../../contexts/DashboardSettingsContext';
import type { HistoryDataPoint } from '../../types/api';

interface SensorSparklineProps {
  data: HistoryDataPoint[];
  width?: number;
  height?: number;
}

/**
 * High-performance bespoke SVG Sparkline component.
 * Uses Dynamic Local Scaling (Option C) and interactive Tooltips.
 */
const SensorSparkline: React.FC<SensorSparklineProps> = ({
  data,
  width = 300,
  height = 24,
}) => {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const containerRef = useRef<SVGSVGElement>(null);
  const { timezone } = useDashboardSettings();

  // Generate a unique ID for the gradient (SSR-safe via React 18+ useId)
  const gradientId = useId();

  // 1. Dynamic Local Scaling Math (Option C)
  const { points } = useMemo(() => {
    if (!data || data.length === 0) return { points: [] };

    const temperatures = data.map(d => 
      typeof d.temperature === 'string' ? parseFloat(d.temperature) : (d.temperature || 0)
    );

    const minVal = Math.min(...temperatures);
    const maxVal = Math.max(...temperatures);
    
    // Add 10% vertical padding so the line doesn't hit the edges
    const range = maxVal - minVal;
    const padding = range === 0 ? 10 : range * 0.1;
    const yMin = minVal - padding;
    const yMax = maxVal + padding;

    const projectedPoints = temperatures.map((temp, i) => ({
      x: (i / (data.length - 1)) * width,
      y: height - ((temp - yMin) / (yMax - yMin)) * height,
      value: temp,
      timestamp: data[i].timestamp
    }));

    return { min: minVal, max: maxVal, points: projectedPoints };
  }, [data, width, height]);

  // 2. SVG Path Generation with Catmull-Rom Spline
  const pathData = useMemo(() => {
    if (points.length < 2) return '';

    // Add padding points for Catmull-Rom boundary conditions
    const p = [
      points[0], // Duplicate first point for start boundary
      ...points,
      points[points.length - 1] // Duplicate last point for end boundary
    ];

    let d = `M ${p[1].x} ${p[1].y}`;

    // Catmull-Rom to Cubic Bezier conversion
    const k = 0.5;
    for (let i = 1; i < p.length - 2; i++) {
        const p0 = p[i - 1];
        const p1 = p[i];
        const p2 = p[i + 1];
        const p3 = p[i + 2];

        const cp1x = p1.x + (p2.x - p0.x) / 6 * k;
        const cp1y = p1.y + (p2.y - p0.y) / 6 * k;

        const cp2x = p2.x - (p3.x - p1.x) / 6 * k;
        const cp2y = p2.y - (p3.y - p1.y) / 6 * k;

        d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
    }

    return d;
  }, [points]);

  const fillPath = useMemo(() => {
    if (!pathData) return '';
    return `${pathData} L ${width} ${height} L 0 ${height} Z`;
  }, [pathData, width, height]);

  // Interaction handlers
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!containerRef.current || points.length === 0) return;
    
    const rect = containerRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * width;
    
    // Find closest point by X coordinate
    const index = Math.round((x / width) * (points.length - 1));
    const clampedIndex = Math.max(0, Math.min(points.length - 1, index));
    setHoverIndex(clampedIndex);
  };

  const handleMouseLeave = () => setHoverIndex(null);

  if (!data || data.length < 2) {
    return (
      <svg width="100%" height={height} className="sparkline-placeholder-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        <path className="sparkline-placeholder-path" d={`M0,${height/2} L${width},${height/2}`} fill="none" strokeWidth="1.5" />
      </svg>
    );
  }

  const activePoint = hoverIndex !== null ? points[hoverIndex] : null;

  return (
    <div className="sparkline-container" style={{ position: 'relative' }}>
      <svg 
        ref={containerRef}
        width="100%" 
        height={height} 
        viewBox={`0 0 ${width} ${height}`} 
        preserveAspectRatio="none"
        className="sensor-sparkline-svg"
        style={{ display: 'block', overflow: 'visible' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.2" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        
        {/* Area Fill */}
        <path 
          d={fillPath} 
          fill={`url(#${gradientId})`} 
          className="sparkline-fill"
          style={{ pointerEvents: 'none' }}
        />
        
        {/* Trend Line */}
        <path 
          d={pathData} 
          fill="none" 
          stroke="currentColor" 
          strokeWidth="1.5" 
          strokeLinecap="round" 
          strokeLinejoin="round"
          className="sparkline-path"
          style={{ pointerEvents: 'none' }}
        />

        {/* Interaction Layer */}
        {activePoint && (
          <g className="sparkline-interaction">
            <line 
              x1={activePoint.x} y1={0} x2={activePoint.x} y2={height} 
              stroke="currentColor" strokeWidth="1" strokeDasharray="2,2" opacity="0.5"
            />
            <circle 
              cx={activePoint.x} cy={activePoint.y} r="3" 
              fill="currentColor" stroke="var(--bg-secondary)" strokeWidth="1"
            />
          </g>
        )}
      </svg>

      {activePoint && (
        <div 
          className="sparkline-tooltip"
          style={{
            position: 'absolute',
            left: `${(activePoint.x / width) * 100}%`,
            top: '-32px',
            transform: 'translateX(-50%)',
            pointerEvents: 'none',
            zIndex: 10
          }}
        >
          <span className="tooltip-value">{activePoint.value.toFixed(1)}°C</span>
          <span className="tooltip-time">
            {new Date(activePoint.timestamp).toLocaleTimeString([], { 
              hour: '2-digit', 
              minute: '2-digit',
              timeZone: timezone 
            })}
          </span>
        </div>
      )}
    </div>
  );
};

export default React.memo(SensorSparkline);

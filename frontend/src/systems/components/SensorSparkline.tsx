import React, { useMemo, useState, useRef, useId } from 'react';
import { useDashboardSettings } from '../../contexts/DashboardSettingsContext';
import type { HistoryDataPoint, GapInfo } from '../../types/api';

interface SensorSparklineProps {
  data: HistoryDataPoint[];
  width?: number;
  height?: number;
}

/** Format gap duration as human-readable string */
function formatGapDuration(ms: number): string {
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

/** Projected point with screen coordinates */
interface ProjectedPoint {
  x: number;
  y: number;
  value: number;
  timestamp: string;
  gapBefore?: GapInfo;
}

/** Gap polygon geometry for rendering (trapezoid shape) */
interface GapPolygon {
  // Four points defining the trapezoid
  topLeftX: number;      // Disconnect X
  topLeftY: number;      // Disconnect Y value
  topRightX: number;     // Reconnect X
  topRightY: number;     // Reconnect Y value
  bottomY: number;       // Graph baseline (height)
  gap: GapInfo;
}

/**
 * High-performance bespoke SVG Sparkline component.
 * 
 * Features:
 * - Time-based X positioning (gap width = actual duration)
 * - Dynamic Local Scaling for Y axis
 * - Gap visualization with hatched pattern
 * - Interactive Tooltips
 */
const SensorSparkline: React.FC<SensorSparklineProps> = ({
  data,
  width = 300,
  height = 24,
}) => {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [hoverGap, setHoverGap] = useState<GapPolygon | null>(null);
  const containerRef = useRef<SVGSVGElement>(null);
  const { timezone } = useDashboardSettings();

  // Generate unique IDs for gradient (SSR-safe via React 18+ useId)
  const gradientId = useId();

  // 1. Time-based X positioning with Dynamic Local Y Scaling
  const { points, gapRects } = useMemo(() => {
    if (!data || data.length === 0) {
      return { points: [], gapRects: [], timeSpan: { minTime: 0, maxTime: 0, totalMs: 0 } };
    }

    // Parse temperatures
    const temperatures = data.map(d =>
      typeof d.temperature === 'string' ? parseFloat(d.temperature) : (d.temperature || 0)
    );

    // Y scaling (local min/max with padding)
    const minVal = Math.min(...temperatures);
    const maxVal = Math.max(...temperatures);
    const range = maxVal - minVal;
    const padding = range === 0 ? 10 : range * 0.1;
    const yMin = minVal - padding;
    const yMax = maxVal + padding;
    const yRange = yMax - yMin;

    // Time scaling
    const minTime = new Date(data[0].timestamp).getTime();
    const maxTime = new Date(data[data.length - 1].timestamp).getTime();
    const totalMs = maxTime - minTime || 1; // Avoid division by zero

    // Project points to screen coordinates (time-based X)
    const projectedPoints: ProjectedPoint[] = data.map((d, i) => {
      const t = new Date(d.timestamp).getTime();
      return {
        x: ((t - minTime) / totalMs) * width,
        y: height - ((temperatures[i] - yMin) / yRange) * height,
        value: temperatures[i],
        timestamp: d.timestamp,
        gapBefore: d.gapBefore,
      };
    });

    // Calculate gap polygons (trapezoid shapes)
    const gaps: GapPolygon[] = [];
    for (let i = 0; i < projectedPoints.length; i++) {
      const point = projectedPoints[i];
      if (point.gapBefore) {
        const prevPoint = projectedPoints[i - 1];
        if (prevPoint) {
          gaps.push({
            topLeftX: prevPoint.x,
            topLeftY: prevPoint.y,      // Disconnect Y
            topRightX: point.x,
            topRightY: point.y,          // Reconnect Y
            bottomY: height,              // Graph baseline
            gap: point.gapBefore,
          });
        }
      }
    }

    return {
      points: projectedPoints,
      gapRects: gaps,
      timeSpan: { minTime, maxTime, totalMs },
    };
  }, [data, width, height]);

  // 2. SVG Path Generation with Catmull-Rom Spline (with gap breaks)
  const pathData = useMemo(() => {
    if (points.length < 2) return '';

    let d = '';
    let segmentStart = true;

    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      
      // If this point follows a gap, start a new segment
      if (point.gapBefore) {
        segmentStart = true;
      }

      if (segmentStart) {
        d += ` M ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
        segmentStart = false;
      } else {
        // Simple linear path for now (Catmull-Rom with gaps is complex)
        d += ` L ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
      }
    }

    return d.trim();
  }, [points]);

  // 3. Fill path for gradient area
  const fillPath = useMemo(() => {
    if (!pathData || points.length < 2) return '';
    
    // Create closed path for fill by connecting to bottom
    // Handle multiple segments by creating separate closed paths
    const segments: string[] = [];
    let currentSegment: ProjectedPoint[] = [];

    for (const point of points) {
      if (point.gapBefore && currentSegment.length > 0) {
        // Close current segment and start new one
        segments.push(currentSegment.map((p, i) => 
          `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`
        ).join(' ') + 
          ` L ${currentSegment[currentSegment.length - 1].x.toFixed(2)} ${height} L ${currentSegment[0].x.toFixed(2)} ${height} Z`
        );
        currentSegment = [];
      }
      currentSegment.push(point);
    }

    // Close final segment
    if (currentSegment.length > 0) {
      segments.push(currentSegment.map((p, i) => 
        `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`
      ).join(' ') + 
        ` L ${currentSegment[currentSegment.length - 1].x.toFixed(2)} ${height} L ${currentSegment[0].x.toFixed(2)} ${height} Z`
      );
    }

    return segments.join(' ');
  }, [pathData, points, height]);

  // Interaction handlers
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!containerRef.current || points.length === 0) return;

    const rect = containerRef.current.getBoundingClientRect();
    const mouseX = ((e.clientX - rect.left) / rect.width) * width;

    // Check if hovering over a gap first
    for (const gap of gapRects) {
      if (mouseX >= gap.topLeftX && mouseX <= gap.topRightX) {
        setHoverGap(gap);
        setHoverIndex(null);
        return;
      }
    }

    // Find closest point by X coordinate (binary search would be faster but O(n) is fine for <10k points)
    let closestIndex = 0;
    let closestDist = Math.abs(points[0].x - mouseX);
    
    for (let i = 1; i < points.length; i++) {
      const dist = Math.abs(points[i].x - mouseX);
      if (dist < closestDist) {
        closestDist = dist;
        closestIndex = i;
      }
    }

    setHoverIndex(closestIndex);
    setHoverGap(null);
  };

  const handleMouseLeave = () => {
    setHoverIndex(null);
    setHoverGap(null);
  };

  if (!data || data.length < 2) {
    return (
      <svg width="100%" height="100%" className="sparkline-placeholder-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
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
        height="100%"
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
          {/* Gap fade masks - one per gap with vertical gradient */}
          {gapRects.map((gap, idx) => {
            const maskId = `gap-fade-mask-${gradientId}-${idx}`;
            const fadeGradientId = `gap-fade-gradient-${gradientId}-${idx}`;
            // Calculate the top Y for this gap (min of the two boundary points)
            const topY = Math.min(gap.topLeftY, gap.topRightY);
            return (
              <React.Fragment key={`gap-defs-${idx}`}>
                <linearGradient
                  id={fadeGradientId}
                  x1="0" y1="0" x2="0" y2="1"
                  gradientUnits="objectBoundingBox"
                >
                  <stop offset="0%" stopColor="white" stopOpacity="1" />
                  <stop offset="100%" stopColor="white" stopOpacity="0" />
                </linearGradient>
                <mask id={maskId}>
                  <rect
                    x={gap.topLeftX}
                    y={topY}
                    width={gap.topRightX - gap.topLeftX}
                    height={gap.bottomY - topY}
                    fill={`url(#${fadeGradientId})`}
                  />
                </mask>
              </React.Fragment>
            );
          })}
        </defs>

        {/* Gap Polygons (trapezoid) - rendered BEHIND the path */}
        {gapRects.map((gap, idx) => {
          // Build trapezoid: top-left → top-right → bottom-right → bottom-left
          const points = [
            `${gap.topLeftX.toFixed(2)},${gap.topLeftY.toFixed(2)}`,
            `${gap.topRightX.toFixed(2)},${gap.topRightY.toFixed(2)}`,
            `${gap.topRightX.toFixed(2)},${gap.bottomY.toFixed(2)}`,
            `${gap.topLeftX.toFixed(2)},${gap.bottomY.toFixed(2)}`
          ].join(' ');
          const maskId = `gap-fade-mask-${gradientId}-${idx}`;
          
          return (
            <polygon
              key={`gap-${idx}`}
              points={points}
              fill="url(#gap-hatch-pattern)"
              mask={`url(#${maskId})`}
              style={{ pointerEvents: 'none' }}
            >
              <title>No Data: {formatGapDuration(gap.gap.durationMs)}</title>
            </polygon>
          );
        })}

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

        {/* Interaction Layer - Point hover */}
        {activePoint && !hoverGap && (
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

        {/* Interaction Layer - Gap hover highlight */}
        {hoverGap && (() => {
          // Find the index of the hovered gap to use the same mask
          const gapIndex = gapRects.findIndex(g => 
            g.topLeftX === hoverGap.topLeftX && g.topRightX === hoverGap.topRightX
          );
          const maskId = gapIndex >= 0 ? `gap-fade-mask-${gradientId}-${gapIndex}` : undefined;
          
          const highlightPoints = [
            `${hoverGap.topLeftX.toFixed(2)},${hoverGap.topLeftY.toFixed(2)}`,
            `${hoverGap.topRightX.toFixed(2)},${hoverGap.topRightY.toFixed(2)}`,
            `${hoverGap.topRightX.toFixed(2)},${hoverGap.bottomY.toFixed(2)}`,
            `${hoverGap.topLeftX.toFixed(2)},${hoverGap.bottomY.toFixed(2)}`
          ].join(' ');
          return (
            <polygon
              points={highlightPoints}
              fill="var(--text-tertiary)"
              opacity="0.2"
              mask={maskId ? `url(#${maskId})` : undefined}
            />
          );
        })()}
      </svg>

      {/* Point Tooltip */}
      {activePoint && !hoverGap && (
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

      {/* Gap Tooltip */}
      {hoverGap && (
        <div
          className="sparkline-tooltip sparkline-gap-tooltip"
          style={{
            position: 'absolute',
            left: `${((hoverGap.topLeftX + hoverGap.topRightX) / 2 / width) * 100}%`,
            top: '-32px',
            transform: 'translateX(-50%)',
            pointerEvents: 'none',
            zIndex: 10
          }}
        >
          <span className="tooltip-value" style={{ color: 'var(--text-secondary)' }}>No Data</span>
          <span className="tooltip-time">{formatGapDuration(hoverGap.gap.durationMs)}</span>
        </div>
      )}
    </div>
  );
};

export default React.memo(SensorSparkline);

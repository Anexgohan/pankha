import React, { useState, useRef, useCallback } from 'react';
import type { FanCurvePoint } from '../../services/fanProfilesApi';

interface FanCurveChartProps {
  curvePoints: FanCurvePoint[];
  width?: number;
  height?: number;
  showLabels?: boolean;
  interactive?: boolean;
  onPointChange?: (pointIndex: number, temperature: number, fanSpeed: number) => void;
  onPointRemove?: (pointIndex: number) => void;
  onPointAdd?: (temperature: number, fanSpeed: number) => void;
  onDragEnd?: () => void;
  assignmentsCount?: number;
  tooltipOnly?: boolean;
}

interface DragState {
  isDragging: boolean;
  pointIndex: number;
  startX: number;
  startY: number;
  dragStartOrder: number[]; // Store original indices during drag
}

const FanCurveChart: React.FC<FanCurveChartProps> = ({
  curvePoints,
  width = 400,
  height = 200,
  showLabels = true,
  interactive = false,
  onPointChange,
  onPointRemove,
  onPointAdd,
  onDragEnd,
  assignmentsCount = 0,
  tooltipOnly = false
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragState, setDragState] = useState<DragState>({
    isDragging: false,
    pointIndex: -1,
    startX: 0,
    startY: 0,
    dragStartOrder: []
  });
  const [hoveredPoint, setHoveredPoint] = useState<number>(-1);
  const [hoveredData, setHoveredData] = useState<{ temp: number; speed: number; x: number; y: number } | null>(null);

  const margin = { top: 20, right: 40, bottom: 40, left: 50 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;

  // Sort points by temperature for proper curve rendering
  // Add index tracking to maintain identity after sorting
  // During drag, use the order from when drag started to prevent visual jumping
  const pointsWithIndex = curvePoints.map((point, originalIndex) => ({ ...point, originalIndex }));

  let sortedPoints;
  if (dragState.isDragging && dragState.dragStartOrder.length > 0) {
    // Maintain the visual order from when drag started
    sortedPoints = dragState.dragStartOrder.map(idx => pointsWithIndex[idx]);
  } else {
    // Normal sorting when not dragging
    sortedPoints = pointsWithIndex.sort((a, b) => a.temperature - b.temperature);
  }

  // Use fixed temperature range 0-100°C and fan speed 0-100%
  const minTemp = 0;
  const maxTemp = 100;
  const tempSpan = maxTemp - minTemp;

  const minSpeed = 0;
  const maxSpeed = 100;
  const speedRange = maxSpeed - minSpeed;

  // Scale functions
  const scaleX = (temp: number) => ((temp - minTemp) / tempSpan) * chartWidth;
  const scaleY = (speed: number) => chartHeight - ((speed - minSpeed) / speedRange) * chartHeight;

  // Inverse scale functions (for converting mouse coordinates back to values)
  const inverseScaleX = (x: number) => (x / chartWidth) * tempSpan + minTemp;
  const inverseScaleY = (y: number) => maxSpeed - (y / chartHeight) * speedRange;

  // Drag event handlers
  const handleMouseDown = useCallback((event: React.MouseEvent, pointIndex: number) => {
    if (!interactive || !onPointChange) return;

    event.preventDefault();
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;

    // Capture the current sorted order to maintain it during drag
    const currentPointsWithIndex = curvePoints.map((point, originalIndex) => ({ ...point, originalIndex }));
    const currentOrder = currentPointsWithIndex
      .sort((a, b) => a.temperature - b.temperature)
      .map(p => p.originalIndex);

    setDragState({
      isDragging: true,
      pointIndex,
      startX: event.clientX - rect.left,
      startY: event.clientY - rect.top,
      dragStartOrder: currentOrder
    });
  }, [interactive, onPointChange, curvePoints]);

  const handleMouseMove = useCallback((event: React.MouseEvent) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;

    const mouseX = event.clientX - rect.left - margin.left;
    const mouseY = event.clientY - rect.top - margin.top;

    // Handle dragging
    if (dragState.isDragging && interactive && onPointChange) {
      // Constrain to chart bounds
      const clampedX = Math.max(0, Math.min(chartWidth, mouseX));
      const clampedY = Math.max(0, Math.min(chartHeight, mouseY));

      // Convert back to temperature and fan speed
      const newTemp = Math.round(inverseScaleX(clampedX));
      const newSpeed = Math.round(inverseScaleY(clampedY));

      // Constrain values to chart ranges (0-100°C temperature, 0-100% fan speed)
      const constrainedTemp = Math.max(0, Math.min(100, newTemp));
      const constrainedSpeed = Math.max(minSpeed, Math.min(maxSpeed, newSpeed));

      onPointChange(dragState.pointIndex, constrainedTemp, constrainedSpeed);
      return;
    }

    // Handle snapping tooltip (hover)
    if (interactive || tooltipOnly) {
      const isWithinBounds = mouseX >= 0 && mouseX <= chartWidth && 
                            mouseY >= 0 && mouseY <= chartHeight;

      if (!isWithinBounds) {
        setHoveredPoint(-1);
        setHoveredData(null);
        return;
      }

      // 1. Find nearest point for highlight/actions
      let minDistance = Infinity;
      let nearestIndex = -1;

      curvePoints.forEach((point, index) => {
        const pointX = scaleX(point.temperature);
        const distance = Math.abs(pointX - mouseX);
        if (distance < minDistance) {
          minDistance = distance;
          nearestIndex = index;
        }
      });

      // Show point highlight if mouse is very close to a point (within 5px)
      if (nearestIndex !== -1 && minDistance < 5) {
        setHoveredPoint(nearestIndex);
        const point = curvePoints[nearestIndex];
        setHoveredData({
          temp: point.temperature,
          speed: point.fan_speed,
          x: scaleX(point.temperature),
          y: scaleY(point.fan_speed)
        });
        return; // Skip interpolation if snapped to point
      } else {
        setHoveredPoint(-1);
      }

      // 2. Calculate interpolated value for the "line snap"
      const currentTemp = inverseScaleX(mouseX);
      let interpolatedSpeed = 0;

      if (sortedPoints.length > 0) {
        if (currentTemp <= sortedPoints[0].temperature) {
          interpolatedSpeed = sortedPoints[0].fan_speed;
        } else if (currentTemp >= sortedPoints[sortedPoints.length - 1].temperature) {
          interpolatedSpeed = sortedPoints[sortedPoints.length - 1].fan_speed;
        } else {
          // Find the two points to interpolate between
          for (let i = 0; i < sortedPoints.length - 1; i++) {
            const p1 = sortedPoints[i];
            const p2 = sortedPoints[i + 1];
            if (currentTemp >= p1.temperature && currentTemp <= p2.temperature) {
              const t = (currentTemp - p1.temperature) / (p2.temperature - p1.temperature);
              interpolatedSpeed = p1.fan_speed + t * (p2.fan_speed - p1.fan_speed);
              break;
            }
          }
        }
      }

      setHoveredData({
        temp: Math.round(currentTemp),
        speed: Math.round(interpolatedSpeed),
        x: mouseX,
        y: scaleY(interpolatedSpeed)
      });
    }
  }, [dragState, interactive, tooltipOnly, onPointChange, curvePoints, sortedPoints, margin.left, margin.top, chartWidth, chartHeight, scaleX, scaleY, inverseScaleX, inverseScaleY, minSpeed, maxSpeed]);

  const handleMouseUp = useCallback(() => {
    setDragState({
      isDragging: false,
      pointIndex: -1,
      startX: 0,
      startY: 0,
      dragStartOrder: []
    });

    // Notify parent that drag ended so it can re-sort
    if (onDragEnd) {
      onDragEnd();
    }
  }, [onDragEnd]);

  const handleMouseLeave = useCallback(() => {
    if (dragState.isDragging) {
      handleMouseUp();
    }
    setHoveredPoint(-1);
    setHoveredData(null);
  }, [dragState.isDragging, handleMouseUp]);

  // Handle right-click to remove points
  const handleRightClick = useCallback((event: React.MouseEvent, pointIndex: number) => {
    if (!interactive || !onPointRemove || curvePoints.length <= 2) return;
    
    event.preventDefault();
    onPointRemove(pointIndex);
  }, [interactive, onPointRemove, curvePoints.length]);

  // Handle double-click on curve line to add points
  const handleCurveDoubleClick = useCallback((event: React.MouseEvent) => {
    if (!interactive || !onPointAdd) return;
    
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;

    const mouseX = event.clientX - rect.left - margin.left;
    const mouseY = event.clientY - rect.top - margin.top;

    // Constrain to chart bounds
    const clampedX = Math.max(0, Math.min(chartWidth, mouseX));
    const clampedY = Math.max(0, Math.min(chartHeight, mouseY));

    // Convert mouse coordinates to temperature and fan speed
    const temperature = Math.round(inverseScaleX(clampedX));
    const fanSpeed = Math.round(inverseScaleY(clampedY));

    // Constrain values to valid ranges
    const constrainedTemp = Math.max(0, Math.min(100, temperature));
    const constrainedSpeed = Math.max(0, Math.min(100, fanSpeed));

    onPointAdd(constrainedTemp, constrainedSpeed);
  }, [interactive, onPointAdd, margin.left, margin.top, chartWidth, chartHeight, inverseScaleX, inverseScaleY]);

  // Generate curve path
  const generatePath = () => {
    if (sortedPoints.length === 0) return '';
    
    let path = `M ${scaleX(sortedPoints[0].temperature)} ${scaleY(sortedPoints[0].fan_speed)}`;
    
    for (let i = 1; i < sortedPoints.length; i++) {
      path += ` L ${scaleX(sortedPoints[i].temperature)} ${scaleY(sortedPoints[i].fan_speed)}`;
    }
    
    return path;
  };

  // Generate grid lines with better intervals
  const generateGridLines = () => {
    const lines = [];
    
    // Vertical grid lines (temperature) - every 10°C from 0°C to 100°C
    for (let temp = 0; temp <= 100; temp += 10) {
      const x = scaleX(temp);
      const isMainLine = temp % 20 === 0;
      lines.push(
        <line
          key={`v-${temp}`}
          x1={x}
          y1={0}
          x2={x}
          y2={chartHeight}
          stroke={isMainLine ? "#d0d0d0" : "#e8e8e8"}
          strokeWidth={isMainLine ? "1.5" : "1"}
          opacity={isMainLine ? "0.8" : "0.5"}
        />
      );
    }
    
    // Horizontal grid lines (fan speed) - every 10% with emphasis on 25%, 50%, 75%
    for (let speed = 0; speed <= 100; speed += 10) {
      const y = scaleY(speed);
      const isMainLine = speed % 25 === 0;
      lines.push(
        <line
          key={`h-${speed}`}
          x1={0}
          y1={y}
          x2={chartWidth}
          y2={y}
          stroke={isMainLine ? "#d0d0d0" : "#e8e8e8"}
          strokeWidth={isMainLine ? "1.5" : "1"}
          opacity={isMainLine ? "0.8" : "0.5"}
        />
      );
    }
    
    return lines;
  };

  // Generate axis labels with better spacing
  const generateAxisLabels = () => {
    if (!showLabels) return null;
    
    const labels = [];
    
    // X-axis labels (temperature) - every 20°C from 0°C to 100°C
    for (let temp = 0; temp <= 100; temp += 20) {
      const x = scaleX(temp);
      labels.push(
        <text
          key={`x-label-${temp}`}
          x={x}
          y={chartHeight + 15}
          textAnchor="middle"
          fontSize="11"
          fill="#666"
          fontWeight="500"
        >
          {temp}°
        </text>
      );
    }
    
    // Y-axis labels (fan speed) - every 25% for cleaner look
    for (let speed = 0; speed <= 100; speed += 25) {
      const y = scaleY(speed);
      labels.push(
        <text
          key={`y-label-${speed}`}
          x={-8}
          y={y + 4}
          textAnchor="end"
          fontSize="11"
          fill="#666"
          fontWeight="500"
        >
          {speed}%
        </text>
      );
    }
    
    return labels;
  };

  return (
    <div className="fan-curve-chart">
      <svg 
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        width="100%" 
        height="auto"
        preserveAspectRatio="xMidYMid meet"
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        style={{ 
          cursor: dragState.isDragging ? 'grabbing' : 'default',
          overflow: 'visible',
          display: 'block'
        }}
      >
        <g transform={`translate(${margin.left},${margin.top})`}>
          {/* Grid lines */}
          {generateGridLines()}
          
                {/* Curve line */}
                <path
                  d={generatePath()}
                  fill="none"
                  stroke="#2196F3"
                  strokeWidth="2"
                  strokeLinejoin="round"
                  style={{ cursor: interactive ? 'crosshair' : 'default' }}
                  onDoubleClick={handleCurveDoubleClick}
                />

                {/* Vertical Ruler & Interpolation Point */}
                {(interactive || tooltipOnly) && hoveredData && (
                  <g pointerEvents="none">
                    <line
                      x1={hoveredData.x}
                      y1={0}
                      x2={hoveredData.x}
                      y2={chartHeight}
                      stroke="rgba(33, 150, 243, 0.4)"
                      strokeWidth="1"
                      strokeDasharray="4,4"
                    />
                    <circle
                      cx={hoveredData.x}
                      cy={hoveredData.y}
                      r={5}
                      fill="#2196F3"
                      stroke="white"
                      strokeWidth="2"
                      style={{ filter: 'drop-shadow(0 0 4px rgba(33, 150, 243, 0.6))' }}
                    />
                  </g>
                )}
          
          {/* Curve points */}
          {sortedPoints.map((point, index) => {
            const originalIndex = point.originalIndex;
            const isHovered = hoveredPoint === originalIndex;
            const isDragging = dragState.isDragging && dragState.pointIndex === originalIndex;
            
            return (
              <g key={point.id || index}>
                {/* Hit area for easier hovering - invisible but large */}
                {(interactive || tooltipOnly) && (
                  <circle
                    cx={scaleX(point.temperature)}
                    cy={scaleY(point.fan_speed)}
                    r={20}
                    fill="transparent"
                    style={{ cursor: interactive ? (isDragging ? 'grabbing' : 'grab') : 'pointer' }}
                    onMouseDown={(e) => handleMouseDown(e, originalIndex)}
                    onContextMenu={(e) => handleRightClick(e, originalIndex)}
                  />
                )}
                
                {/* Visual point circle - smaller and cleaner */}
                <circle
                  cx={scaleX(point.temperature)}
                  cy={scaleY(point.fan_speed)}
                  r={interactive || tooltipOnly ? (isHovered || isDragging ? 10 : 7) : 6}
                  fill={isDragging ? "#1976D2" : isHovered ? "#42A5F5" : "#2196F3"}
                  stroke="white"
                  strokeWidth={interactive || tooltipOnly ? "3" : "2"}
                  className={(interactive || tooltipOnly) ? "curve-point interactive" : "curve-point"}
                  style={{ 
                    pointerEvents: 'none',
                    filter: isDragging ? 'drop-shadow(0 4px 12px rgba(0,0,0,0.4))' : 'drop-shadow(0 2px 4px rgba(0,0,0,0.2))',
                    transition: isDragging ? 'none' : 'all 0.2s ease'
                  }}
                />
              </g>
            );
          })}
          
          {/* Axis labels */}
          {generateAxisLabels()}
          
          {/* Axis lines */}
          <line x1={0} y1={chartHeight} x2={chartWidth} y2={chartHeight} stroke="#333" strokeWidth="1" />
          <line x1={0} y1={0} x2={0} y2={chartHeight} stroke="#333" strokeWidth="1" />
        </g>
        
        {/* Axis titles */}
        {showLabels && (
          <>
            <text
              x={width / 2}
              y={height - 5}
              textAnchor="middle"
              fontSize="12"
              fill="#333"
              fontWeight="500"
            >
              Temperature (°C)
            </text>
            <text
              x={15}
              y={height / 2}
              textAnchor="middle"
              fontSize="12"
              fill="#333"
              fontWeight="500"
              transform={`rotate(-90, 15, ${height / 2})`}
            >
              Fan Speed (%)
            </text>
          </>
        )}
      </svg>
      
      {/* Active Tooltip (Interpolated or Point-Specific) */}
      {(interactive || tooltipOnly) && hoveredData && (() => {
        const hasRemoveHint = interactive && hoveredPoint !== -1 && curvePoints.length > 2;
        
        // Tooltip position relative to .fan-curve-chart container
        const tooltipTop = margin.top + hoveredData.y - 12;
        const tooltipLeft = margin.left + hoveredData.x;
        
        return (
          <div 
            className="chart-tooltip"
            style={{
              position: 'absolute',
              top: `${tooltipTop}px`,
              left: `${tooltipLeft}px`,
              transform: 'translate(-50%, -100%)',
              pointerEvents: 'none',
              zIndex: 100,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '2px',
              padding: '6px 10px',
              backgroundColor: 'rgba(0, 0, 0, 0.9)',
              border: '1px solid rgba(255, 255, 255, 0.3)',
              borderRadius: '6px',
              color: 'white',
              boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
              whiteSpace: 'nowrap'
            }}
          >
            <div style={{ fontSize: '12px', fontWeight: '600' }}>
              {hoveredData.temp}°C, {hoveredData.speed}%
            </div>
            {hasRemoveHint && (
              <div style={{ fontSize: '9px', color: 'rgba(255, 255, 255, 0.7)' }}>
                Right-click to remove
              </div>
            )}
          </div>
        );
      })()}
      
      <div className="curve-info-strip-tactical">
        <div className="range-box">
          <div className="range-item">
            <span className="range-label">TEMP:</span>
            <span className="range-value">{minTemp}-{maxTemp}°C</span>
          </div>
          <div className="range-item">
            <span className="range-label">SPEED:</span>
            <span className="range-value">{minSpeed}-{maxSpeed}%</span>
          </div>
          <div className="range-item">
            <span className="range-label">POINTS:</span>
            <span className="range-value">{sortedPoints.length}</span>
          </div>
          <div className="range-item">
            <span className="range-label">LINKS:</span>
            <span className="range-value">{assignmentsCount}</span>
          </div>
          <div className="range-item">
            <span className="range-label">ACTIVE:</span>
            <span className="range-value">
              {sortedPoints.length > 0 
                ? `${Math.min(...sortedPoints.map(p => p.temperature))}°-${Math.max(...sortedPoints.map(p => p.temperature))}°`
                : 'N/A'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FanCurveChart;
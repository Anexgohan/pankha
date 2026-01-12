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
  onDragEnd
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
    if (!dragState.isDragging || !interactive || !onPointChange) return;

    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;

    const mouseX = event.clientX - rect.left - margin.left;
    const mouseY = event.clientY - rect.top - margin.top;

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
  }, [dragState, interactive, onPointChange, margin.left, margin.top, chartWidth, chartHeight, inverseScaleX, inverseScaleY, minSpeed, maxSpeed]);

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
        width={width} 
        height={height}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        style={{ cursor: dragState.isDragging ? 'grabbing' : 'default' }}
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
          
          {/* Curve points */}
          {sortedPoints.map((point, index) => {
            const originalIndex = point.originalIndex;
            const isHovered = hoveredPoint === originalIndex;
            const isDragging = dragState.isDragging && dragState.pointIndex === originalIndex;
            
            return (
              <g key={point.id || index}>
                {/* Point highlight circle (appears on hover) */}
                {interactive && isHovered && (
                  <circle
                    cx={scaleX(point.temperature)}
                    cy={scaleY(point.fan_speed)}
                    r={16}
                    fill="rgba(33, 150, 243, 0.15)"
                    stroke="rgba(33, 150, 243, 0.3)"
                    strokeWidth="2"
                  />
                )}
                
                {/* Main point circle */}
                <circle
                  cx={scaleX(point.temperature)}
                  cy={scaleY(point.fan_speed)}
                  r={interactive ? (isHovered || isDragging ? 12 : 8) : 6}
                  fill={isDragging ? "#1976D2" : isHovered ? "#42A5F5" : "#2196F3"}
                  stroke="white"
                  strokeWidth={interactive ? "3" : "2"}
                  className={interactive ? "curve-point interactive" : "curve-point"}
                  style={{ 
                    cursor: interactive ? (isDragging ? 'grabbing' : 'grab') : 'default',
                    filter: isDragging ? 'drop-shadow(0 4px 12px rgba(0,0,0,0.4))' : 'drop-shadow(0 2px 4px rgba(0,0,0,0.2))',
                    transition: isDragging ? 'none' : 'all 0.2s ease'
                  }}
                  onMouseDown={(e) => handleMouseDown(e, originalIndex)}
                  onContextMenu={(e) => handleRightClick(e, originalIndex)}
                  onMouseEnter={() => setHoveredPoint(originalIndex)}
                  onMouseLeave={() => setHoveredPoint(-1)}
                />
                
                {/* Point value tooltip (appears on hover in interactive mode) */}
                {interactive && isHovered && (() => {
                  const pointX = scaleX(point.temperature);
                  const pointY = scaleY(point.fan_speed);
                  
                  // Smart tooltip positioning to avoid overflow
                  const hasRemoveHint = curvePoints.length > 2;
                  const tooltipWidth = 90;
                  const tooltipHeight = hasRemoveHint ? 40 : 28;
                  
                  // Position tooltip above point, but if too close to top, position below
                  const tooltipY = pointY > tooltipHeight + 10 
                    ? pointY - tooltipHeight - 5  // Above point
                    : pointY + 20;                // Below point
                  
                  // Keep tooltip within horizontal bounds
                  const tooltipX = Math.max(
                    tooltipWidth / 2,
                    Math.min(chartWidth - tooltipWidth / 2, pointX)
                  );
                  
                  return (
                    <g>
                      <rect
                        x={tooltipX - tooltipWidth / 2}
                        y={tooltipY}
                        width={tooltipWidth}
                        height={tooltipHeight}
                        fill="rgba(0, 0, 0, 0.85)"
                        rx={6}
                        stroke="rgba(255, 255, 255, 0.2)"
                        strokeWidth="1"
                      />
                      <text
                        x={tooltipX}
                        y={tooltipY + 16}
                        textAnchor="middle"
                        fontSize="12"
                        fill="white"
                        fontWeight="600"
                      >
                        {point.temperature}°C, {point.fan_speed}%
                      </text>
                      {hasRemoveHint && (
                        <text
                          x={tooltipX}
                          y={tooltipY + 32}
                          textAnchor="middle"
                          fontSize="9"
                          fill="rgba(255, 255, 255, 0.8)"
                        >
                          Right-click to remove
                        </text>
                      )}
                    </g>
                  );
                })()}
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
      
      <div className="curve-info">
        <div className="curve-range">
          <span className="range-item">
            <strong>Temperature Range:</strong> {minTemp}°C - {maxTemp}°C
          </span>
          <span className="range-item">
            <strong>Fan Speed Range:</strong> {minSpeed}% - {maxSpeed}%
          </span>
          {sortedPoints.length > 0 && (
            <>
              <span className="range-item">
                <strong>Curve Points:</strong> {sortedPoints.length}
              </span>
              <span className="range-item">
                <strong>Active Range:</strong> {Math.min(...sortedPoints.map(p => p.temperature))}°C - {Math.max(...sortedPoints.map(p => p.temperature))}°C
              </span>
            </>
          )}
        </div>
        {interactive && (
          <div className="curve-instructions">
            <p>🎯 <strong>Pro Tip:</strong> Drag points to adjust • Double-click curve to add points • Right-click points to remove • Full 0-100°C range available</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default FanCurveChart;
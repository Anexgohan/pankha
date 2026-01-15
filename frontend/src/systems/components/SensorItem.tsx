import React from "react";
import type { SensorReading, HistoryDataPoint } from "../../types/api";
import { InlineEdit } from "../../components/InlineEdit";
import { getSensorDisplayName } from "../../utils/displayNames";
import { formatTemperature } from "../../utils/formatters";
import SensorSparkline from "./SensorSparkline";
import "./SensorItem.css";

interface SensorItemProps {
  sensor: SensorReading;
  systemId: number;  // Reserved for future use (history API calls)
  isHidden: boolean;
  history?: HistoryDataPoint[];
  onToggleVisibility: (sensorId: string, sensorDbId?: number) => void;
  onLabelSave: (sensorDbId: number, newLabel: string) => Promise<void>;
  getTemperatureClass: (temp: number, maxTemp?: number, critTemp?: number) => string;
  getSensorIcon: (type: string) => string;
}

const SensorItem: React.FC<SensorItemProps> = ({
  sensor,
  systemId: _systemId,
  isHidden,
  history = [],
  onToggleVisibility,
  onLabelSave,
  getTemperatureClass,
  getSensorIcon,
}) => {
  const tempClass = getTemperatureClass(
    sensor.temperature,
    sensor.maxTemp,
    sensor.critTemp
  );

  return (
    <div className={`sensor-item-wrapper ${isHidden ? "sensor-hidden" : ""}`}>
      {/* === RACK (OUTSIDE CARD) === */}
      <div className="sensor-rack">
        <div className="rack-icon" title={sensor.type}>
          {getSensorIcon(sensor.type)}
        </div>
        <button
          className="rack-visibility"
          onClick={() => onToggleVisibility(sensor.id, sensor.dbId)}
          title={isHidden ? "Show sensor" : "Hide sensor"}
          aria-label={isHidden ? "Show sensor" : "Hide sensor"}
        >
          {isHidden ? "🚫" : "🟢"}
        </button>
      </div>

      {/* === CARD (Contains Content + Value + Sparkline) === */}
      <div className={`sensor-card temperature-${tempClass}`}>
        {/* Row 1-2: Content + Value side by side */}
        <div className="sensor-main">
          {/* CONTENT COLUMN */}
          <div className="sensor-content">
            {/* Row 1: Editable sensor name */}
            <div className="sensor-name-row">
              <InlineEdit
                value={getSensorDisplayName(sensor.id, sensor.name, sensor.label)}
                hardwareId={sensor.id}
                onSave={async (newLabel) => {
                  if (!sensor.dbId) {
                    throw new Error("Sensor not registered in database");
                  }
                  await onLabelSave(sensor.dbId, newLabel);
                }}
                className="sensor-name-edit"
                showHardwareId={false}
              />
            </div>

            {/* Row 2: Type: hardware_id */}
            <div
              className="sensor-type-row"
              title={`${sensor.type}: ${sensor.id}`}
            >
              <span className="sensor-type-label">{sensor.type}:</span>
              <span className="sensor-hardware-id">{sensor.id}</span>
            </div>
          </div>

          {/* VALUE COLUMN (Fixed 80px, centered) */}
          <div className="sensor-value-column">
            {/* Temperature */}
            <span className={`sensor-temperature temperature-${tempClass}`}>
              {formatTemperature(sensor.temperature)}
            </span>
            {/* Status badge */}
            <span className={`sensor-status-badge status-${sensor.status}`}>
              {sensor.status.toUpperCase()}
            </span>
          </div>
        </div>

        {/* Row 3: Sparkline (FULL CARD WIDTH) */}
        <div className="sensor-sparkline-area">
          <SensorSparkline data={history} />
        </div>
      </div>
    </div>
  );
};

// Memoize to prevent unnecessary re-renders in large lists
export default React.memo(SensorItem, (prevProps, nextProps) => {
  return (
    prevProps.sensor.id === nextProps.sensor.id &&
    prevProps.sensor.temperature === nextProps.sensor.temperature &&
    prevProps.sensor.status === nextProps.sensor.status &&
    prevProps.sensor.label === nextProps.sensor.label &&
    prevProps.sensor.name === nextProps.sensor.name &&
    prevProps.isHidden === nextProps.isHidden &&
    prevProps.history === nextProps.history
  );
});

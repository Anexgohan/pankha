import React from 'react';
import { 
  Monitor, 
  CheckCircle, 
  CircleOff, 
  AlertTriangle, 
  Activity, 
  Wind, 
  Thermometer, 
  ThermometerSnowflake 
} from 'lucide-react';
import type { SystemOverview } from '../../types/api';
import { formatTemperature } from '../../utils/formatters';
import { getTemperatureClass } from '../../utils/statusColors';

interface OverviewStatsProps {
  overview: SystemOverview;
}

const OverviewStats: React.FC<OverviewStatsProps> = ({ overview }) => {
  // Determine limit display and styling
  const hasLimit = overview.agentLimit !== undefined && overview.agentLimit !== 'unlimited';
  const limitValue = hasLimit ? overview.agentLimit as number : null;
  const isOverLimit = overview.overLimit === true;
  const isAtLimit = hasLimit && limitValue !== null && overview.totalSystems >= limitValue;

  // Get appropriate class for limit status
  const getLimitClass = () => {
    if (isOverLimit) return 'over-limit';
    if (isAtLimit) return 'at-limit';
    return '';
  };

  // Build tooltip text
  const getLimitTooltip = () => {
    if (!hasLimit) return `${overview.totalSystems} systems connected`;
    const tierInfo = overview.tierName ? ` on ${overview.tierName} tier` : '';
    if (isOverLimit) {
      return `${overview.totalSystems} systems connected, ${limitValue} allowed${tierInfo}. Some systems are in view-only mode.`;
    }
    return `${overview.totalSystems} of ${limitValue} systems allowed${tierInfo}`;
  };

  // Format display value
  const getSystemsDisplay = () => {
    if (!hasLimit || limitValue === null) {
      return overview.totalSystems.toString();
    }
    return `${overview.totalSystems}/${limitValue}`;
  };

  return (
    <div className="overview-stats">
      <div
        className={`stat-card ${getLimitClass()}`}
        title={getLimitTooltip()}
      >
        <div className="stat-icon"><Monitor size={20} /></div>
        <div className="stat-content">
          <div className="stat-value">{getSystemsDisplay()}</div>
          <div className="stat-label">Total Systems</div>
        </div>
      </div>

      <div className="stat-card online">
        <div className="stat-icon"><CheckCircle size={20} /></div>
        <div className="stat-content">
          <div className="stat-value">{overview.onlineSystems}</div>
          <div className="stat-label">Online</div>
        </div>
      </div>

      <div className="stat-card offline">
        <div className="stat-icon"><CircleOff size={20} /></div>
        <div className="stat-content">
          <div className="stat-value">{overview.offlineSystems}</div>
          <div className="stat-label">Offline</div>
        </div>
      </div>

      {overview.systemsWithErrors > 0 && (
        <div className="stat-card error-card pulsate">
          <div className="stat-icon"><AlertTriangle size={20} /></div>
          <div className="stat-content">
            <div className="stat-value">{overview.systemsWithErrors}</div>
            <div className="stat-label">Errors</div>
          </div>
        </div>
      )}

      <div className="stat-card sensors">
        <div className="stat-icon"><Activity size={20} /></div>
        <div className="stat-content">
          <div className="stat-value">{overview.totalSensors}</div>
          <div className="stat-label">Sensors</div>
        </div>
      </div>

      <div className="stat-card fans">
        <div className="stat-icon"><Wind size={20} /></div>
        <div className="stat-content">
          <div className="stat-value">{overview.totalFans}</div>
          <div className="stat-label">Fans</div>
        </div>
      </div>

      <div className="stat-card temperature-avg">
        <div className="stat-icon"><ThermometerSnowflake size={20} /></div>
        <div className="stat-content">
          <div className={`stat-value temperature-${getTemperatureClass(overview.avgTemperature)}`}>
            {formatTemperature(overview.avgTemperature)}
          </div>
          <div className="stat-label">Avg Temp</div>
        </div>
      </div>

      <div className="stat-card temperature-high">
        <div className="stat-icon"><Thermometer size={20} /></div>
        <div className="stat-content">
          <div className={`stat-value temperature-${getTemperatureClass(overview.highestTemperature)}`}>
            {formatTemperature(overview.highestTemperature)}
          </div>
          <div className="stat-label">Highest Temp</div>
        </div>
      </div>
    </div>
  );
};

export default OverviewStats;

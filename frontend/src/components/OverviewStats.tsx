import React from 'react';
import type { SystemOverview } from '../types/api';
import { formatTemperature } from '../utils/formatters';

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
        <div className="stat-value">{getSystemsDisplay()}</div>
        <div className="stat-label">Total Systems</div>
      </div>
      
      <div className="stat-card online">
        <div className="stat-value">{overview.onlineSystems}</div>
        <div className="stat-label">Online</div>
      </div>
      
      <div className="stat-card offline">
        <div className="stat-value">{overview.offlineSystems}</div>
        <div className="stat-label">Offline</div>
      </div>
      
      {overview.systemsWithErrors > 0 && (
        <div className="stat-card error">
          <div className="stat-value">{overview.systemsWithErrors}</div>
          <div className="stat-label">Errors</div>
        </div>
      )}
      
      <div className="stat-card">
        <div className="stat-value">{overview.totalSensors}</div>
        <div className="stat-label">Total Sensors</div>
      </div>
      
      <div className="stat-card">
        <div className="stat-value">{overview.totalFans}</div>
        <div className="stat-label">Total Fans</div>
      </div>
      
      <div className="stat-card temperature">
        <div className="stat-value">
          {formatTemperature(overview.avgTemperature)}
        </div>
        <div className="stat-label">Avg Temperature</div>
      </div>
      
      <div className="stat-card temperature">
        <div className="stat-value">
          {formatTemperature(overview.highestTemperature)}
        </div>
        <div className="stat-label">Highest Temperature</div>
      </div>
    </div>
  );
};

export default OverviewStats;
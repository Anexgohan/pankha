import React from 'react';
import type { SystemOverview } from '../types/api';

interface OverviewStatsProps {
  overview: SystemOverview;
}

const OverviewStats: React.FC<OverviewStatsProps> = ({ overview }) => {
  return (
    <div className="overview-stats">
      <div className="stat-card">
        <div className="stat-value">{overview.totalSystems}</div>
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
          {overview.avgTemperature ? `${overview.avgTemperature.toFixed(1)}°C` : 'N/A'}
        </div>
        <div className="stat-label">Avg Temperature</div>
      </div>
      
      <div className="stat-card temperature">
        <div className="stat-value">
          {overview.highestTemperature ? `${overview.highestTemperature.toFixed(1)}°C` : 'N/A'}
        </div>
        <div className="stat-label">Highest Temperature</div>
      </div>
    </div>
  );
};

export default OverviewStats;
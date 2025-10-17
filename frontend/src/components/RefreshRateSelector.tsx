import React from 'react';
import { useDashboardSettings } from '../contexts/DashboardSettingsContext';

interface RefreshRateOption {
  value: number;
  label: string;
  icon: string;
}

const refreshRateOptions: RefreshRateOption[] = [
  { value: 500, label: 'Real-time (500ms)', icon: '⚡' },
  { value: 1000, label: 'Fast (1s)', icon: '🏃' },
  { value: 3000, label: 'Normal (3s)', icon: '⚖️' },
  { value: 5000, label: 'Balanced (5s)', icon: '🐢' },
  { value: 10000, label: 'Slow (10s)', icon: '🚶' },
  { value: 0, label: 'Manual only', icon: '⏸️' }
];

const RefreshRateSelector: React.FC = () => {
  const { refreshRate, setRefreshRate, isPaused, setPaused } = useDashboardSettings();

  const handleRefreshRateChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newRate = parseInt(event.target.value);
    
    if (newRate === 0) {
      // Manual mode - pause automatic updates
      setPaused(true);
    } else {
      // Set new refresh rate and resume if paused
      setRefreshRate(newRate);
      if (isPaused) {
        setPaused(false);
      }
    }
  };

  const displayValue = isPaused ? 0 : refreshRate;

  return (
    <div
      className="refresh-rate-selector"
      title="How frequently the dashboard fetches new data from the backend. Lower values show changes faster but use more bandwidth."
    >
      <label htmlFor="refresh-rate" className="refresh-rate-label">
        Dashboard Refresh Rate
      </label>
      <select
        id="refresh-rate"
        className="refresh-rate-dropdown"
        value={displayValue}
        onChange={handleRefreshRateChange}
        aria-label="Select dashboard refresh rate"
      >
        {refreshRateOptions.map(option => (
          <option key={option.value} value={option.value}>
            {option.icon} {option.label}
          </option>
        ))}
      </select>
    </div>
  );
};

export default RefreshRateSelector;
import React, { useState, useEffect } from 'react';
import { getControllerStatus, setControllerInterval } from '../services/api';

interface ControllerIntervalOption {
  value: number;
  label: string;
  icon: string;
}

const controllerIntervalOptions: ControllerIntervalOption[] = [
  { value: 500, label: 'Real-time (500ms)', icon: '⚡' },
  { value: 1000, label: 'Fast (1s)', icon: '🏃' },
  { value: 2000, label: 'Normal (2s)', icon: '⚖️' },
  { value: 3000, label: 'Balanced (3s)', icon: '🐢' },
  { value: 5000, label: 'Slow (5s)', icon: '🚶' },
  { value: 10000, label: 'Very Slow (10s)', icon: '🐌' }
];

const ControllerIntervalSelector: React.FC = () => {
  const [currentInterval, setCurrentInterval] = useState<number>(2000); // Default 2s
  const [loading, setLoading] = useState(false);

  // Fetch current controller status on mount
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const status = await getControllerStatus();
        setCurrentInterval(status.updateInterval);
      } catch (error) {
        console.error('Failed to fetch controller status:', error);
      }
    };
    fetchStatus();
  }, []);

  const handleIntervalChange = async (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newInterval = parseInt(event.target.value);

    setLoading(true);
    try {
      await setControllerInterval(newInterval);
      setCurrentInterval(newInterval);
      console.log(`✅ Backend controller interval changed to ${newInterval}ms`);
    } catch (error) {
      console.error('Failed to set controller interval:', error);
      alert('Failed to update backend controller interval. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="controller-interval-selector"
      title="How quickly the system calculates temperature changes and fan speeds, reads agents, send commands to agents. Lower values are CPU intensive."
    >
      <label htmlFor="controller-interval" className="controller-interval-label">
        System Responsiveness (CPU Load)
      </label>
      <select
        id="controller-interval"
        className="controller-interval-dropdown"
        value={currentInterval}
        onChange={handleIntervalChange}
        disabled={loading}
        aria-label="Select system responsiveness"
      >
        {controllerIntervalOptions.map(option => (
          <option key={option.value} value={option.value}>
            {option.icon} {option.label}
          </option>
        ))}
      </select>
      {loading && <span className="loading-spinner">⏳</span>}
    </div>
  );
};

export default ControllerIntervalSelector;

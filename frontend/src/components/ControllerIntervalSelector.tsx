import React, { useState, useEffect } from 'react';
import { getControllerStatus, setControllerInterval } from '../services/api';
import { toast } from '../utils/toast';
import { Loader2 } from 'lucide-react';
import { Select } from './ui/Select';
import type { SelectOption } from './ui/Select';

interface ControllerIntervalOption {
  value: number;
  label: string;
  icon: string;
}

const controllerIntervalOptions: ControllerIntervalOption[] = [
  { value: 500, label: 'Real-time (500ms)', icon: 'zap' },
  { value: 1000, label: 'Fast (1s)', icon: 'rocket' },
  { value: 2000, label: 'Normal (2s)', icon: 'gauge' },
  { value: 3000, label: 'Balanced (3s)', icon: 'coffee' },
  { value: 5000, label: 'Slow (5s)', icon: 'clock' },
  { value: 10000, label: 'Very Slow (10s)', icon: 'history' }
];

const selectOptions: SelectOption<number>[] = controllerIntervalOptions.map(
  (option) => ({ value: option.value, label: option.label })
);

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

  const handleIntervalChange = async (newInterval: number) => {
    setLoading(true);
    try {
      await setControllerInterval(newInterval);
      setCurrentInterval(newInterval);
      console.log(`✅ Backend controller interval changed to ${newInterval}ms`);
    } catch (error) {
      console.error('Failed to set controller interval:', error);
      toast.error('Failed to update backend controller interval. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="controller-interval-selector"
      title="How frequently the backend controller processes fan profiles and sends control commands to agents. Agents push their data independently based on their Agent Rate. Lower values increase CPU usage but provide faster fan speed adjustments."
    >
      <label htmlFor="controller-interval" className="controller-interval-label">
        System Responsiveness (CPU Load)
      </label>
      <Select
        id="controller-interval"
        value={currentInterval}
        onChange={handleIntervalChange}
        options={selectOptions}
        disabled={loading}
        width={180}
        ariaLabel="Select system responsiveness"
      />
      {loading && <Loader2 className="animate-spin" size={14} />}
    </div>
  );
};

export default ControllerIntervalSelector;

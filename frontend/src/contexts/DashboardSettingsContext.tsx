import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { updateSetting } from '../services/api';

interface DashboardSettingsContextType {
  graphScale: number;
  updateGraphScale: (hours: number) => Promise<void>;
  isLoading: boolean;
  timezone: string;
}

const DashboardSettingsContext = createContext<DashboardSettingsContextType | undefined>(undefined);

export const useDashboardSettings = () => {
  const context = useContext(DashboardSettingsContext);
  if (context === undefined) {
    throw new Error('useDashboardSettings must be used within a DashboardSettingsProvider');
  }
  return context;
};

export const DashboardSettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [graphScale, setGraphScale] = useState<number>(24);
  const [timezone, setTimezone] = useState<string>('UTC');
  const [isLoading, setIsLoading] = useState(true);

  const fetchSettings = useCallback(async () => {
    try {
      const { getSetting, getHealth } = await import('../services/api');
      
      // Fetch both setting and health for timezone
      const [setting, health] = await Promise.all([
        getSetting('graph_history_hours'),
        getHealth()
      ]);

      if (setting && setting.setting_value) {
        setGraphScale(parseInt(setting.setting_value, 10));
      }
      
      if (health && health.timezone) {
        setTimezone(health.timezone);
      }
    } catch (err) {
      console.error('Failed to fetch dashboard settings:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const updateGraphScale = async (hours: number) => {
    // Optimistic update
    setGraphScale(hours);
    try {
      await updateSetting('graph_history_hours', hours);
    } catch (err) {
      console.error('Failed to update graph scale setting:', err);
      // Revert on failure
      fetchSettings();
    }
  };

  return (
    <DashboardSettingsContext.Provider value={{ graphScale, updateGraphScale, isLoading, timezone }}>
      {children}
    </DashboardSettingsContext.Provider>
  );
};

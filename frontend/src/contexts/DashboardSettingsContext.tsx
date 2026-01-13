import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { getSetting, updateSetting } from '../services/api';

interface DashboardSettingsContextType {
  graphScale: number;
  updateGraphScale: (hours: number) => Promise<void>;
  isLoading: boolean;
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
  const [isLoading, setIsLoading] = useState(true);

  const fetchSettings = useCallback(async () => {
    try {
      const setting = await getSetting('graph_history_hours');
      if (setting && setting.setting_value) {
        setGraphScale(parseInt(setting.setting_value, 10));
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
    <DashboardSettingsContext.Provider value={{ graphScale, updateGraphScale, isLoading }}>
      {children}
    </DashboardSettingsContext.Provider>
  );
};

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { updateSetting, getSetting, getHealth } from '../services/api';

/**
 * Dashboard Settings Context
 * 
 * Manages global dashboard preferences:
 * - graphScale: Historical data window for sparklines (in hours)
 * - dataRetentionDays: How many days of history to keep (configurable within license tier)
 * - timezone: Server timezone for date formatting
 */
interface DashboardSettingsContextType {
  graphScale: number;
  updateGraphScale: (hours: number) => Promise<void>;
  dataRetentionDays: number;
  updateDataRetention: (days: number) => Promise<void>;
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
  const [dataRetentionDays, setDataRetentionDays] = useState<number>(30);
  const [timezone, setTimezone] = useState<string>('UTC');
  const [isLoading, setIsLoading] = useState(true);

  const fetchSettings = useCallback(async () => {
    try {
      // Fetch settings and health for timezone in parallel
      // Use Promise.allSettled to handle individual failures gracefully
      // (e.g., data_retention_days may not exist yet, but timezone should still load)
      const results = await Promise.allSettled([
        getSetting('graph_history_hours'),
        getSetting('data_retention_days'),
        getHealth()
      ]);

      // Process graph scale
      if (results[0].status === 'fulfilled' && results[0].value?.setting_value) {
        setGraphScale(parseInt(results[0].value.setting_value, 10));
      }

      // Process data retention
      if (results[1].status === 'fulfilled' && results[1].value?.setting_value) {
        setDataRetentionDays(parseInt(results[1].value.setting_value, 10));
      }

      // Process timezone (from health endpoint)
      if (results[2].status === 'fulfilled' && results[2].value?.timezone) {
        setTimezone(results[2].value.timezone);
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

  const updateDataRetention = async (days: number) => {
    // Optimistic update
    setDataRetentionDays(days);
    try {
      await updateSetting('data_retention_days', days);
    } catch (err) {
      console.error('Failed to update data retention setting:', err);
      // Revert on failure
      fetchSettings();
    }
  };

  return (
    <DashboardSettingsContext.Provider value={{ 
      graphScale, 
      updateGraphScale, 
      dataRetentionDays, 
      updateDataRetention, 
      isLoading, 
      timezone 
    }}>
      {children}
    </DashboardSettingsContext.Provider>
  );
};


import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { updateSetting, getSetting, getHealth } from '../services/api';

/**
 * Dashboard Settings Context
 * 
 * Manages global dashboard preferences:
 * - graphScale: Historical data window for sparklines (in hours)
 * - dataRetentionDays: How many days of history to keep (configurable within license tier)
 * - timezone: Server timezone for date formatting
 * - accentColor: Main theme accent color
 * - hoverTintColor: Background tint color for hover states
 */
interface DashboardSettingsContextType {
  graphScale: number;
  updateGraphScale: (hours: number) => Promise<void>;
  dataRetentionDays: number;
  updateDataRetention: (days: number) => Promise<void>;
  accentColor: string;
  updateAccentColor: (color: string) => Promise<void>;
  hoverTintColor: string;
  updateHoverTintColor: (color: string) => Promise<void>;
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
  const [accentColor, setAccentColor] = useState<string>('#2196F3');
  const [hoverTintColor, setHoverTintColor] = useState<string>('#2196F3');
  const [timezone, setTimezone] = useState<string>('UTC');
  const [isLoading, setIsLoading] = useState(true);

  const fetchSettings = useCallback(async () => {
    try {
      // Fetch settings and health for timezone in parallel
      const results = await Promise.allSettled([
        getSetting('graph_history_hours'),
        getSetting('data_retention_days'),
        getSetting('accent_color'),
        getSetting('hover_tint_color'),
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

      // Process colors (Restored separate)
      if (results[2].status === 'fulfilled' && results[2].value?.setting_value) {
        setAccentColor(results[2].value.setting_value);
      }
      if (results[3].status === 'fulfilled' && results[3].value?.setting_value) {
        setHoverTintColor(results[3].value.setting_value);
      }

      // Process timezone (from health endpoint)
      if (results[4].status === 'fulfilled' && results[4].value?.timezone) {
        setTimezone(results[4].value.timezone);
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

  // Apply colors to document root
  useEffect(() => {
    document.documentElement.style.setProperty('--color-accent-dynamic', accentColor);
    document.documentElement.style.setProperty('--color-hover-tint-dynamic', hoverTintColor);
  }, [accentColor, hoverTintColor]);

  const updateGraphScale = async (hours: number) => {
    setGraphScale(hours);
    try {
      await updateSetting('graph_history_hours', hours);
    } catch (err) {
      console.error('Failed to update graph scale setting:', err);
      fetchSettings();
    }
  };

  const updateDataRetention = async (days: number) => {
    setDataRetentionDays(days);
    try {
      await updateSetting('data_retention_days', days);
    } catch (err) {
      console.error('Failed to update data retention setting:', err);
      fetchSettings();
    }
  };

  const updateAccentColor = async (color: string) => {
    setAccentColor(color);
    try {
      await updateSetting('accent_color', color);
    } catch (err) {
      console.error('Failed to update accent color:', err);
      fetchSettings();
    }
  };

  const updateHoverTintColor = async (color: string) => {
    setHoverTintColor(color);
    try {
      await updateSetting('hover_tint_color', color);
    } catch (err) {
      console.error('Failed to update hover tint color:', err);
      fetchSettings();
    }
  };

  return (
    <DashboardSettingsContext.Provider value={{ 
      graphScale, 
      updateGraphScale, 
      dataRetentionDays, 
      updateDataRetention,
      accentColor,
      updateAccentColor,
      hoverTintColor,
      updateHoverTintColor,
      isLoading, 
      timezone 
    }}>
      {children}
    </DashboardSettingsContext.Provider>
  );
};

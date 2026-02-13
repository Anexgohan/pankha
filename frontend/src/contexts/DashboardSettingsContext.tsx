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
 * - tempThresholds: Temperature thresholds for caution/warning/critical color coding
 * - tempColors: Colors for normal/caution/warning/critical temperature levels
 * - perTypeThresholds: Optional per-type (CPU/GPU/NVMe/Mobo) threshold overrides
 */

// ── Temperature Threshold Types ──

export interface TempThresholds {
  caution: number;
  warning: number;
  critical: number;
}

export interface TempColors {
  normal: string;
  caution: string;
  warning: string;
  critical: string;
}

export interface PerTypeThresholds {
  cpu?: TempThresholds;
  gpu?: TempThresholds;
  nvme?: TempThresholds;
  mobo?: TempThresholds;
}

export const DEFAULT_TEMP_THRESHOLDS: TempThresholds = { caution: 60, warning: 70, critical: 85 };

export const DEFAULT_TEMP_COLORS: TempColors = {
  normal: '#4CAF50',
  caution: '#FFCA28',
  warning: '#FF7700',
  critical: '#c80f0f',
};

// ── Context Interface ──

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
  // Temperature thresholds
  tempThresholds: TempThresholds;
  updateTempThresholds: (thresholds: TempThresholds) => Promise<void>;
  tempColors: TempColors;
  updateTempColors: (colors: TempColors) => Promise<void>;
  perTypeEnabled: boolean;
  setPerTypeEnabled: (enabled: boolean) => Promise<void>;
  perTypeThresholds: PerTypeThresholds;
  updatePerTypeThresholds: (thresholds: PerTypeThresholds) => Promise<void>;
  resetTempDefaults: () => Promise<void>;
  getThresholdsForType: (sensorType?: string) => TempThresholds;
}

const DashboardSettingsContext = createContext<DashboardSettingsContextType | undefined>(undefined);

export const useDashboardSettings = () => {
  const context = useContext(DashboardSettingsContext);
  if (context === undefined) {
    throw new Error('useDashboardSettings must be used within a DashboardSettingsProvider');
  }
  return context;
};

/**
 * Derive bg/text/border CSS vars from a single primary color.
 * bg = primary at low opacity, border = primary, text = primary
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16),
  } : null;
}

function applyTempColorVars(colors: TempColors) {
  const levels = ['normal', 'caution', 'warning', 'critical'] as const;
  const root = document.documentElement;

  for (const level of levels) {
    const color = colors[level];
    const rgb = hexToRgb(color);
    if (!rgb) continue;

    // border = primary color
    root.style.setProperty(`--temp-${level}-border`, color);
    // text = primary color (readable on both themes)
    root.style.setProperty(`--temp-${level}-text`, color);
    // bg = primary at low opacity
    root.style.setProperty(`--temp-${level}-bg`, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.1)`);
  }
}

export const DashboardSettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [graphScale, setGraphScale] = useState<number>(24);
  const [dataRetentionDays, setDataRetentionDays] = useState<number>(30);
  const [accentColor, setAccentColor] = useState<string>('#B61B4F');
  const [hoverTintColor, setHoverTintColor] = useState<string>('#0FEEEE');
  const [timezone, setTimezone] = useState<string>('UTC');
  const [isLoading, setIsLoading] = useState(true);

  // Temperature threshold state
  const [tempThresholds, setTempThresholds] = useState<TempThresholds>(DEFAULT_TEMP_THRESHOLDS);
  const [tempColors, setTempColors] = useState<TempColors>(DEFAULT_TEMP_COLORS);
  const [perTypeEnabled, setPerTypeEnabledState] = useState<boolean>(false);
  const [perTypeThresholds, setPerTypeThresholds] = useState<PerTypeThresholds>({});

  const fetchSettings = useCallback(async () => {
    try {
      const results = await Promise.allSettled([
        getSetting('graph_history_hours'),
        getSetting('data_retention_days'),
        getSetting('accent_color'),
        getSetting('hover_tint_color'),
        getHealth(),
        getSetting('temp_thresholds'),
        getSetting('temp_colors'),
        getSetting('per_type_enabled'),
        getSetting('per_type_thresholds'),
      ]);

      // Process graph scale
      if (results[0].status === 'fulfilled' && results[0].value?.setting_value) {
        setGraphScale(parseInt(results[0].value.setting_value, 10));
      }

      // Process data retention
      if (results[1].status === 'fulfilled' && results[1].value?.setting_value) {
        setDataRetentionDays(parseInt(results[1].value.setting_value, 10));
      }

      // Process colors
      if (results[2].status === 'fulfilled' && results[2].value?.setting_value) {
        setAccentColor(results[2].value.setting_value);
      }
      if (results[3].status === 'fulfilled' && results[3].value?.setting_value) {
        setHoverTintColor(results[3].value.setting_value);
      }

      // Process timezone
      if (results[4].status === 'fulfilled' && results[4].value?.timezone) {
        setTimezone(results[4].value.timezone);
      }

      // Process temperature thresholds
      if (results[5].status === 'fulfilled' && results[5].value?.setting_value) {
        try { setTempThresholds(JSON.parse(results[5].value.setting_value)); } catch { /* keep defaults */ }
      }
      if (results[6].status === 'fulfilled' && results[6].value?.setting_value) {
        try { setTempColors(JSON.parse(results[6].value.setting_value)); } catch { /* keep defaults */ }
      }
      if (results[7].status === 'fulfilled' && results[7].value?.setting_value) {
        setPerTypeEnabledState(results[7].value.setting_value === 'true');
      }
      if (results[8].status === 'fulfilled' && results[8].value?.setting_value) {
        try { setPerTypeThresholds(JSON.parse(results[8].value.setting_value)); } catch { /* keep defaults */ }
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

  // Apply accent/hover colors to document root
  useEffect(() => {
    document.documentElement.style.setProperty('--color-accent-dynamic', accentColor);
    document.documentElement.style.setProperty('--color-hover-tint-dynamic', hoverTintColor);
  }, [accentColor, hoverTintColor]);

  // Apply temperature colors to document root
  useEffect(() => {
    applyTempColorVars(tempColors);
  }, [tempColors]);

  // ── Setting Updaters ──

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

  const updateTempThresholds = async (thresholds: TempThresholds) => {
    setTempThresholds(thresholds);
    try {
      await updateSetting('temp_thresholds', JSON.stringify(thresholds));
    } catch (err) {
      console.error('Failed to update temp thresholds:', err);
      fetchSettings();
    }
  };

  const updateTempColors = async (colors: TempColors) => {
    setTempColors(colors);
    try {
      await updateSetting('temp_colors', JSON.stringify(colors));
    } catch (err) {
      console.error('Failed to update temp colors:', err);
      fetchSettings();
    }
  };

  const setPerTypeEnabled = async (enabled: boolean) => {
    setPerTypeEnabledState(enabled);
    try {
      await updateSetting('per_type_enabled', String(enabled));
    } catch (err) {
      console.error('Failed to update per-type enabled:', err);
      fetchSettings();
    }
  };

  const updatePerTypeThresholdsHandler = async (thresholds: PerTypeThresholds) => {
    setPerTypeThresholds(thresholds);
    try {
      await updateSetting('per_type_thresholds', JSON.stringify(thresholds));
    } catch (err) {
      console.error('Failed to update per-type thresholds:', err);
      fetchSettings();
    }
  };

  const resetTempDefaults = async () => {
    setTempThresholds(DEFAULT_TEMP_THRESHOLDS);
    setTempColors(DEFAULT_TEMP_COLORS);
    setPerTypeEnabledState(false);
    setPerTypeThresholds({});
    try {
      await Promise.all([
        updateSetting('temp_thresholds', JSON.stringify(DEFAULT_TEMP_THRESHOLDS)),
        updateSetting('temp_colors', JSON.stringify(DEFAULT_TEMP_COLORS)),
        updateSetting('per_type_enabled', 'false'),
        updateSetting('per_type_thresholds', JSON.stringify({})),
      ]);
    } catch (err) {
      console.error('Failed to reset temp defaults:', err);
      fetchSettings();
    }
  };

  /**
   * Get the effective thresholds for a given sensor type.
   * If per-type is enabled and the type has overrides, use those.
   * Otherwise, use global thresholds.
   */
  const getThresholdsForType = useCallback((sensorType?: string): TempThresholds => {
    if (!perTypeEnabled || !sensorType) return tempThresholds;

    const typeKey = sensorType.toLowerCase();
    // Map common sensor type strings to our per-type keys
    let key: keyof PerTypeThresholds | undefined;
    if (typeKey.includes('cpu')) key = 'cpu';
    else if (typeKey.includes('gpu')) key = 'gpu';
    else if (typeKey.includes('nvme') || typeKey.includes('storage') || typeKey.includes('disk')) key = 'nvme';
    else if (typeKey.includes('mobo') || typeKey.includes('motherboard') || typeKey.includes('mainboard')) key = 'mobo';

    if (key && perTypeThresholds[key]) {
      return perTypeThresholds[key]!;
    }
    return tempThresholds;
  }, [perTypeEnabled, tempThresholds, perTypeThresholds]);

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
      timezone,
      tempThresholds,
      updateTempThresholds,
      tempColors,
      updateTempColors,
      perTypeEnabled,
      setPerTypeEnabled,
      perTypeThresholds,
      updatePerTypeThresholds: updatePerTypeThresholdsHandler,
      resetTempDefaults,
      getThresholdsForType,
    }}>
      {children}
    </DashboardSettingsContext.Provider>
  );
};

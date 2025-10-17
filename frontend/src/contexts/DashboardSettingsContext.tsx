import React, { createContext, useContext, useEffect, useState } from 'react';

export interface DashboardSettings {
  refreshRate: number; // milliseconds
  isPaused: boolean;
  showRefreshIndicator: boolean;
  pauseOnInactive: boolean;
}

interface DashboardSettingsContextType {
  refreshRate: number;
  setRefreshRate: (rate: number) => void;
  isPaused: boolean;
  setPaused: (paused: boolean) => void;
  showRefreshIndicator: boolean;
  setShowRefreshIndicator: (show: boolean) => void;
  pauseOnInactive: boolean;
  setPauseOnInactive: (pause: boolean) => void;
  settings: DashboardSettings;
}

const DashboardSettingsContext = createContext<DashboardSettingsContextType | undefined>(undefined);

export const useDashboardSettings = () => {
  const context = useContext(DashboardSettingsContext);
  if (context === undefined) {
    throw new Error('useDashboardSettings must be used within a DashboardSettingsProvider');
  }
  return context;
};

interface DashboardSettingsProviderProps {
  children: React.ReactNode;
}

const defaultSettings: DashboardSettings = {
  refreshRate: 3000, // 3 seconds default (matches current behavior)
  isPaused: false,
  showRefreshIndicator: true,
  pauseOnInactive: true
};

export const DashboardSettingsProvider: React.FC<DashboardSettingsProviderProps> = ({ children }) => {
  const [settings, setSettings] = useState<DashboardSettings>(() => {
    const saved = localStorage.getItem('pankha-dashboard-settings');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return { ...defaultSettings, ...parsed };
      } catch (err) {
        console.warn('Failed to parse saved dashboard settings, using defaults:', err);
      }
    }
    return defaultSettings;
  });

  const [isTabActive, setIsTabActive] = useState(true);

  // Handle tab visibility changes
  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsTabActive(!document.hidden);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  // Save settings to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem('pankha-dashboard-settings', JSON.stringify(settings));
  }, [settings]);

  const setRefreshRate = (rate: number) => {
    setSettings(prev => ({ ...prev, refreshRate: rate }));
  };

  const setPaused = (paused: boolean) => {
    setSettings(prev => ({ ...prev, isPaused: paused }));
  };

  const setShowRefreshIndicator = (show: boolean) => {
    setSettings(prev => ({ ...prev, showRefreshIndicator: show }));
  };

  const setPauseOnInactive = (pause: boolean) => {
    setSettings(prev => ({ ...prev, pauseOnInactive: pause }));
  };

  // Determine effective pause state (user pause OR inactive tab if enabled)
  const effectiveIsPaused = settings.isPaused || (settings.pauseOnInactive && !isTabActive);

  const value = {
    refreshRate: settings.refreshRate,
    setRefreshRate,
    isPaused: effectiveIsPaused,
    setPaused,
    showRefreshIndicator: settings.showRefreshIndicator,
    setShowRefreshIndicator,
    pauseOnInactive: settings.pauseOnInactive,
    setPauseOnInactive,
    settings
  };

  return (
    <DashboardSettingsContext.Provider value={value}>
      {children}
    </DashboardSettingsContext.Provider>
  );
};
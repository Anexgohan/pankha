import React, { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';

interface SensorVisibilityContextType {
  hiddenSensors: Set<string>;
  hiddenGroups: Set<string>;
  toggleSensorVisibility: (sensorId: string) => void;
  toggleGroupVisibility: (groupId: string) => void;
  isSensorHidden: (sensorId: string) => boolean;
  isGroupHidden: (groupId: string) => boolean;
  resetVisibility: () => void;
}

const SensorVisibilityContext = createContext<SensorVisibilityContextType | undefined>(undefined);

const STORAGE_KEY = 'pankha_hidden_sensors';
const GROUPS_STORAGE_KEY = 'pankha_hidden_groups';

export const SensorVisibilityProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [hiddenSensors, setHiddenSensors] = useState<Set<string>>(() => {
    // Load from localStorage on initialization
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        return new Set(JSON.parse(stored));
      } catch (e) {
        console.error('Failed to parse hidden sensors from localStorage:', e);
        return new Set();
      }
    }
    return new Set();
  });

  const [hiddenGroups, setHiddenGroups] = useState<Set<string>>(() => {
    // Load from localStorage on initialization
    const stored = localStorage.getItem(GROUPS_STORAGE_KEY);
    if (stored) {
      try {
        return new Set(JSON.parse(stored));
      } catch (e) {
        console.error('Failed to parse hidden groups from localStorage:', e);
        return new Set();
      }
    }
    return new Set();
  });

  // Save to localStorage whenever hiddenSensors changes
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(hiddenSensors)));
  }, [hiddenSensors]);

  // Save to localStorage whenever hiddenGroups changes
  useEffect(() => {
    localStorage.setItem(GROUPS_STORAGE_KEY, JSON.stringify(Array.from(hiddenGroups)));
  }, [hiddenGroups]);

  const toggleSensorVisibility = (sensorId: string) => {
    setHiddenSensors(prev => {
      const newSet = new Set(prev);
      if (newSet.has(sensorId)) {
        newSet.delete(sensorId);
      } else {
        newSet.add(sensorId);
      }
      return newSet;
    });
  };

  const toggleGroupVisibility = (groupId: string) => {
    setHiddenGroups(prev => {
      const newSet = new Set(prev);
      if (newSet.has(groupId)) {
        newSet.delete(groupId);
      } else {
        newSet.add(groupId);
      }
      return newSet;
    });
  };

  const isSensorHidden = (sensorId: string): boolean => {
    return hiddenSensors.has(sensorId);
  };

  const isGroupHidden = (groupId: string): boolean => {
    return hiddenGroups.has(groupId);
  };

  const resetVisibility = () => {
    setHiddenSensors(new Set());
    setHiddenGroups(new Set());
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(GROUPS_STORAGE_KEY);
  };

  return (
    <SensorVisibilityContext.Provider value={{
      hiddenSensors,
      hiddenGroups,
      toggleSensorVisibility,
      toggleGroupVisibility,
      isSensorHidden,
      isGroupHidden,
      resetVisibility
    }}>
      {children}
    </SensorVisibilityContext.Provider>
  );
};

export const useSensorVisibility = () => {
  const context = useContext(SensorVisibilityContext);
  if (!context) {
    throw new Error('useSensorVisibility must be used within a SensorVisibilityProvider');
  }
  return context;
};

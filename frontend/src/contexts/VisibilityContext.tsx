import React, { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';

interface VisibilityContextType {
  hiddenSensors: Set<string>;
  hiddenGroups: Set<string>;
  hiddenFans: Set<string>;
  toggleSensorVisibility: (sensorId: string) => void;
  toggleGroupVisibility: (groupId: string) => void;
  toggleFanVisibility: (fanId: string) => void;
  isSensorHidden: (sensorId: string) => boolean;
  isGroupHidden: (groupId: string) => boolean;
  isFanHidden: (fanId: string) => boolean;
  resetVisibility: () => void;
}

const VisibilityContext = createContext<VisibilityContextType | undefined>(undefined);

const STORAGE_KEY = 'pankha_hidden_sensors';
const GROUPS_STORAGE_KEY = 'pankha_hidden_groups';
const FANS_STORAGE_KEY = 'pankha_hidden_fans';

function loadSet(key: string, label: string): Set<string> {
  const stored = localStorage.getItem(key);
  if (stored) {
    try {
      return new Set(JSON.parse(stored));
    } catch (e) {
      console.error(`Failed to parse hidden ${label} from localStorage:`, e);
    }
  }
  return new Set();
}

function toggleInSet(setter: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) {
  setter(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
}

export const VisibilityProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [hiddenSensors, setHiddenSensors] = useState<Set<string>>(() => loadSet(STORAGE_KEY, 'sensors'));
  const [hiddenGroups, setHiddenGroups] = useState<Set<string>>(() => loadSet(GROUPS_STORAGE_KEY, 'groups'));
  const [hiddenFans, setHiddenFans] = useState<Set<string>>(() => loadSet(FANS_STORAGE_KEY, 'fans'));

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(hiddenSensors)));
  }, [hiddenSensors]);

  useEffect(() => {
    localStorage.setItem(GROUPS_STORAGE_KEY, JSON.stringify(Array.from(hiddenGroups)));
  }, [hiddenGroups]);

  useEffect(() => {
    localStorage.setItem(FANS_STORAGE_KEY, JSON.stringify(Array.from(hiddenFans)));
  }, [hiddenFans]);

  const toggleSensorVisibility = (sensorId: string) => toggleInSet(setHiddenSensors, sensorId);
  const toggleGroupVisibility = (groupId: string) => toggleInSet(setHiddenGroups, groupId);
  const toggleFanVisibility = (fanId: string) => toggleInSet(setHiddenFans, fanId);

  const isSensorHidden = (sensorId: string): boolean => hiddenSensors.has(sensorId);
  const isGroupHidden = (groupId: string): boolean => hiddenGroups.has(groupId);
  const isFanHidden = (fanId: string): boolean => hiddenFans.has(fanId);

  const resetVisibility = () => {
    setHiddenSensors(new Set());
    setHiddenGroups(new Set());
    setHiddenFans(new Set());
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(GROUPS_STORAGE_KEY);
    localStorage.removeItem(FANS_STORAGE_KEY);
  };

  return (
    <VisibilityContext.Provider value={{
      hiddenSensors,
      hiddenGroups,
      hiddenFans,
      toggleSensorVisibility,
      toggleGroupVisibility,
      toggleFanVisibility,
      isSensorHidden,
      isGroupHidden,
      isFanHidden,
      resetVisibility
    }}>
      {children}
    </VisibilityContext.Provider>
  );
};

export const useVisibility = () => {
  const context = useContext(VisibilityContext);
  if (!context) {
    throw new Error('useVisibility must be used within a VisibilityProvider');
  }
  return context;
};

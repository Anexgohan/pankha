/**
 * License Context - Provides license tier information throughout the app
 */

import React, { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { getLicense } from '../services/api';

export interface LicenseInfo {
  tier: string;
  billing: string | null;
  customerName: string | null;
  agentLimit: number;
  retentionDays: number;
  alertLimit: number;
  alertChannels: string[];
  apiAccess: string;
  showBranding: boolean;
  expiresAt: string | null;
  activatedAt: string | null;
  nextBillingDate: string | null;
  discountCode: string | null;
  discountCyclesRemaining: number | null;
  lastSyncAt: string | null;
}

interface LicenseContextType {
  license: LicenseInfo | null;
  isLoading: boolean;
  error: string | null;
  refreshLicense: () => Promise<void>;
}

const LicenseContext = createContext<LicenseContextType | undefined>(undefined);

interface LicenseProviderProps {
  children: ReactNode;
}

export const LicenseProvider: React.FC<LicenseProviderProps> = ({ children }) => {
  const [license, setLicense] = useState<LicenseInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshLicense = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await getLicense();
      setLicense(data);
    } catch (err) {
      console.error('[LicenseContext] Failed to fetch license:', err);
      setError('Failed to load license info');
      // Set default free tier on error
      setLicense({
        tier: 'Free',
        billing: null,
        customerName: null,
        agentLimit: 3,
        retentionDays: 7,
        alertLimit: 2,
        alertChannels: ['dashboard', 'email'],
        apiAccess: 'none',
        showBranding: true,
        expiresAt: null,
        activatedAt: null,
        nextBillingDate: null,
        discountCode: null,
        discountCyclesRemaining: null,
        lastSyncAt: null,
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    refreshLicense();
  }, []);

  return (
    <LicenseContext.Provider value={{ license, isLoading, error, refreshLicense }}>
      {children}
    </LicenseContext.Provider>
  );
};

export const useLicense = () => {
  const context = useContext(LicenseContext);
  if (context === undefined) {
    throw new Error('useLicense must be used within a LicenseProvider');
  }
  return context;
};

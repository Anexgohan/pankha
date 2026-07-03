/**
 * License Context - Provides license tier information throughout the app
 */

import React, { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { getLicense } from '../services/api';
import { subscribeToLicenseUpdated } from '../hooks/useWebSocketData';

export interface LicenseInfo {
  tier: string;
  billing: string | null;
  customerName: string | null;
  customerEmail: string | null;
  licenseId: string | null;
  subscriptionId: string | null;  // JWT `sid` claim - Dodo subscription identifier; null for lifetime/free
  customerId: string | null;      // Dodo persistent customer identifier (from /status sync); null if not yet synced
  token: string | null;           // Raw JWT for user-visible reveal/copy field; null on free tier
  agentLimit: number;
  retentionDays: number;
  alertLimit: number;
  alertChannels: string[];
  apiAccess: string;
  showBranding: boolean;
  expiresAt: string | null;
  graceExpiresAt: string | null;  // Token exp + offline grace; drives the Grace badge/countdown. null for lifetime/free.
  activatedAt: string | null;
  nextBillingDate: string | null;
  discountCode: string | null;
  discountCyclesRemaining: number | null;
  periodInterval: string | null;  // From JWT period_interval claim - "Day"|"Week"|"Month"|"Year"; null falls back to billing enum for badge display
  periodCount: number | null;     // From JWT period_count claim - e.g. 1, 7
  seatState: 'bound' | 'lost' | null;  // Seat binding: 'lost' = license active on another system (soft-demoted); null = unbound/bind-exempt
  cancelScheduledAt: string | null;    // When cancel-at-period-end was requested; drives the "Cancellation scheduled" state
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

  // Loading state is shown only on the initial fetch (license === null at mount).
  // Background refetches (tab focus, network resume, manual Sync/Activate) update
  // the data silently: no spinner flash, no reset of in-progress edits.
  const refreshLicense = useCallback(async () => {
    try {
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
        customerEmail: null,
        licenseId: null,
        subscriptionId: null,
        customerId: null,
        token: null,
        agentLimit: 3,
        retentionDays: 7,
        alertLimit: 2,
        alertChannels: ['dashboard', 'email'],
        apiAccess: 'none',
        showBranding: true,
        expiresAt: null,
        graceExpiresAt: null,
        activatedAt: null,
        nextBillingDate: null,
        discountCode: null,
        discountCyclesRemaining: null,
        periodInterval: null,
        periodCount: null,
        seatState: null,
        cancelScheduledAt: null,
        lastSyncAt: null,
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshLicense();

    // Re-pull when the user returns to the tab or the browser regains network,
    // so an autonomous backend renewal is reflected without a manual reload.
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshLicense();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', refreshLicense);
    // Backend pushes `licenseUpdated` over the dashboard WebSocket whenever the
    // license changes (e.g. autonomous renewal pickup), so an always-open screen
    // reflects it without waiting for a tab-focus or network event.
    const unsubscribeLicensePush = subscribeToLicenseUpdated(refreshLicense);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', refreshLicense);
      unsubscribeLicensePush();
    };
  }, [refreshLicense]);

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

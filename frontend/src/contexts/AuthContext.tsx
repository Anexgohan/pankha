import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import * as authApi from '../services/authApi';
import type { AuthMe, Role } from '../services/authApi';
import { subscribeAuthRequired } from '../services/authEvents';

// The ONLY place the frontend knows the role ladder. Components ask
// can('operator'), never "am I an operator?" - so new roles slot in here.
const ROLE_LEVEL: Record<Role, number> = { viewer: 1, operator: 2, admin: 3 };

export type AuthStatus = 'loading' | 'setup' | 'login' | 'ready';

interface AuthContextValue {
  status: AuthStatus;
  username: string | null;
  role: Role | null;
  registrationEnabled: boolean;
  authResetActive: boolean;
  can: (minRole: Role) => boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setupAdmin: (username: string, password: string) => Promise<void>;
  registerAccount: (username: string, password: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [username, setUsername] = useState<string | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [registrationEnabled, setRegistrationEnabled] = useState(false);
  const [authResetActive, setAuthResetActive] = useState(false);

  const applyMe = useCallback((me: AuthMe) => {
    setAuthResetActive(me.auth_reset_active === true);
    if (me.authenticated && me.username && me.role) {
      setUsername(me.username);
      setRole(me.role);
      setStatus('ready');
    } else {
      setUsername(null);
      setRole(null);
      setRegistrationEnabled(me.registration_enabled === true);
      setStatus(me.setup_required ? 'setup' : 'login');
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      applyMe(await authApi.getMe());
    } catch (error) {
      // Backend unreachable: keep the current screen; the caller's own
      // error handling (connection banner, retries) covers this
      console.error('Failed to fetch auth state:', error);
    }
  }, [applyMe]);

  useEffect(() => {
    refresh();
    return subscribeAuthRequired(() => {
      refresh();
    });
  }, [refresh]);

  const login = useCallback(async (user: string, password: string) => {
    const result = await authApi.login(user, password);
    setUsername(result.username);
    setRole(result.role);
    setStatus('ready');
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      await refresh();
    }
  }, [refresh]);

  const setupAdmin = useCallback(async (user: string, password: string) => {
    const result = await authApi.setupAdmin(user, password);
    setUsername(result.username);
    setRole(result.role);
    setStatus('ready');
  }, []);

  const registerAccount = useCallback(async (user: string, password: string) => {
    const result = await authApi.registerAccount(user, password);
    setUsername(result.username);
    setRole(result.role);
    setStatus('ready');
  }, []);

  const can = useCallback(
    (minRole: Role) => role !== null && (ROLE_LEVEL[role] ?? 0) >= ROLE_LEVEL[minRole],
    [role]
  );

  return (
    <AuthContext.Provider
      value={{
        status,
        username,
        role,
        registrationEnabled,
        authResetActive,
        can,
        login,
        logout,
        setupAdmin,
        registerAccount,
        refresh,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}

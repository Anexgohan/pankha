interface PankhaBootConfig {
  hubIp: string | null;
  hubPort: string;
  pankhaMode: string | null;
  isDemoMode: boolean;
}

declare global {
  interface Window {
    __PANKHA_CONFIG__?: PankhaBootConfig;
  }
}

interface DemoModeState {
  isDemoMode: boolean;
}

// Synchronous reader of window.__PANKHA_CONFIG__, populated by
// /api/config/deployment.js before the React bundle executes (see index.html).
// If the boot script failed to load, defaults to isDemoMode=false (safe -
// all controls remain available; backend still enforces the demo lock).
export const useDemoMode = (): DemoModeState => {
  return { isDemoMode: window.__PANKHA_CONFIG__?.isDemoMode === true };
};

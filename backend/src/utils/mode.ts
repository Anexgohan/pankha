export const DEMO_MODE_LOCK_CODE = "DEMO_MODE_LOCKED";

export const getPankhaMode = (): string | null => {
  const mode = (process.env.PANKHA_MODE ?? "").trim().toLowerCase();
  return mode.length > 0 ? mode : null;
};

export const isDemoMode = (): boolean => getPankhaMode() === "demo";

export const createDemoLockResponse = (functionName: string) => ({
  locked: true,
  message: `${functionName} locked in demonstration`,
  code: DEMO_MODE_LOCK_CODE,
});

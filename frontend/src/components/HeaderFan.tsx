import React, { useEffect, useState } from 'react';
import { PankhaFanIcon } from './icons/PankhaFanIcon';

/**
 * HELPER: Simple parser for "30s", "10m" format
 */
const parseDuration = (str: string): number => {
  const value = parseInt(str);
  if (str.endsWith('m')) return value * 60 * 1000;
  if (str.endsWith('s')) return value * 1000;
  return value;
};

const RAW_CONFIG = {
  RAMP_UP: '45s',              // Time to accelerate from 0% to 100%
  PEAK: '15s',                 // Time to stay at 100% speed
  RAMP_DOWN: '45s',            // Time to decelerate from 100% to 0%
  IDLE: '15s',                 // Time to stay stopped before restarting
  MIN_DURATION_SEC: 0.3,       // MAX SPEED (Duration in seconds at 100% - smaller is faster)
  MAX_DURATION_SEC: 3.0,       // MIN SPEED (Duration in seconds at 1% - larger is slower)
  SIZE: 48                     // Fan icon size in pixels
};

const CONFIG = {
  RAMP_UP_MS: parseDuration(RAW_CONFIG.RAMP_UP),
  PEAK_MS: parseDuration(RAW_CONFIG.PEAK),
  RAMP_DOWN_MS: parseDuration(RAW_CONFIG.RAMP_DOWN),
  IDLE_MS: parseDuration(RAW_CONFIG.IDLE),
  MIN_DURATION_SEC: RAW_CONFIG.MIN_DURATION_SEC,
  MAX_DURATION_SEC: RAW_CONFIG.MAX_DURATION_SEC,
  SIZE: RAW_CONFIG.SIZE
};

const HeaderFan: React.FC = () => {
  const [speed, setSpeed] = useState(0); // 0 to 100

  // Total duration of one full animation cycle
  const TOTAL_CYCLE = CONFIG.RAMP_UP_MS + CONFIG.PEAK_MS + CONFIG.RAMP_DOWN_MS + CONFIG.IDLE_MS;

  useEffect(() => {
    const updateSpeed = () => {
      const now = Date.now();
      const cycleTime = now % TOTAL_CYCLE;
      let currentSpeed = 0;

      if (cycleTime < CONFIG.RAMP_UP_MS) {
        // Phase 1: Ramp Up (Ease-In-Ease-Out)
        const progress = cycleTime / CONFIG.RAMP_UP_MS;
        const eased = 0.5 - 0.5 * Math.cos(Math.PI * progress);
        currentSpeed = eased * 100;
      } else if (cycleTime < CONFIG.RAMP_UP_MS + CONFIG.PEAK_MS) {
        // Phase 2: Peak (Stay at 100%)
        currentSpeed = 100;
      } else if (cycleTime < CONFIG.RAMP_UP_MS + CONFIG.PEAK_MS + CONFIG.RAMP_DOWN_MS) {
        // Phase 3: Ramp Down (Ease-In-Ease-Out)
        const progress = (cycleTime - (CONFIG.RAMP_UP_MS + CONFIG.PEAK_MS)) / CONFIG.RAMP_DOWN_MS;
        const eased = 0.5 + 0.5 * Math.cos(Math.PI * progress);
        currentSpeed = eased * 100;
      } else {
        // Phase 4: Idle (Stay at 0%)
        currentSpeed = 0;
      }

      setSpeed(currentSpeed);
    };

    // Initialize speed immediately
    updateSpeed();

    // Update once every second - identical to how System Cards update.
    // This prevents the CSS animation jitter caused by 60fps duration resets.
    const intervalId = setInterval(updateSpeed, 1000);
    return () => clearInterval(intervalId);
  }, []);

  // Calculate duration using the original scaling logic but with CONFIG variables
  // Lower duration = faster rotation
  const duration = speed > 0 
    ? `${CONFIG.MAX_DURATION_SEC - (speed/100 * (CONFIG.MAX_DURATION_SEC - CONFIG.MIN_DURATION_SEC))}s` 
    : '0s';

  return (
    <div className="header-fan-container" style={{ display: 'inline-flex', marginLeft: '12px', verticalAlign: 'middle' }}>
      <PankhaFanIcon 
        size={CONFIG.SIZE} 
        className={speed > 0 ? "animate-fan-spin" : ""}
        style={{ 
          ['--spin-duration' as any]: duration,
          filter: 'drop-shadow(0 0 5px rgba(33, 150, 243, 0.3))' 
        }} 
      />
    </div>
  );
};

export default HeaderFan;

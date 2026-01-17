/**
 * HeaderFan - Decorative animated fan for the dashboard header
 *
 * IMPLEMENTATION NOTE:
 * This component uses the Web Animations API (element.animate + playbackRate)
 * instead of CSS animations with --spin-duration variable.
 *
 * WHY: CSS animation duration changes cause "jerk" - the browser recalculates
 * the animation position when duration changes, causing visible snapping.
 * Web Animations API's playbackRate scales time without resetting position.
 *
 * SIMPLER ALTERNATIVE (for static/rarely-changing speeds):
 * If you don't need smooth speed transitions, use CSS animation directly:
 *
 *   <PankhaFanIcon
 *     className={speed > 0 ? "animate-fan-spin" : ""}
 *     style={{ '--spin-duration': `${3 - (speed * 0.027)}s` }}
 *   />
 *
 * The CSS approach works fine when speed changes infrequently (e.g., hardware
 * fan RPM updates every few seconds). This component uses Web Animations
 * because its speed changes every second during the easing cycle.
 *
 * See also: AnimatedFanIcon.tsx - reusable wrapper for SystemCard fans
 */
import React, { useEffect, useRef } from 'react';
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
  MIN_DURATION_SEC: 0.75,       // MAX SPEED (Duration in seconds at 100% - smaller is faster)
  MAX_DURATION_SEC: 3.0,       // MIN SPEED (Duration in seconds at 1% - larger is slower)
  SIZE: 36                     // Fan icon size in pixels
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

// Total duration of one full animation cycle
const TOTAL_CYCLE_MS = CONFIG.RAMP_UP_MS + CONFIG.PEAK_MS + CONFIG.RAMP_DOWN_MS + CONFIG.IDLE_MS;

/**
 * Calculate current speed (0-100) based on cycle time using cosine easing
 */
const calculateSpeed = (cycleTime: number): number => {
  if (cycleTime < CONFIG.RAMP_UP_MS) {
    // Phase 1: Ramp Up (Ease-In-Ease-Out)
    const progress = cycleTime / CONFIG.RAMP_UP_MS;
    return (0.5 - 0.5 * Math.cos(Math.PI * progress)) * 100;
  } else if (cycleTime < CONFIG.RAMP_UP_MS + CONFIG.PEAK_MS) {
    // Phase 2: Peak (Stay at 100%)
    return 100;
  } else if (cycleTime < CONFIG.RAMP_UP_MS + CONFIG.PEAK_MS + CONFIG.RAMP_DOWN_MS) {
    // Phase 3: Ramp Down (Ease-In-Ease-Out)
    const progress = (cycleTime - (CONFIG.RAMP_UP_MS + CONFIG.PEAK_MS)) / CONFIG.RAMP_DOWN_MS;
    return (0.5 + 0.5 * Math.cos(Math.PI * progress)) * 100;
  }
  // Phase 4: Idle (Stay at 0%)
  return 0;
};

/**
 * Convert speed (0-100) to Web Animation playbackRate
 * Rate of 0 = paused, higher = faster rotation
 */
const speedToPlaybackRate = (speed: number): number => {
  if (speed <= 0) return 0;
  // Duration formula: MAX - (speed/100 * (MAX - MIN))
  // At speed=100: duration=0.3s, at speed=0: duration=3.0s
  const duration = CONFIG.MAX_DURATION_SEC - (speed / 100 * (CONFIG.MAX_DURATION_SEC - CONFIG.MIN_DURATION_SEC));
  // playbackRate = 1 / duration (normalized to 1s base animation)
  return 1 / duration;
};

/**
 * HeaderFan - Decorative animated fan icon for dashboard header
 *
 * Uses Web Animations API for smooth, jerk-free speed transitions.
 * Cycles through: Ramp Up → Peak → Ramp Down → Idle → Repeat
 *
 * Performance features:
 * - No React re-renders during animation (imperative playbackRate updates)
 * - Pauses when tab is hidden (visibilitychange)
 * - Respects prefers-reduced-motion accessibility setting
 */
const HeaderFan: React.FC = () => {
  const fanRef = useRef<SVGSVGElement>(null);
  const animationRef = useRef<Animation | null>(null);

  useEffect(() => {
    // Check for reduced motion preference
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) {
      // User prefers no animation - show static fan
      return;
    }

    const element = fanRef.current;
    if (!element) return;

    // Create the rotation animation once (base duration 1s, we control speed via playbackRate)
    animationRef.current = element.animate(
      [
        { transform: 'rotate(0deg)' },
        { transform: 'rotate(360deg)' }
      ],
      {
        duration: 1000,  // 1 second base duration
        iterations: Infinity,
        easing: 'linear'
      }
    );

    // Start paused, the interval will set the initial rate
    animationRef.current.playbackRate = 0;

    // Update playback rate based on easing cycle
    const updateAnimation = () => {
      if (!animationRef.current) return;

      const cycleTime = Date.now() % TOTAL_CYCLE_MS;
      const speed = calculateSpeed(cycleTime);
      const rate = speedToPlaybackRate(speed);

      animationRef.current.playbackRate = rate;
    };

    // Initialize immediately
    updateAnimation();

    // Update once per second (smooth enough for the easing curve, avoids overhead)
    const intervalId = setInterval(updateAnimation, 1000);

    // Pause animation when tab is hidden to save resources
    const handleVisibilityChange = () => {
      if (!animationRef.current) return;

      if (document.hidden) {
        animationRef.current.pause();
      } else {
        animationRef.current.play();
        // Re-sync playback rate after resuming
        updateAnimation();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Cleanup
    return () => {
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      animationRef.current?.cancel();
      animationRef.current = null;
    };
  }, []);

  return (
    <div
      className="header-fan-container"
      style={{
        display: 'inline-flex',
        marginLeft: '12px',
        verticalAlign: 'middle'
      }}
    >
      <PankhaFanIcon
        ref={fanRef}
        size={CONFIG.SIZE}
        style={{
          filter: 'drop-shadow(0 0 5px rgba(33, 150, 243, 0.3))'
        }}
      />
    </div>
  );
};

export default HeaderFan;

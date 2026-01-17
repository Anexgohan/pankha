/**
 * AnimatedFanIcon - Web Animations API wrapper for smooth fan rotation
 *
 * Use this component instead of PankhaFanIcon with CSS animation when you need
 * smooth speed transitions without jerk/snap artifacts.
 *
 * For simpler use cases where speed rarely changes, CSS animation works fine:
 *   <PankhaFanIcon className="animate-fan-spin" style={{ '--spin-duration': '1s' }} />
 */
import React, { useEffect, useRef, memo } from 'react';
import { PankhaFanIcon } from './PankhaFanIcon';

interface AnimatedFanIconProps {
  size?: number;
  speed: number;  // 0-100 (fan speed percentage)
  style?: React.CSSProperties;
}

/**
 * Duration boundaries for speed-to-rotation mapping.
 * These MUST match the CSS variables in sensors-fans.css:
 *   --spin-duration-min: 0.3s (fastest, 100% speed)
 *   --spin-duration-max: 3s   (slowest, near 0% speed)
 *
 * If you change these, also update sensors-fans.css for consistency.
 */
const MIN_DURATION_SEC = 0.3;  // Fastest (100% speed)
const MAX_DURATION_SEC = 3.0;  // Slowest (near 0% speed)

/**
 * Convert speed (0-100) to Web Animation playbackRate
 */
const speedToPlaybackRate = (speed: number): number => {
  if (speed <= 0) return 0;
  // Duration formula matches SystemCard's original: Math.max(0.3, 3 - (speed * 0.027))
  // Simplified: MAX - (speed/100 * (MAX - MIN))
  const duration = MAX_DURATION_SEC - (speed / 100 * (MAX_DURATION_SEC - MIN_DURATION_SEC));
  return 1 / duration;
};

/**
 * AnimatedFanIcon - Fan icon with smooth Web Animations API rotation
 *
 * Replaces the CSS animation approach to eliminate jerk/snap when speed changes.
 * Uses playbackRate for smooth speed transitions without resetting animation phase.
 *
 * Features:
 * - Jerk-free speed changes via Web Animations API
 * - Pauses when tab is hidden
 * - Respects prefers-reduced-motion
 * - Memoized to prevent unnecessary re-renders
 */
const AnimatedFanIcon: React.FC<AnimatedFanIconProps> = memo(({ size = 28, speed, style }) => {
  const fanRef = useRef<SVGSVGElement>(null);
  const animationRef = useRef<Animation | null>(null);
  const prefersReducedMotionRef = useRef<boolean>(false);

  // Initialize animation on mount
  useEffect(() => {
    prefersReducedMotionRef.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotionRef.current) {
      return; // No animation for users who prefer reduced motion
    }

    const element = fanRef.current;
    if (!element) return;

    // Create the rotation animation once
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

    // Set initial playback rate
    animationRef.current.playbackRate = speedToPlaybackRate(speed);

    // Handle visibility changes
    const handleVisibilityChange = () => {
      if (!animationRef.current) return;

      if (document.hidden) {
        animationRef.current.pause();
      } else {
        animationRef.current.play();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      animationRef.current?.cancel();
      animationRef.current = null;
    };
  }, []); // Only run on mount/unmount

  // Update playback rate when speed changes
  useEffect(() => {
    if (prefersReducedMotionRef.current || !animationRef.current) return;

    animationRef.current.playbackRate = speedToPlaybackRate(speed);
  }, [speed]);

  return (
    <PankhaFanIcon
      ref={fanRef}
      size={size}
      style={style}
    />
  );
});

AnimatedFanIcon.displayName = 'AnimatedFanIcon';

export default AnimatedFanIcon;

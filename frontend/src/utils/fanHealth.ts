/**
 * Fan health derivations for the Fan Info Card - pure functions, no React.
 * Verdict thresholds/hysteresis land here with the health engine (task 21 P3.5);
 * this stage covers curve math and display state derivation.
 */
import type { FanCalibrationDetail, FanCalibrationHistoryRun } from "../services/api";

export type CurvePoint = { duty: number; rpm: number };

/** Trend judgments need 1 base + 2 confirming runs; fewer is misleading. */
export const MIN_TREND_RUNS = 3;

/** Expected RPM at a duty, linearly interpolated from the calibration curve. */
export function expectedRpm(curve: CurvePoint[], duty: number): number | null {
  if (!curve || curve.length === 0) return null;
  const pts = [...curve].sort((a, b) => a.duty - b.duty);
  if (duty <= pts[0].duty) return pts[0].rpm;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (duty >= a.duty && duty <= b.duty) {
      if (b.duty === a.duty) return a.rpm;
      return a.rpm + ((b.rpm - a.rpm) * (duty - a.duty)) / (b.duty - a.duty);
    }
  }
  return pts[pts.length - 1].rpm;
}

/** Live drift vs the calibration curve, in percent (negative = slower). */
export function driftPercent(
  curve: CurvePoint[],
  duty: number,
  liveRpm: number
): { expected: number; drift: number } | null {
  const expected = expectedRpm(curve, duty);
  if (expected === null || expected === 0) return null;
  return { expected, drift: ((liveRpm - expected) / expected) * 100 };
}

/** Top-speed trend across history runs: earliest vs latest max_rpm. */
export function topSpeedTrend(
  history: FanCalibrationHistoryRun[]
): { first: number; latest: number; changePct: number } | null {
  const maxes = history
    .map((h) => (typeof h.result?.max_rpm === "number" ? (h.result.max_rpm as number) : null))
    .filter((v): v is number => v !== null && v > 0);
  if (maxes.length < 2) return null;
  // History arrives newest-first
  const latest = maxes[0];
  const first = maxes[maxes.length - 1];
  return { first, latest, changePct: ((latest - first) / first) * 100 };
}

/** Rounded human form of the settle time ("~1.5 s"). */
export function responseSeconds(cal: FanCalibrationDetail): number | null {
  const worst = Math.max(cal.spin_up_ms ?? 0, cal.spin_down_ms ?? 0);
  return worst > 0 ? Math.round(worst / 100) / 10 : null;
}

export type HealthVerdict = "healthy" | "no_data";

/**
 * Card-level verdict. This stage is deliberately binary: calibrated fans read
 * healthy, uncalibrated read no-data. Attention/problem tiers arrive with the
 * sustained-window health engine (P3.5).
 */
export function healthVerdict(cal: FanCalibrationDetail | null): HealthVerdict {
  return cal && cal.status === "done" ? "healthy" : "no_data";
}

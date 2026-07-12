/**
 * Calibration-curve math shared by the fan info endpoints and the
 * overperformance watchdog. Pure functions, no I/O.
 */
export type CurvePoint = { duty: number; rpm: number };

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

/**
 * Median drift (%) of observed samples vs the curve - the sustained form of
 * "running as expected" (no single-sample verdicts). Samples below minDuty are
 * skipped: inside the dead zone the expected value is not meaningful.
 */
export function medianDriftPct(
  curve: CurvePoint[],
  samples: { duty: number; rpm: number }[],
  minDuty: number
): { median: number; count: number } | null {
  const drifts: number[] = [];
  for (const s of samples) {
    if (s.duty < minDuty || s.rpm <= 0) continue;
    const exp = expectedRpm(curve, s.duty);
    if (exp === null || exp <= 0) continue;
    drifts.push(((s.rpm - exp) / exp) * 100);
  }
  if (drifts.length === 0) return null;
  drifts.sort((a, b) => a - b);
  const mid = Math.floor(drifts.length / 2);
  const median =
    drifts.length % 2 === 1 ? drifts[mid] : (drifts[mid - 1] + drifts[mid]) / 2;
  return { median, count: drifts.length };
}

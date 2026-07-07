/**
 * Post-run sanity gate: decides whether a calibration run is trustworthy
 * enough to raise the healthy reference. Failing runs still persist as the
 * current curve + history - fan control is never blocked by this gate.
 */
import type { CurvePoint } from "./fanCurve";

// Gate knobs. The monotonic check mirrors the in-run sweep guard tolerance -
// this is the independent recheck of what the one-pass re-measure accepted.
const MONO_MIN_DUTY = 50;        // pairs below this duty are dead-zone territory, skip
const MONO_TOLERANCE_PCT = 5;    // rpm may drop at most max(5%, 20 RPM)...
const MONO_TOLERANCE_RPM = 20;   // ...between consecutive sweep points
const PEAK_AT_FULL_RATIO = 0.95; // rpm at 100% duty must be >= 95% of the curve peak
const CEILING_FACTOR = 1.5;      // max_rpm may not exceed prior best x this

export interface SanityVerdict {
  pass: boolean;
  failedChecks: string[]; // stable keys for rejection counters
  reasons: string[];      // human detail for the DEBUG log + history row
}

/**
 * Gate a finished run. `priorBestMaxRpm` is the best max_rpm on record BEFORE
 * this run (null on a fan's first run - the ceiling check is skipped then).
 */
export function runSanityCheck(
  curve: CurvePoint[],
  maxRpm: number | null,
  priorBestMaxRpm: number | null
): SanityVerdict {
  const failedChecks: string[] = [];
  const reasons: string[] = [];
  const pts = [...curve].sort((a, b) => a.duty - b.duty);
  const checked = pts.filter((p) => p.duty >= MONO_MIN_DUTY);

  // Roughly monotonic above the dead zone
  for (let i = 0; i < checked.length - 1; i++) {
    const a = checked[i];
    const b = checked[i + 1];
    const tolerance = Math.max(a.rpm * (MONO_TOLERANCE_PCT / 100), MONO_TOLERANCE_RPM);
    if (b.rpm < a.rpm - tolerance) {
      failedChecks.push("monotonic");
      reasons.push(`curve not monotonic: ${a.duty}%=${a.rpm}rpm -> ${b.duty}%=${b.rpm}rpm`);
      break;
    }
  }

  // Peak must sit at full duty, not on a mid-sweep spike
  if (checked.length > 0) {
    const atFull = pts.find((p) => p.duty === 100);
    const peak = Math.max(...checked.map((p) => p.rpm));
    if (atFull && peak > 0 && atFull.rpm < peak * PEAK_AT_FULL_RATIO) {
      failedChecks.push("peak");
      reasons.push(`peak not at full duty: 100%=${atFull.rpm}rpm vs peak ${peak}rpm`);
    }
  }

  // Plausible ceiling vs prior runs
  if (
    maxRpm != null && priorBestMaxRpm != null && priorBestMaxRpm > 0 &&
    maxRpm > priorBestMaxRpm * CEILING_FACTOR
  ) {
    failedChecks.push("ceiling");
    reasons.push(`implausible ceiling: ${maxRpm}rpm > ${CEILING_FACTOR}x prior best ${priorBestMaxRpm}rpm`);
  }

  return { pass: failedChecks.length === 0, failedChecks, reasons };
}

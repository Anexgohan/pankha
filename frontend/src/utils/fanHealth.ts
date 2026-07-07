/**
 * Fan health engine for the Fan Info Card - pure functions, no React.
 *
 * Verdicts derive from the three-reference model: the LATEST curve answers
 * "changed since last measurement?" (sustained 10-min median drift from the
 * backend, never a single sample), the HEALTHY reference (best run on record)
 * answers "degraded vs its healthy self?", and history depth gates trends.
 */
import type { FanCalibrationDetail } from "../services/api";

export type CurvePoint = { duty: number; rpm: number };

// The facts the verdict needs - satisfied by both the info-card detail payload
// and the bulk snapshot entries, so card badge and panel share one engine.
export type HealthFacts = Pick<
  FanCalibrationDetail,
  | "status" | "drift_10m" | "drift_samples" | "max_rpm" | "healthy_max_rpm"
  | "spin_up_ms" | "healthy_spin_up_ms" | "healthy_low_confidence"
  | "stall_count" | "last_stall_at"
>;

// Verdict knobs - crossing WARN turns a line (and the chip) yellow, crossing
// CRIT turns it red. All values are percentages.
export const MIN_TREND_RUNS = 3; // calibrations needed before wear verdicts (1 base + 2 confirming)
export const DRIFT_WARN_PCT = 10; // live speed off the curve by more than this -> yellow
export const DRIFT_CRIT_PCT = 25; // -> red
export const TOP_DROP_WARN_PCT = 5; // latest top speed below the best on record -> yellow
export const TOP_DROP_CRIT_PCT = 15; // -> red
export const SPINUP_RISE_WARN_PCT = 30; // startup slower than the best on record -> wear co-signal

export type HealthState = "ok" | "wait" | "warn" | "crit";
export type HealthVerdict = "healthy" | "attention" | "problem" | "no_data";

export interface HealthLine {
  state: HealthState;
  text: string;
  tooltip: string;
}

export interface HealthReport {
  verdict: HealthVerdict;
  lines: HealthLine[];
}

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

/** Top speed vs the healthy reference (positive = current below best). */
export function topSpeedDrop(
  cal: HealthFacts
): { healthy: number; current: number; dropPct: number } | null {
  if (cal.max_rpm == null || cal.healthy_max_rpm == null || cal.healthy_max_rpm <= 0)
    return null;
  return {
    healthy: cal.healthy_max_rpm,
    current: cal.max_rpm,
    dropPct: ((cal.healthy_max_rpm - cal.max_rpm) / cal.healthy_max_rpm) * 100,
  };
}

/** Rounded human form of the settle time ("~1.5 s"). */
export function responseSeconds(cal: FanCalibrationDetail): number | null {
  const worst = Math.max(cal.spin_up_ms ?? 0, cal.spin_down_ms ?? 0);
  return worst > 0 ? Math.round(worst / 100) / 10 : null;
}

const plural = (n: number) => (n === 1 ? "" : "s");

/** Sentence 1: sustained running-vs-expected (10-min median from the backend). */
function runningLine(cal: HealthFacts): HealthLine {
  if (cal.drift_10m === null || cal.drift_samples === 0) {
    return {
      state: "wait",
      text: "Speed comparison: waiting for the fan to run a while.",
      tooltip:
        "Judged over the last 10 minutes of readings - the fan was stopped or below its starting speed",
    };
  }
  const d = cal.drift_10m;
  const abs = Math.abs(d);
  const dir = d < 0 ? "slower" : "faster";
  const tooltip = `Median of ${cal.drift_samples} readings over the last 10 minutes vs the calibration curve (${d > 0 ? "+" : ""}${d.toFixed(1)}%)`;
  if (abs <= DRIFT_WARN_PCT) {
    return {
      state: "ok",
      text: `Running ${abs.toFixed(1)}% ${dir} than expected - within the normal range.`,
      tooltip,
    };
  }
  if (abs <= DRIFT_CRIT_PCT) {
    return {
      state: "warn",
      text:
        d < 0
          ? `Running ${abs.toFixed(1)}% slower than expected - worth checking for dust.`
          : `Running ${abs.toFixed(1)}% faster than expected - recalibrating will refresh its baseline.`,
      tooltip,
    };
  }
  return {
    state: "crit",
    text:
      d < 0
        ? `Running ${abs.toFixed(1)}% slower than expected - check for an obstruction or failing fan.`
        : `Running ${abs.toFixed(1)}% faster than expected - recalibrate to re-measure this fan.`,
    tooltip,
  };
}

/** Sentence 2: top speed vs the healthy reference. */
function topSpeedLine(cal: HealthFacts, runs: number): HealthLine {
  const drop = topSpeedDrop(cal);
  if (!drop || runs < 2) {
    return {
      state: "wait",
      text: "Top speed trend: available after the next calibration.",
      tooltip: "Needs a second calibration to compare against",
    };
  }
  const conf = cal.healthy_low_confidence ? " - based on limited-confidence measurements" : "";
  const tooltip = `Best on record ${Math.round(drop.healthy)} RPM vs latest ${drop.current} RPM (${drop.dropPct > 0 ? "-" : "+"}${Math.abs(drop.dropPct).toFixed(1)}%)${conf}`;
  if (drop.dropPct <= TOP_DROP_WARN_PCT) {
    return { state: "ok", text: "Top speed is holding steady.", tooltip };
  }
  if (drop.dropPct <= TOP_DROP_CRIT_PCT) {
    return {
      state: "warn",
      text: `Top speed has dropped ${drop.dropPct.toFixed(1)}% - dust buildup is the usual cause.`,
      tooltip,
    };
  }
  return {
    state: "crit",
    text: "Top speed keeps falling - cleaning is overdue, bearings may be wearing out.",
    tooltip,
  };
}

/** Sentence 3: dust/wear inference (needs MIN_TREND_RUNS calibrations). */
function wearLine(cal: HealthFacts, runs: number): HealthLine {
  if (runs < MIN_TREND_RUNS) {
    const left = MIN_TREND_RUNS - runs;
    return {
      state: "wait",
      text: `Dust and wear check: available after ${left} more calibration${plural(left)}.`,
      tooltip: `Needs at least ${MIN_TREND_RUNS} calibrations to judge wear trends - this fan has ${runs}`,
    };
  }
  const drop = topSpeedDrop(cal);
  const spinRise =
    cal.spin_up_ms != null && cal.healthy_spin_up_ms != null && cal.healthy_spin_up_ms > 0
      ? ((cal.spin_up_ms - cal.healthy_spin_up_ms) / cal.healthy_spin_up_ms) * 100
      : null;
  const tooltip =
    "Inferred from top-speed and spin-up-time trends across calibrations - not a direct measurement";
  const topBad = drop ? drop.dropPct : 0;
  const spinBad = spinRise ?? 0;
  if (topBad > TOP_DROP_CRIT_PCT || (topBad > TOP_DROP_WARN_PCT && spinBad > SPINUP_RISE_WARN_PCT)) {
    return {
      state: "crit",
      text: "Strong signs of wear - clean the fan or plan a replacement.",
      tooltip,
    };
  }
  if (topBad > TOP_DROP_WARN_PCT || spinBad > SPINUP_RISE_WARN_PCT) {
    return {
      state: "warn",
      text: "Early signs of dust buildup or wear - consider cleaning the fan.",
      tooltip,
    };
  }
  return {
    state: "ok",
    text: "No signs of dust buildup or bearing wear.",
    tooltip,
  };
}

/** Sentence 4: unexpected stops (persisted stall log + live flag). */
function stopsLine(cal: HealthFacts, stalled: boolean): HealthLine {
  const count = cal.stall_count ?? 0;
  const last = cal.last_stall_at
    ? new Date(cal.last_stall_at).toLocaleString()
    : null;
  if (stalled) {
    return {
      state: "crit",
      text: "The fan is stopped while commanded to spin - check its cable or replace the fan.",
      tooltip: `Reporting 0 RPM while being told to run${count > 1 ? ` - ${count} stops on record` : ""}`,
    };
  }
  if (count > 0) {
    return {
      state: "warn",
      text: `The fan stopped ${count} time${plural(count)} unexpectedly - check its cable if it keeps happening.`,
      tooltip: `Last stop: ${last ?? "unknown"}. Clear resets the counter after you have fixed the cause.`,
    };
  }
  return {
    state: "ok",
    text: "No unexpected stops.",
    tooltip: "The fan has not reported no movement while being told to spin",
  };
}

const STATE_RANK: Record<HealthState, number> = { ok: 0, wait: 0, warn: 1, crit: 2 };

/** Full report: four sentences + the chip verdict (worst sentence wins). */
export function healthReport(
  cal: HealthFacts | null,
  runs: number,
  stalled: boolean
): HealthReport {
  if (!cal || cal.status !== "done") {
    return { verdict: "no_data", lines: [] };
  }
  const lines = [
    runningLine(cal),
    topSpeedLine(cal, runs),
    wearLine(cal, runs),
    stopsLine(cal, stalled),
  ];
  const worst = Math.max(...lines.map((l) => STATE_RANK[l.state]));
  const verdict: HealthVerdict =
    worst === 2 ? "problem" : worst === 1 ? "attention" : "healthy";
  return { verdict, lines };
}

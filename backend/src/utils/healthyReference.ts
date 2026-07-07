/**
 * Healthy reference: per-metric best across calibration history at the
 * current protocol, trusting only runs that passed the sanity gate.
 * Anti-deadlock: zero passing runs but >= 3 on record -> best of ALL runs,
 * flagged low-confidence, so health never deadlocks on a strict gate.
 */
import Database from "../database/database";
import { CALIBRATION_VERSION } from "../config/calibration";

const LOW_CONFIDENCE_MIN_RUNS = 3; // all-fail fallback needs this many runs

export interface HealthyReference {
  max_rpm: number;
  spin_up_ms: number;
  min_start: number;
  low_confidence: boolean;
}

const BEST_SELECT = `
  SELECT COUNT(*) AS runs,
         MAX((result->>'max_rpm')::numeric) AS max_rpm,
         MIN((result->>'spin_up_ms')::numeric) AS spin_up_ms,
         MIN((result->>'min_start')::numeric) AS min_start
  FROM fan_calibration_history
  WHERE fan_id = $1 AND calibration_version = $2`;

export async function getHealthyReference(
  db: Database,
  fanDbId: number
): Promise<HealthyReference | null> {
  // Sanity-passing runs only (rows predating the gate have no marker = trusted)
  const best = await db.get(
    `${BEST_SELECT} AND (result->>'sanity') IS DISTINCT FROM 'fail'`,
    [fanDbId, CALIBRATION_VERSION]
  );
  if (best?.max_rpm != null) {
    return {
      max_rpm: Number(best.max_rpm),
      spin_up_ms: Number(best.spin_up_ms),
      min_start: Number(best.min_start),
      low_confidence: false,
    };
  }

  // Anti-deadlock fallback over all runs, low-confidence marker set
  const all = await db.get(BEST_SELECT, [fanDbId, CALIBRATION_VERSION]);
  if (all?.max_rpm != null && Number(all.runs) >= LOW_CONFIDENCE_MIN_RUNS) {
    return {
      max_rpm: Number(all.max_rpm),
      spin_up_ms: Number(all.spin_up_ms),
      min_start: Number(all.min_start),
      low_confidence: true,
    };
  }
  return null;
}

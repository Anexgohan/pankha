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

export interface FanReferenceEntry {
  ref: HealthyReference | null;
  runs: number; // current-protocol runs on record (trend gates)
}

const BEST_SELECT = `
  SELECT fan_id, COUNT(*) AS runs,
         MAX((result->>'max_rpm')::numeric) AS max_rpm,
         MIN((result->>'spin_up_ms')::numeric) AS spin_up_ms,
         MIN((result->>'min_start')::numeric) AS min_start
  FROM fan_calibration_history
  WHERE fan_id = ANY($1::int[]) AND calibration_version = $2`;

/** Bulk lookup (one round trip per rule, grouped by fan). */
export async function getHealthyReferences(
  db: Database,
  fanDbIds: number[]
): Promise<Map<number, FanReferenceEntry>> {
  const out = new Map<number, FanReferenceEntry>();
  if (fanDbIds.length === 0) return out;

  // Sanity-passing runs only (rows predating the gate have no marker = trusted)
  const passing = await db.all(
    `${BEST_SELECT} AND (result->>'sanity') IS DISTINCT FROM 'fail' GROUP BY fan_id`,
    [fanDbIds, CALIBRATION_VERSION]
  );
  // All runs: run counts + the anti-deadlock fallback source
  const all = await db.all(`${BEST_SELECT} GROUP BY fan_id`, [fanDbIds, CALIBRATION_VERSION]);

  const toRef = (r: any, lowConfidence: boolean): HealthyReference => ({
    max_rpm: Number(r.max_rpm),
    spin_up_ms: Number(r.spin_up_ms),
    min_start: Number(r.min_start),
    low_confidence: lowConfidence,
  });
  const passingById = new Map(passing.map((r: any) => [r.fan_id, r]));

  for (const r of all) {
    const runs = Number(r.runs);
    const pass = passingById.get(r.fan_id);
    let ref: HealthyReference | null = null;
    if (pass?.max_rpm != null) {
      ref = toRef(pass, false);
    } else if (r.max_rpm != null && runs >= LOW_CONFIDENCE_MIN_RUNS) {
      ref = toRef(r, true);
    }
    out.set(r.fan_id, { ref, runs });
  }
  for (const id of fanDbIds) {
    if (!out.has(id)) out.set(id, { ref: null, runs: 0 });
  }
  return out;
}

export async function getHealthyReference(
  db: Database,
  fanDbId: number
): Promise<HealthyReference | null> {
  const entry = (await getHealthyReferences(db, [fanDbId])).get(fanDbId);
  return entry?.ref ?? null;
}

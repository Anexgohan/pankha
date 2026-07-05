import { EventEmitter } from "events";
import Database from "../database/database";
import { DataAggregator } from "./DataAggregator";
import { CommandDispatcher } from "./CommandDispatcher";
import { AgentManager } from "./AgentManager";
import { FanProfileController } from "./FanProfileController";
import { log } from "../utils/logger";
import { CALIBRATION_VERSION } from "../config/calibration";

// Calibration tuning (task 21 W2). Telemetry runs at 0.5s during a calibration.
const CALIBRATION_INTERVAL_S = 0.5;
// Phase-dependent safety: phase 1 keeps every fan spinning at 50-100% (adds
// airflow), so it only aborts at emergency_temp itself. The stall search
// (phase 2) stops fans, so it keeps the full margin below emergency_temp.
const STALL_SEARCH_MARGIN_C = 10;
const MAX_CONCURRENT_SYSTEMS = 3;        // cap parallel runs (telemetry/DB contention)
const SAMPLE_PERIOD_MS = 700;            // RPM poll cadence
const SETTLE_TIMEOUT_MS = 15000;         // max wait for RPM to stabilize per step
const SPINUP_TIMEOUT_MS = 8000;          // max wait for a fan to start spinning
const TELEMETRY_STALE_MS = 10000;        // abort when agent data stops flowing
const SAFE_HOLD_DUTY = 70;               // parked duty for fans awaiting their turn
const SWEEP_DUTIES = [100, 90, 80, 70, 60, 50];
const STALL_SEARCH_STEP = 5;
// Calibration hygiene: coasting rotors read tach-0 intermittently while still
// turning, which fakes low min_start values. Confirm stops with consecutive
// zero samples, then rest so the start search truly begins from standstill.
const STOP_CONFIRM_SAMPLES = 3;
const START_CONFIRM_SAMPLES = 2;
const MIN_REST_AFTER_STOP_MS = 3000;
const QUANT_PROBES: Array<[duty: number, step: number]> = [[51, 1], [52, 2], [55, 5]];
// Quiet period after an abort or a deferred run (read-only, control disabled,
// no telemetry) before auto-triggers may touch that agent again. Keeps an
// emergency stop from re-launching runs and keeps skip reasons to ONE log
// line per window instead of one per control tick.
const AGENT_SNOOZE_MS = 5 * 60_000;
// Collect sibling fans enqueued in the same control-loop pass so an agent
// calibrates as one batch (one run, one log line) instead of 1 + N-1.
const BATCH_COLLECT_MS = 2000;

// One calibration unit = one command target (zone_id for IPMI, fan_name for OS).
interface CalUnit {
  target: string;
  label: string;               // user-facing name (fan_label, or zone id for zones)
  fanDbIds: number[];          // member fan rows (zone: several; OS fan: one)
  memberNames: string[];       // fan_name of every member (FPC lockout keys)
  curve: Array<{ duty: number; rpm: number }>;
  maxRpm: number | null;
  minStart: number | null;
  minStop: number | null;
  minRpm: number | null;
  spinUpMs: number | null;
  spinDownMs: number | null;
  stepResolution: number | null;
}

// Aborts the whole system run; UnitFailed only fails one fan.
// retriable=true (infrastructure: agent gone, commands failing, user abort)
// -> units revert to 'pending' and auto-retry when conditions normalize.
// retriable=false (safety: temperature margin) -> 'failed', stamped with the
// attempt's protocol version: one automatic attempt per protocol, then manual.
class CalibrationAbort extends Error {
  constructor(message: string, public readonly retriable: boolean = true) {
    super(message);
  }
}
class UnitFailed extends Error {}

/**
 * Fan Calibration Service (task 21)
 *
 * Backend-orchestrated measurement of per-fan hardware facts: min_start,
 * min_stop, min/max RPM, spin up/down times, duty->RPM response curve, step
 * quantization, tach reliability. Agents stay dumb - everything runs through
 * the existing setFanSpeed / setUpdateInterval commands and RPM telemetry.
 *
 * Sequencing per system (hybrid, design D3):
 *   Phase 1 - parallel sweep 100->50 for all units (everything spinning, safe)
 *   Phase 2 - serial stall search, one unit at a time, others held at 70%
 * Systems calibrate concurrently (independent thermal domains).
 */
export class CalibrationService extends EventEmitter {
  private static instance: CalibrationService;
  private db: Database;
  private dataAggregator: DataAggregator;
  private commandDispatcher: CommandDispatcher;
  private agentManager: AgentManager;
  private fanProfileController: FanProfileController;

  private queues: Map<string, Set<number>> = new Map();  // agentId -> fan db ids
  private activeRuns: Set<string> = new Set();           // agentIds mid-run
  private pendingAgents: string[] = [];                  // FIFO awaiting a run slot
  private calibratingKeys: Set<string> = new Set();      // "agentId:target|fanName"
  private abortRequested: Set<string> = new Set();       // agentIds asked to abort
  private phaseMargins: Map<string, number> = new Map(); // agentId -> current safety margin C
  private snoozedUntil: Map<string, number> = new Map(); // agentId -> auto-trigger quiet period
  private started = false;

  private constructor() {
    super();
    this.db = Database.getInstance();
    this.dataAggregator = DataAggregator.getInstance();
    this.commandDispatcher = CommandDispatcher.getInstance();
    this.agentManager = AgentManager.getInstance();
    this.fanProfileController = FanProfileController.getInstance();
  }

  public static getInstance(): CalibrationService {
    if (!CalibrationService.instance) {
      CalibrationService.instance = new CalibrationService();
    }
    return CalibrationService.instance;
  }

  /**
   * Start the service: crash recovery + the consent-gated trigger.
   *
   * The only automatic trigger is FanProfileController's 'calibrationNeeded'
   * event, emitted from the control loop for ASSIGNED fans whose calibration
   * is missing or from an older protocol version. An active assignment is the
   * user's consent to control that fan - unassigned fans are never touched
   * automatically (manual rack-icon calibration remains available).
   */
  public start(): void {
    if (this.started) return;
    this.started = true;

    // Crash recovery: a backend restart mid-run orphans 'running' rows, which
    // no trigger would ever pick up again. A crashed run is an infrastructure
    // abort by definition -> 'pending', so it auto-retries when the agent is
    // live again.
    this.db.run(
      `UPDATE fan_calibrations SET status = 'pending' WHERE status = 'running'`
    ).then((r: any) => {
      if (r?.rowCount > 0) {
        log.warn(`Crash recovery: reset ${r.rowCount} orphaned 'running' calibration(s) to 'pending'`, "CalibrationService");
      }
    }).catch((e) => log.error("Calibration crash recovery failed", "CalibrationService", e));

    this.fanProfileController.on(
      "calibrationNeeded",
      (event: { agentId: string; fanDbId: number }) => {
        // Emitted every control tick until the run locks the fan - the queue
        // Set and activeRuns guard make re-entry free. Snooze keeps aborted or
        // deferred agents quiet for a while (manual enqueueFans bypasses it).
        const until = this.snoozedUntil.get(event.agentId);
        if (until && Date.now() < until) return;
        this.enqueue(event.agentId, [event.fanDbId]);
      }
    );

    log.info(
      `Calibration service started (protocol v${CALIBRATION_VERSION}, consent-gated triggers)`,
      "CalibrationService"
    );
  }

  /** True while `target` (fan_name or zone_id) is locked by a calibration run. */
  public isCalibrating(agentId: string, target: string): boolean {
    return this.calibratingKeys.has(`${agentId}:${target}`);
  }

  /** Request abort of every in-flight run (e.g. global emergency stop). */
  public abortAll(reason: string): void {
    if (this.activeRuns.size === 0) return;
    log.warn(`Aborting ${this.activeRuns.size} calibration run(s): ${reason}`, "CalibrationService");
    for (const agentId of this.activeRuns) this.abortRequested.add(agentId);
  }

  /** Manual (re)calibration trigger - queues regardless of current status. */
  public enqueueFans(agentId: string, fanDbIds: number[]): void {
    this.enqueue(agentId, fanDbIds);
  }

  private enqueue(agentId: string, fanDbIds: number[]): void {
    let queue = this.queues.get(agentId);
    if (!queue) {
      queue = new Set();
      this.queues.set(agentId, queue);
    }
    for (const id of fanDbIds) queue.add(id);
    this.kick(agentId);
  }

  // One run loop per agent; concurrent across agents up to the cap, the rest
  // wait in FIFO order (uncapped bursts starve the event loop and telemetry).
  private kick(agentId: string): void {
    if (this.activeRuns.has(agentId)) return;
    if (this.activeRuns.size >= MAX_CONCURRENT_SYSTEMS) {
      if (!this.pendingAgents.includes(agentId)) this.pendingAgents.push(agentId);
      return;
    }
    this.activeRuns.add(agentId);
    this.runAgentQueue(agentId)
      .catch((e) => log.error(`Calibration run failed for ${agentId}`, "CalibrationService", e))
      .finally(() => {
        this.activeRuns.delete(agentId);
        this.abortRequested.delete(agentId);
        const next = this.pendingAgents.shift();
        if (next) this.kick(next);
      });
  }

  private async runAgentQueue(agentId: string): Promise<void> {
    // Let the in-flight control tick finish enqueueing sibling fans first,
    // so the agent calibrates as one batch instead of 1 + the rest.
    await this.sleep(BATCH_COLLECT_MS);
    let queue = this.queues.get(agentId);
    while (queue && queue.size > 0) {
      const fanIds = [...queue];
      queue.clear();
      await this.runSystem(agentId, fanIds);
      queue = this.queues.get(agentId);
    }
    this.queues.delete(agentId);
  }

  /**
   * Calibrate one batch of fans on one system. Fail-closed: any safety trip
   * restores prior speeds + interval and marks unfinished fans 'failed'.
   */
  private async runSystem(agentId: string, fanDbIds: number[]): Promise<void> {
    // Deferral guards. Each snoozes the agent so the reason is logged ONCE per
    // window, not once per control tick (the loop re-emits until calibrated).
    // Over-limit (read-only) agents must not be controlled - license honesty.
    if (await this.agentManager.isAgentReadOnly(agentId)) {
      this.snooze(agentId, "agent is read-only (over agent limit)");
      return;
    }
    // Fan control disabled agent-side means our commands are ignored - defer.
    if (!this.agentManager.getAgentEnableFanControl(agentId)) {
      this.snooze(agentId, "fan control disabled");
      return;
    }
    // Pre-flight: never touch statuses unless the agent is LIVE. DB 'online'
    // status is stale at boot; launching into a not-yet-connected agent would
    // poison every row with a bogus failure.
    const preflight = this.dataAggregator.getSystemData(agentId);
    if (!preflight ||
        Date.now() - new Date(preflight.lastUpdate).getTime() > TELEMETRY_STALE_MS) {
      this.snooze(agentId, "no live telemetry");
      return;
    }

    const fans = await this.db.all(
      `SELECT f.id, f.fan_name, f.fan_label, f.zone_id, f.system_id, s.name AS system_name
       FROM fans f JOIN systems s ON f.system_id = s.id
       WHERE s.agent_id = $1 AND f.id = ANY($2) AND f.is_controllable = TRUE`,
      [agentId, fanDbIds]
    );
    if (fans.length === 0) return;
    const systemId: number = fans[0].system_id;
    const systemName: string = fans[0].system_name;

    // Group into units by command target (the zone is the atomic control unit)
    const units = new Map<string, CalUnit>();
    for (const f of fans) {
      const target = f.zone_id || f.fan_name;
      let unit = units.get(target);
      if (!unit) {
        unit = {
          target, label: f.zone_id || f.fan_label || f.fan_name,
          fanDbIds: [], memberNames: [], curve: [],
          maxRpm: null, minStart: null, minStop: null, minRpm: null,
          spinUpMs: null, spinDownMs: null, stepResolution: null,
        };
        units.set(target, unit);
      }
      unit.fanDbIds.push(f.id);
      unit.memberNames.push(f.fan_name);
    }

    // Snapshot prior state for restore
    const priorInterval = this.agentManager.getAgentUpdateInterval(agentId);
    const priorSpeeds = new Map<string, number>();
    for (const u of units.values()) {
      priorSpeeds.set(u.target, this.telemetry(agentId, u.target)?.speed ?? SAFE_HOLD_DUTY);
    }

    let active = [...units.values()];
    const finished = new Set<CalUnit>();
    log.info(
      `Calibrating ${active.map((u) => `"${u.label}"`).join(", ")} on ${systemName} (${agentId})`,
      "CalibrationService"
    );

    try {
      // Lock out FPC + manual control, mark running
      for (const u of active) {
        this.lockUnit(agentId, u, true);
        await this.setStatus(u.fanDbIds, "running");
        this.emitStatus(agentId, systemId, u, "running", "preparing");
      }
      await this.commandDispatcher.setUpdateInterval(agentId, CALIBRATION_INTERVAL_S);

      // PHASE 1: parallel sweep (all units spinning - thermally safe, so the
      // watchdog only aborts at emergency_temp itself)
      this.phaseMargins.set(agentId, 0);
      for (const duty of SWEEP_DUTIES) {
        await this.setDutyAll(agentId, active, duty);
        const rpms = await this.settle(agentId, active.map((u) => u.target));
        for (const u of active) u.curve.push({ duty, rpm: rpms.get(u.target) ?? 0 });

        if (duty === 100) {
          // Tach check: no reading at full duty -> no usable tach (design D11)
          for (const u of [...active]) {
            const rpm = rpms.get(u.target) ?? 0;
            if (rpm <= 0) {
              log.warn(`Fan "${u.label}" on ${systemName} has no usable tach - marking no_tach`, "CalibrationService");
              await this.setStatus(u.fanDbIds, "no_tach", true);
              this.emitStatus(agentId, systemId, u, "no_tach", "complete");
              finished.add(u);
              active = active.filter((o) => o !== u);
            } else {
              u.maxRpm = rpm;
            }
          }
          if (active.length === 0) return; // finally-block restores state
        }
      }

      // Quantization probe vs the 50% baseline: smallest step that moves RPM
      for (const [duty, step] of QUANT_PROBES) {
        const unresolved = active.filter((u) => u.stepResolution === null);
        if (unresolved.length === 0) break;
        await this.setDutyAll(agentId, unresolved, duty);
        const rpms = await this.settle(agentId, unresolved.map((u) => u.target));
        for (const u of unresolved) {
          const base = u.curve.find((p) => p.duty === 50)?.rpm ?? 0;
          const rpm = rpms.get(u.target) ?? 0;
          if (Math.abs(rpm - base) > Math.max((u.maxRpm ?? 0) * 0.02, 15)) {
            u.stepResolution = step;
          }
        }
      }
      for (const u of active) u.stepResolution = u.stepResolution ?? 10;

      // PHASE 2: serial stall search - only one unit ever stopped (design D3).
      // Fans stop here, so the full safety margin below emergency_temp applies.
      this.phaseMargins.set(agentId, STALL_SEARCH_MARGIN_C);
      for (const u of active) {
        await this.setDutyAll(agentId, active.filter((o) => o !== u && !finished.has(o)), SAFE_HOLD_DUTY);
        try {
          await this.stallSearch(agentId, u);
          await this.persistDone(u, systemName);
          this.emitStatus(agentId, systemId, u, "done", "complete");
        } catch (e) {
          if (!(e instanceof UnitFailed)) throw e; // safety aborts bubble up
          log.warn(`Calibration failed for fan "${u.label}" on ${systemName}: ${e.message}`, "CalibrationService");
          await this.setStatus(u.fanDbIds, "failed", true); // stamp: one auto attempt per protocol
          this.emitStatus(agentId, systemId, u, "failed", "complete");
        }
        finished.add(u);
        await this.setDuty(agentId, u.target, SAFE_HOLD_DUTY); // park before next unit
      }

      log.info(`Calibration complete for ${systemName} (${agentId})`, "CalibrationService");
    } catch (e) {
      // Infra aborts (agent gone, commands failing, user abort) -> 'pending':
      // auto-retries when conditions normalize. Safety aborts -> 'failed'
      // stamped with this protocol version: one automatic attempt per
      // protocol, then manual-only.
      const reason = e instanceof Error ? e.message : String(e);
      const retriable = e instanceof CalibrationAbort ? e.retriable : true;
      const status = retriable ? "pending" : "failed";
      log.error(`Calibration aborted for ${systemName} (${agentId}) (${status}): ${reason}`, "CalibrationService");
      this.snoozedUntil.set(agentId, Date.now() + AGENT_SNOOZE_MS);
      for (const u of active) {
        if (finished.has(u)) continue;
        try {
          await this.setStatus(u.fanDbIds, status, !retriable);
          this.emitStatus(agentId, systemId, u, status, "aborted");
        } catch { /* keep restoring */ }
      }
    } finally {
      this.phaseMargins.delete(agentId);
      // Restore: prior speeds, prior interval, FPC control (fail-closed, best effort)
      for (const u of units.values()) {
        try {
          await this.restoreUnit(agentId, u, priorSpeeds.get(u.target) ?? SAFE_HOLD_DUTY);
        } catch { /* agent may be gone */ }
        this.lockUnit(agentId, u, false);
      }
      try {
        await this.commandDispatcher.setUpdateInterval(agentId, priorInterval);
      } catch { /* re-synced from stored config on next agent registration */ }
    }
  }

  /**
   * Hand a unit back after calibration. Driver-auto-capable fans (NVIDIA GPU)
   * with no active assignment go back to the driver's own curve - restoring a
   * fixed manual duty would strand them (nothing ever commands them again).
   * Assigned fans get their prior duty; FPC re-commands within one tick.
   */
  private async restoreUnit(agentId: string, u: CalUnit, priorSpeed: number): Promise<void> {
    // Linux NVML ids: nvidia_gpu<idx>_fan; Windows LHM ids: nvidiagpu_<idx>_...
    const driverAutoCapable = /^nvidia_?gpu/.test(u.target);
    if (driverAutoCapable) {
      const assigned = await this.db.get(
        `SELECT 1 FROM fan_profile_assignments WHERE fan_id = ANY($1) AND is_active = TRUE LIMIT 1`,
        [u.fanDbIds]
      );
      if (!assigned) {
        try {
          await this.commandDispatcher.restoreFanToAuto(agentId, u.target);
          log.info(`Fan "${u.label}" handed back to driver auto (no profile assigned)`, "CalibrationService");
          return;
        } catch (e) {
          // Older agents don't know the command - fall through to prior duty
          log.warn(`restoreFanToAuto not supported by ${agentId}, restoring prior duty`, "CalibrationService");
        }
      }
    }
    await this.setDuty(agentId, u.target, priorSpeed);
  }

  /**
   * Find min_stop (walk down from 50 until stall) and min_start (walk up from
   * 0 until spin), plus min_rpm, spin_down_ms, spin_up_ms for one unit.
   */
  private async stallSearch(agentId: string, u: CalUnit): Promise<void> {
    let prevDuty = 50;
    let prevRpm = u.curve.find((p) => p.duty === 50)?.rpm ?? 0;
    let stalled = false;

    // Downward: last duty with rpm > 0 is min_stop
    for (let duty = 50 - STALL_SEARCH_STEP; duty >= 0; duty -= STALL_SEARCH_STEP) {
      const t0 = Date.now();
      await this.setDuty(agentId, u.target, duty);
      const rpm = (await this.settle(agentId, [u.target])).get(u.target) ?? 0;
      if (rpm <= 0) {
        u.minStop = prevDuty;
        u.minRpm = prevRpm;
        u.spinDownMs = Date.now() - t0; // command-to-tach-0 at the stall step
        stalled = true;
        break;
      }
      u.curve.push({ duty, rpm });
      prevDuty = duty;
      prevRpm = rpm;
    }

    if (!stalled) {
      // Always-on fan (spins even at duty 0): no dead zone to compensate
      u.minStop = 0;
      u.minStart = 0;
      u.minRpm = prevRpm;
      u.spinUpMs = 0;
      u.spinDownMs = 0;
      return;
    }

    // Confirm a TRUE stop at 0 (consecutive zero samples), then let the rotor
    // rest - a coasting rotor restarts at duties a resting one never would.
    await this.setDuty(agentId, u.target, 0);
    await this.waitForRpm(agentId, u.target, (rpm) => rpm <= 0, SETTLE_TIMEOUT_MS,
      `fan ${u.target} still reports RPM after duty 0`, STOP_CONFIRM_SAMPLES);
    await this.rest(agentId, Math.max(2 * (u.spinDownMs ?? 0), MIN_REST_AFTER_STOP_MS));

    // Upward: first duty that spins the fan from standstill is min_start
    for (let duty = STALL_SEARCH_STEP; duty <= 100; duty += STALL_SEARCH_STEP) {
      const t0 = Date.now();
      await this.setDuty(agentId, u.target, duty);
      const spun = await this.tryWaitForRpm(
        agentId, u.target, (rpm) => rpm > 0, SPINUP_TIMEOUT_MS, START_CONFIRM_SAMPLES);
      if (spun) {
        u.minStart = duty;
        u.spinUpMs = Date.now() - t0;
        return;
      }
    }
    throw new UnitFailed(`did not start even at 100% duty`);
  }

  // ---- sampling helpers ----

  private telemetry(agentId: string, target: string) {
    return this.dataAggregator.getSystemData(agentId)?.fans
      ?.find((f) => f.id === target || f.zone === target);
  }

  /**
   * Wait until every target's RPM is stable (two consecutive samples within
   * max(5%, 20 rpm)), or timeout (last sample wins). Safety-checked each poll.
   */
  private async settle(agentId: string, targets: string[]): Promise<Map<string, number>> {
    const deadline = Date.now() + SETTLE_TIMEOUT_MS;
    const last = new Map<string, number>();
    const settled = new Map<string, number>();
    const pending = new Set(targets);

    while (pending.size > 0 && Date.now() < deadline) {
      await this.sleep(SAMPLE_PERIOD_MS);
      this.safetyCheck(agentId);
      for (const target of [...pending]) {
        const rpm = this.telemetry(agentId, target)?.rpm ?? 0;
        const prev = last.get(target);
        last.set(target, rpm);
        if (prev !== undefined && Math.abs(rpm - prev) <= Math.max(rpm * 0.05, 20)) {
          settled.set(target, rpm);
          pending.delete(target);
        }
      }
    }
    for (const target of pending) settled.set(target, last.get(target) ?? 0);
    return settled;
  }

  /** Poll until predicate matches; throws UnitFailed on timeout. */
  private async waitForRpm(
    agentId: string, target: string,
    predicate: (rpm: number) => boolean, timeoutMs: number, failMessage: string,
    consecutive: number = 1
  ): Promise<void> {
    if (!(await this.tryWaitForRpm(agentId, target, predicate, timeoutMs, consecutive))) {
      throw new UnitFailed(failMessage);
    }
  }

  /** Poll until predicate matches on `consecutive` samples in a row (noise guard). */
  private async tryWaitForRpm(
    agentId: string, target: string,
    predicate: (rpm: number) => boolean, timeoutMs: number,
    consecutive: number = 1
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    let hits = 0;
    while (Date.now() < deadline) {
      await this.sleep(SAMPLE_PERIOD_MS);
      this.safetyCheck(agentId);
      const rpm = this.telemetry(agentId, target)?.rpm ?? 0;
      if (predicate(rpm)) {
        hits++;
        if (hits >= consecutive) return true;
      } else {
        hits = 0;
      }
    }
    return false;
  }

  /** Safety-checked pause (rotor rest between tests). */
  private async rest(agentId: string, ms: number): Promise<void> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      await this.sleep(Math.min(SAMPLE_PERIOD_MS, deadline - Date.now()));
      this.safetyCheck(agentId);
    }
  }

  /** Fail-closed guard, run at every poll. Throws CalibrationAbort. */
  private safetyCheck(agentId: string): void {
    if (this.abortRequested.has(agentId)) {
      throw new CalibrationAbort("abort requested");
    }
    const data = this.dataAggregator.getSystemData(agentId);
    if (!data) throw new CalibrationAbort("no telemetry from agent");
    const age = Date.now() - new Date(data.lastUpdate).getTime();
    if (age > TELEMETRY_STALE_MS) {
      throw new CalibrationAbort(`telemetry stale (${Math.round(age / 1000)}s - agent offline?)`);
    }
    const emergencyTemp = this.agentManager.getAgentEmergencyTemp(agentId);
    // Phase-dependent margin: 0 while everything spins (phase 1), full margin
    // during the stall search. Conservative default if unset.
    const margin = this.phaseMargins.get(agentId) ?? STALL_SEARCH_MARGIN_C;
    const temps = (data.sensors ?? []).filter((s) => !s.isHidden).map((s) => s.temperature);
    if (temps.length > 0) {
      const maxTemp = Math.max(...temps);
      if (maxTemp >= emergencyTemp - margin) {
        // Safety abort: not retriable (a hot system would churn fans forever)
        throw new CalibrationAbort(
          `max temp ${maxTemp.toFixed(1)}C within ${margin}C of emergency ${emergencyTemp}C`,
          false
        );
      }
    }
  }

  // ---- command helpers ----

  private async setDuty(agentId: string, target: string, duty: number): Promise<void> {
    await this.commandDispatcher.setFanSpeed(agentId, target, duty, "normal");
  }

  private async setDutyAll(agentId: string, units: CalUnit[], duty: number): Promise<void> {
    for (const u of units) await this.setDuty(agentId, u.target, duty);
  }

  // ---- lockout + persistence + events ----

  /** Lock/unlock a unit: FPC skips it and manual control returns 409. */
  private lockUnit(agentId: string, u: CalUnit, locked: boolean): void {
    const keys = [u.target, ...u.memberNames];
    for (const key of keys) {
      const full = `${agentId}:${key}`;
      if (locked) this.calibratingKeys.add(full);
      else this.calibratingKeys.delete(full);
      this.fanProfileController.setFanCalibrating(agentId, key, locked);
    }
    if (!locked) {
      // Clean handoff: FPC reseeds from reported speed on its next tick
      this.fanProfileController.resetFanControlState(agentId, u.target);
    }
  }

  /**
   * Upsert lifecycle status. Terminal measurement statuses (no_tach) stamp the
   * protocol version; transient ones (running/failed) keep the old stamp so a
   * stale-version fan still recalibrates after a failed attempt is retried.
   */
  private async setStatus(fanDbIds: number[], status: string, stampVersion = false): Promise<void> {
    for (const fanId of fanDbIds) {
      if (stampVersion) {
        await this.db.run(
          `INSERT INTO fan_calibrations (fan_id, status, calibration_version)
           VALUES ($1, $2, $3)
           ON CONFLICT (fan_id) DO UPDATE SET status = $2, calibration_version = $3`,
          [fanId, status, CALIBRATION_VERSION]
        );
      } else {
        await this.db.run(
          `INSERT INTO fan_calibrations (fan_id, status) VALUES ($1, $2)
           ON CONFLICT (fan_id) DO UPDATE SET status = $2`,
          [fanId, status]
        );
      }
    }
  }

  /** Write measured values (current row per member fan) + one history snapshot each. */
  private async persistDone(u: CalUnit, systemName: string): Promise<void> {
    const result = {
      calibration_version: CALIBRATION_VERSION,
      min_start: u.minStart, min_stop: u.minStop, min_rpm: u.minRpm,
      max_rpm: u.maxRpm, spin_up_ms: u.spinUpMs, spin_down_ms: u.spinDownMs,
      step_resolution: u.stepResolution,
      response_curve: [...u.curve].sort((a, b) => a.duty - b.duty),
    };
    for (const fanId of u.fanDbIds) {
      await this.db.run(
        `INSERT INTO fan_calibrations
           (fan_id, status, min_start, min_stop, min_rpm, max_rpm, spin_up_ms,
            spin_down_ms, step_resolution, response_curve, calibration_version, calibrated_at)
         VALUES ($1, 'done', $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP)
         ON CONFLICT (fan_id) DO UPDATE SET
           status = 'done', min_start = EXCLUDED.min_start, min_stop = EXCLUDED.min_stop,
           min_rpm = EXCLUDED.min_rpm, max_rpm = EXCLUDED.max_rpm,
           spin_up_ms = EXCLUDED.spin_up_ms, spin_down_ms = EXCLUDED.spin_down_ms,
           step_resolution = EXCLUDED.step_resolution, response_curve = EXCLUDED.response_curve,
           calibration_version = EXCLUDED.calibration_version, calibrated_at = CURRENT_TIMESTAMP`,
        [fanId, u.minStart, u.minStop, u.minRpm, u.maxRpm, u.spinUpMs,
         u.spinDownMs, u.stepResolution, JSON.stringify(result.response_curve),
         CALIBRATION_VERSION]
      );
      // History from older protocol versions is not comparable - purge it so
      // trends only ever span one measurement methodology.
      await this.db.run(
        `DELETE FROM fan_calibration_history WHERE fan_id = $1 AND calibration_version < $2`,
        [fanId, CALIBRATION_VERSION]
      );
      await this.db.run(
        `INSERT INTO fan_calibration_history (fan_id, result, calibration_version) VALUES ($1, $2, $3)`,
        [fanId, JSON.stringify(result), CALIBRATION_VERSION]
      );
    }
    log.info(
      `Fan "${u.label}" (${u.target}) on ${systemName} calibrated: ` +
      `min_start=${u.minStart}% min_stop=${u.minStop}% ` +
      `rpm=${u.minRpm}-${u.maxRpm} spin_up=${u.spinUpMs}ms resolution=${u.stepResolution}%`,
      "CalibrationService"
    );
  }

  private emitStatus(
    agentId: string, systemId: number, u: CalUnit, status: string, phase: string
  ): void {
    this.emit("fanCalibrationStatus", {
      agentId, systemId, target: u.target, fanNames: u.memberNames, status, phase,
    });
  }

  /** Defer auto-calibration for an agent, logging the reason once per window. */
  private snooze(agentId: string, reason: string): void {
    this.snoozedUntil.set(agentId, Date.now() + AGENT_SNOOZE_MS);
    log.info(
      `Calibration deferred for ${agentId}: ${reason} (next automatic check in ${AGENT_SNOOZE_MS / 60000} min)`,
      "CalibrationService"
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

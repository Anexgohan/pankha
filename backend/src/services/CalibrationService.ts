import { EventEmitter } from "events";
import Database from "../database/database";
import { DataAggregator } from "./DataAggregator";
import { CommandDispatcher } from "./CommandDispatcher";
import { AgentManager } from "./AgentManager";
import { FanProfileController } from "./FanProfileController";
import { log } from "../utils/logger";

// Calibration tuning (task 21 W2). Telemetry runs at 0.5s during a calibration.
const CALIBRATION_INTERVAL_S = 0.5;
const SAFETY_MARGIN_C = 10;              // abort at emergency_temp - margin
const SAMPLE_PERIOD_MS = 700;            // RPM poll cadence
const SETTLE_TIMEOUT_MS = 15000;         // max wait for RPM to stabilize per step
const SPINUP_TIMEOUT_MS = 8000;          // max wait for a fan to start spinning
const TELEMETRY_STALE_MS = 10000;        // abort when agent data stops flowing
const SAFE_HOLD_DUTY = 70;               // parked duty for fans awaiting their turn
const SWEEP_DUTIES = [100, 90, 80, 70, 60, 50];
const STALL_SEARCH_STEP = 5;
const QUANT_PROBES: Array<[duty: number, step: number]> = [[51, 1], [52, 2], [55, 5]];
const REGISTRATION_ENQUEUE_DELAY_MS = 5000; // wait for first telemetry after register

// One calibration unit = one command target (zone_id for IPMI, fan_name for OS).
interface CalUnit {
  target: string;
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

// Aborts the whole system run (safety); UnitFailed only fails one fan.
class CalibrationAbort extends Error {}
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
  private calibratingKeys: Set<string> = new Set();      // "agentId:target|fanName"
  private abortRequested: Set<string> = new Set();       // agentIds asked to abort
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
   * Subscribe to the triggers: new fans (DataAggregator) and agent
   * registration (backfill for pre-existing uncalibrated fans, design D2).
   */
  public start(): void {
    if (this.started) return;
    this.started = true;

    this.dataAggregator.on("newFansDetected", (event: { agentId: string }) => {
      this.enqueueUncalibrated(event.agentId).catch((e) =>
        log.error("Failed to enqueue new fans for calibration", "CalibrationService", e));
    });

    this.agentManager.on("agentRegistered", (agent: { agentId: string }) => {
      // Delay so the first telemetry (fans + sensors) is in before we start
      setTimeout(() => {
        this.enqueueUncalibrated(agent.agentId).catch((e) =>
          log.error("Failed to enqueue fans on registration", "CalibrationService", e));
      }, REGISTRATION_ENQUEUE_DELAY_MS);
    });

    log.info("Calibration service started (auto-calibration active)", "CalibrationService");
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

  /** Queue every controllable fan of the agent that has no completed calibration. */
  public async enqueueUncalibrated(agentId: string): Promise<void> {
    const rows = await this.db.all(
      `SELECT f.id FROM fans f
       JOIN systems s ON f.system_id = s.id
       LEFT JOIN fan_calibrations cal ON cal.fan_id = f.id
       WHERE s.agent_id = $1 AND s.status = 'online'
         AND f.is_controllable = TRUE AND f.enabled = TRUE AND f.is_stale = FALSE
         AND (cal.id IS NULL OR cal.status IN ('pending', 'failed'))`,
      [agentId]
    );
    if (rows.length === 0) return;
    this.enqueue(agentId, rows.map((r) => r.id));
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

  // One run loop per agent; concurrent across agents.
  private kick(agentId: string): void {
    if (this.activeRuns.has(agentId)) return;
    this.activeRuns.add(agentId);
    this.runAgentQueue(agentId)
      .catch((e) => log.error(`Calibration run failed for ${agentId}`, "CalibrationService", e))
      .finally(() => {
        this.activeRuns.delete(agentId);
        this.abortRequested.delete(agentId);
      });
  }

  private async runAgentQueue(agentId: string): Promise<void> {
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
    // Over-limit (read-only) agents must not be controlled - license honesty.
    if (await this.agentManager.isAgentReadOnly(agentId)) {
      log.warn(`Skipping calibration for ${agentId}: agent is read-only (over agent limit)`, "CalibrationService");
      return;
    }
    // Fan control disabled agent-side means our commands are ignored - defer.
    if (!this.agentManager.getAgentEnableFanControl(agentId)) {
      log.warn(`Skipping calibration for ${agentId}: fan control disabled`, "CalibrationService");
      return;
    }

    const fans = await this.db.all(
      `SELECT f.id, f.fan_name, f.zone_id, f.system_id
       FROM fans f JOIN systems s ON f.system_id = s.id
       WHERE s.agent_id = $1 AND f.id = ANY($2) AND f.is_controllable = TRUE`,
      [agentId, fanDbIds]
    );
    if (fans.length === 0) return;
    const systemId: number = fans[0].system_id;

    // Group into units by command target (the zone is the atomic control unit)
    const units = new Map<string, CalUnit>();
    for (const f of fans) {
      const target = f.zone_id || f.fan_name;
      let unit = units.get(target);
      if (!unit) {
        unit = {
          target, fanDbIds: [], memberNames: [], curve: [],
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
      `Calibrating ${active.length} fan unit(s) on agent ${agentId} (${fans.length} fans)`,
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

      // PHASE 1: parallel sweep (all units spinning - thermally safe)
      for (const duty of SWEEP_DUTIES) {
        await this.setDutyAll(agentId, active, duty);
        const rpms = await this.settle(agentId, active.map((u) => u.target));
        for (const u of active) u.curve.push({ duty, rpm: rpms.get(u.target) ?? 0 });

        if (duty === 100) {
          // Tach check: no reading at full duty -> no usable tach (design D11)
          for (const u of [...active]) {
            const rpm = rpms.get(u.target) ?? 0;
            if (rpm <= 0) {
              log.warn(`Fan ${u.target} on ${agentId} has no usable tach - marking no_tach`, "CalibrationService");
              await this.setStatus(u.fanDbIds, "no_tach");
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

      // PHASE 2: serial stall search - only one unit ever stopped (design D3)
      for (const u of active) {
        await this.setDutyAll(agentId, active.filter((o) => o !== u && !finished.has(o)), SAFE_HOLD_DUTY);
        try {
          await this.stallSearch(agentId, u);
          await this.persistDone(u);
          this.emitStatus(agentId, systemId, u, "done", "complete");
        } catch (e) {
          if (!(e instanceof UnitFailed)) throw e; // safety aborts bubble up
          log.warn(`Calibration failed for fan ${u.target} on ${agentId}: ${e.message}`, "CalibrationService");
          await this.setStatus(u.fanDbIds, "failed");
          this.emitStatus(agentId, systemId, u, "failed", "complete");
        }
        finished.add(u);
        await this.setDuty(agentId, u.target, SAFE_HOLD_DUTY); // park before next unit
      }

      log.info(`Calibration complete for agent ${agentId}`, "CalibrationService");
    } catch (e) {
      // Safety abort: everything unfinished is failed (retried on next trigger)
      const reason = e instanceof Error ? e.message : String(e);
      log.error(`Calibration aborted for agent ${agentId}: ${reason}`, "CalibrationService");
      for (const u of active) {
        if (finished.has(u)) continue;
        try {
          await this.setStatus(u.fanDbIds, "failed");
          this.emitStatus(agentId, systemId, u, "failed", "aborted");
        } catch { /* keep restoring */ }
      }
    } finally {
      // Restore: prior speeds, prior interval, FPC control (fail-closed, best effort)
      for (const u of units.values()) {
        try {
          await this.setDuty(agentId, u.target, priorSpeeds.get(u.target) ?? SAFE_HOLD_DUTY);
        } catch { /* agent may be gone */ }
        this.lockUnit(agentId, u, false);
      }
      try {
        await this.commandDispatcher.setUpdateInterval(agentId, priorInterval);
      } catch { /* re-synced from stored config on next agent registration */ }
    }
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

    // Confirm fully stopped at 0 before the start search
    await this.setDuty(agentId, u.target, 0);
    await this.waitForRpm(agentId, u.target, (rpm) => rpm <= 0, SETTLE_TIMEOUT_MS,
      `fan ${u.target} still reports RPM after duty 0`);

    // Upward: first duty that spins the fan from standstill is min_start
    for (let duty = STALL_SEARCH_STEP; duty <= 100; duty += STALL_SEARCH_STEP) {
      const t0 = Date.now();
      await this.setDuty(agentId, u.target, duty);
      const spun = await this.tryWaitForRpm(agentId, u.target, (rpm) => rpm > 0, SPINUP_TIMEOUT_MS);
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
    predicate: (rpm: number) => boolean, timeoutMs: number, failMessage: string
  ): Promise<void> {
    if (!(await this.tryWaitForRpm(agentId, target, predicate, timeoutMs))) {
      throw new UnitFailed(failMessage);
    }
  }

  private async tryWaitForRpm(
    agentId: string, target: string,
    predicate: (rpm: number) => boolean, timeoutMs: number
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await this.sleep(SAMPLE_PERIOD_MS);
      this.safetyCheck(agentId);
      const rpm = this.telemetry(agentId, target)?.rpm ?? 0;
      if (predicate(rpm)) return true;
    }
    return false;
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
    const temps = (data.sensors ?? []).filter((s) => !s.isHidden).map((s) => s.temperature);
    if (temps.length > 0) {
      const maxTemp = Math.max(...temps);
      if (maxTemp >= emergencyTemp - SAFETY_MARGIN_C) {
        throw new CalibrationAbort(
          `max temp ${maxTemp.toFixed(1)}C within ${SAFETY_MARGIN_C}C of emergency ${emergencyTemp}C`
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

  private async setStatus(fanDbIds: number[], status: string): Promise<void> {
    for (const fanId of fanDbIds) {
      await this.db.run(
        `INSERT INTO fan_calibrations (fan_id, status) VALUES ($1, $2)
         ON CONFLICT (fan_id) DO UPDATE SET status = $2`,
        [fanId, status]
      );
    }
  }

  /** Write measured values (current row per member fan) + one history snapshot each. */
  private async persistDone(u: CalUnit): Promise<void> {
    const result = {
      min_start: u.minStart, min_stop: u.minStop, min_rpm: u.minRpm,
      max_rpm: u.maxRpm, spin_up_ms: u.spinUpMs, spin_down_ms: u.spinDownMs,
      step_resolution: u.stepResolution,
      response_curve: [...u.curve].sort((a, b) => a.duty - b.duty),
    };
    for (const fanId of u.fanDbIds) {
      await this.db.run(
        `INSERT INTO fan_calibrations
           (fan_id, status, min_start, min_stop, min_rpm, max_rpm, spin_up_ms,
            spin_down_ms, step_resolution, response_curve, calibrated_at)
         VALUES ($1, 'done', $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
         ON CONFLICT (fan_id) DO UPDATE SET
           status = 'done', min_start = EXCLUDED.min_start, min_stop = EXCLUDED.min_stop,
           min_rpm = EXCLUDED.min_rpm, max_rpm = EXCLUDED.max_rpm,
           spin_up_ms = EXCLUDED.spin_up_ms, spin_down_ms = EXCLUDED.spin_down_ms,
           step_resolution = EXCLUDED.step_resolution, response_curve = EXCLUDED.response_curve,
           calibrated_at = CURRENT_TIMESTAMP`,
        [fanId, u.minStart, u.minStop, u.minRpm, u.maxRpm, u.spinUpMs,
         u.spinDownMs, u.stepResolution, JSON.stringify(result.response_curve)]
      );
      await this.db.run(
        `INSERT INTO fan_calibration_history (fan_id, result) VALUES ($1, $2)`,
        [fanId, JSON.stringify(result)]
      );
    }
    log.info(
      `Fan ${u.target} calibrated: min_start=${u.minStart}% min_stop=${u.minStop}% ` +
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

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Fan Info Card - modal opened from the fan rack's info icon.
 *
 * Shell + section composition only: chart lives in FanResponseChart, health
 * math in utils/fanHealth. Chrome reuses the BulkEditPanel frame (backdrop,
 * header, sections, footer) via useContextualPanel; unmounted when closed.
 * Sections: Health -> Calibration -> Info -> How this works (collapsible).
 */
import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { FanReading } from "../../types/api";
import {
  getFanCalibration,
  getFanCalibrationHistory,
  clearFanStalls,
} from "../../services/api";
import type {
  FanCalibrationDetail,
  FanCalibrationHistoryRun,
} from "../../services/api";
import { useContextualPanel } from "../hooks/useContextualPanel";
import { toast } from "../../utils/toast";
import { copyTextToClipboard } from "../../utils/clipboard";
import {
  driftPercent,
  topSpeedDrop,
  responseSeconds,
  healthReport,
} from "../../utils/fanHealth";
import type { HealthState } from "../../utils/fanHealth";
import {
  X,
  Check,
  Info as InfoIcon,
  ChevronDown,
  Clock,
  TriangleAlert,
  CircleX,
} from "lucide-react";
import FanResponseChart from "./FanResponseChart";
import "../styles/bulk-edit-panel.css";
import "./FanInfoCard.css";

interface FanInfoCardProps {
  fan: FanReading;
  fanDisplayName: string;
  systemId: number;
  systemName: string;
  stalled: boolean;
  isOpen: boolean;
  anchorRect: DOMRect | null;
  onClose: () => void;
  // Lets the parent patch its calibrations snapshot (card badge source)
  // when the stall log is cleared here - keeps card and panel in agreement
  onStallsCleared?: (fanId: string) => void;
}

/** key/value row; every visible line carries a plain-language tooltip */
const Row: React.FC<{
  k: string;
  title: string;
  mono?: boolean;
  children: React.ReactNode;
}> = ({ k, title, mono, children }) => (
  <div className="fic-row" title={title}>
    <span className="fic-k">{k}</span>
    <span className={`fic-v${mono ? " fic-mono" : ""}`}>{children}</span>
  </div>
);

/** health sentence with a state icon */
const Sentence: React.FC<{
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}> = ({ icon, title, children }) => (
  <div className="fic-sent" title={title}>
    {icon}
    <span>{children}</span>
  </div>
);

const FanInfoCard: React.FC<FanInfoCardProps> = ({
  fan,
  fanDisplayName,
  systemId,
  systemName,
  stalled,
  isOpen,
  anchorRect,
  onClose,
  onStallsCleared,
}) => {
  const [cal, setCal] = useState<FanCalibrationDetail | null>(null);
  const [history, setHistory] = useState<FanCalibrationHistoryRun[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [howOpen, setHowOpen] = useState(false);
  const { isMobile, panelStyles, panelRef, contextual } = useContextualPanel(
    isOpen,
    anchorRect,
    onClose
  );

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoaded(false);
    setHowOpen(false);
    Promise.all([
      getFanCalibration(systemId, fan.id),
      getFanCalibrationHistory(systemId, fan.id),
    ])
      .then(([detail, runs]) => {
        if (cancelled) return;
        setCal(detail);
        setHistory(runs);
        setLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setCal(null);
        setHistory([]);
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, systemId, fan.id]);

  if (!isOpen) return null;

  const calibrated = loaded && cal?.status === "done";
  const runs = history.length;
  const report = healthReport(loaded ? cal : null, history.length, stalled);
  const curve = calibrated ? cal!.response_curve : null;
  const drift =
    calibrated && curve ? driftPercent(curve, fan.speed, fan.rpm) : null;
  const topDrop = calibrated && cal ? topSpeedDrop(cal) : null;
  const respS = calibrated && cal ? responseSeconds(cal) : null;
  // Dead zone floor: below max(min_start, min_stop) the fan cannot KEEP
  // running (start-transient artifacts can measure min_start below min_stop)
  const deadZoneEnd = calibrated
    ? Math.max(cal!.min_start ?? 0, cal!.min_stop ?? 0) || null
    : null;
  const calibratedDate = cal?.calibrated_at
    ? new Date(cal.calibrated_at).toLocaleDateString()
    : null;

  const CHIP: Record<string, { cls: string; label: string; title: string }> = {
    healthy: { cls: "ok", label: "Healthy", title: "All health checks passed" },
    attention: { cls: "warn", label: "Needs attention", title: "One check needs your attention" },
    problem: { cls: "crit", label: "Problem detected", title: "A check found a problem" },
    no_data: { cls: "none", label: "No data", title: "Health checks need calibration data" },
  };
  const chip = CHIP[report.verdict];

  const stateIcon = (state: HealthState) =>
    state === "ok" ? (
      <Check size={14} className="fic-ico-ok" />
    ) : state === "wait" ? (
      <Clock size={14} className="fic-ico-wait" />
    ) : state === "warn" ? (
      <TriangleAlert size={14} className="fic-ico-warn" />
    ) : (
      <CircleX size={14} className="fic-ico-crit" />
    );

  const dash = <>-</>;

  const handleClearStalls = async () => {
    try {
      await clearFanStalls(systemId, fan.id);
      toast.success("Stop counter cleared");
      // Outcome is known (backend deleted the rows) - patch in place instead
      // of refetching, and tell the parent so the card badge updates too
      setCal((c) => (c ? { ...c, stall_count: 0, last_stall_at: null } : c));
      onStallsCleared?.(fan.id);
    } catch {
      toast.error("Failed to clear the stop counter");
    }
  };

  // Copy All mirrors exactly the displayed fields (house rule)
  const handleCopyAll = async () => {
    const L: string[] = [];
    L.push(`Fan Info - ${fanDisplayName} (on ${systemName})`);
    L.push("");
    L.push(`Health: ${chip.label}`);
    if (calibrated) {
      for (const line of report.lines) L.push(`  ${line.text}`);
    } else {
      L.push("  Health checks unlock after the first calibration");
    }
    L.push("");
    L.push("Calibration:");
    L.push(`  Starts at: ${calibrated ? `${cal!.min_start}%` : "-"}`);
    L.push(`  Stops below: ${calibrated ? `${cal!.min_stop}%` : "-"}`);
    L.push(`  Slowest speed: ${calibrated ? `${cal!.min_rpm} RPM` : "-"}`);
    L.push(`  Top speed: ${calibrated ? `${cal!.max_rpm} RPM` : "-"}`);
    L.push(`  Calibration runs: ${runs || "-"}`);
    L.push(`  Time to start: ${calibrated ? `${cal!.spin_up_ms} ms` : "-"}`);
    L.push(`  Time to stop: ${calibrated ? `${cal!.spin_down_ms} ms` : "-"}`);
    L.push(`  Smallest step: ${calibrated ? `${cal!.step_resolution}%` : "-"}`);
    L.push(`  Calibrated: ${calibratedDate ?? "Never"}`);
    L.push(
      `  Protocol version: ${calibrated ? `v${cal!.calibration_version}` : "-"}`
    );
    L.push("");
    L.push("Info:");
    L.push(`  Name: ${fanDisplayName}`);
    L.push(`  Hardware ID: ${fan.id}`);
    L.push(`  Chip: ${fan.id.split("_")[0]}`);
    if (cal?.zone_id) L.push(`  Zone: ${cal.zone_id}`);
    L.push(`  Controllable: Yes`);
    L.push(`  Self reporting: ${fan.rpm > 0 || calibrated ? "Yes" : "No"}`);
    if (drift)
      L.push(
        `  Running as expected: ${fan.rpm} vs ~${Math.round(drift.expected)} RPM (${drift.drift.toFixed(1)}%)`
      );
    if (topDrop)
      L.push(
        `  Top speed over time: best ${Math.round(topDrop.healthy)} -> now ${topDrop.current} RPM (${topDrop.dropPct > 0 ? "-" : "+"}${Math.abs(topDrop.dropPct).toFixed(1)}%)`
      );
    if (respS !== null) L.push(`  Time to respond: ~${respS} s`);
    if (cal?.speed_min_24h !== null && cal?.speed_max_24h !== null)
      L.push(`  Speed range used (24h): ${cal!.speed_min_24h} - ${cal!.speed_max_24h}%`);
    L.push(`  Dead zone: ${deadZoneEnd ? `0 - ${deadZoneEnd}%` : "-"}`);
    L.push(
      `  Unexpected stops: ${
        stalled
          ? `${Math.max(cal?.stall_count ?? 0, 1)} (now)`
          : (cal?.stall_count ?? 0) > 0
            ? cal!.stall_count
            : "None"
      }`
    );
    if (await copyTextToClipboard(L.join("\n"))) {
      toast.success("Fan info copied to clipboard");
    } else {
      toast.error("Failed to copy to clipboard");
    }
  };

  const chartWidth = isMobile ? 336 : 386;

  return createPortal(
    <div className={`bulk-edit-modal-root ${contextual ? "contextual" : ""}`}>
      <div className="bulk-edit-backdrop" onClick={onClose} />
      <div
        className="bulk-edit-modal-container"
        onClick={(e) => e.stopPropagation()}
        style={panelStyles}
      >
        <div
          ref={panelRef}
          className={`bulk-edit-panel fic-panel ${isMobile ? "mobile" : "desktop"}`}
        >
          {isMobile && (
            <div className="bulk-edit-drag-handle">
              <div className="drag-indicator" />
            </div>
          )}

          <div className="bulk-edit-header">
            <div>
              <h3>Fan Info - {fanDisplayName}</h3>
              <div className="fic-sys">on {systemName}</div>
            </div>
            <button className="bulk-edit-close" onClick={onClose} aria-label="Close">
              <X size={20} />
            </button>
          </div>

          <div className="bulk-edit-content">
            {/* ---- Health ---- */}
            <div className="bulk-edit-section">
              <div className="fic-health-head">
                <h4 className="section-title">Health</h4>
                <span className={`fic-verdict-chip ${chip.cls}`} title={chip.title}>
                  {chip.label}
                </span>
              </div>
              {!calibrated ? (
                <Sentence
                  icon={<InfoIcon size={14} className="fic-ico-wait" />}
                  title="Start it from the gauge icon next to the fan card - it takes a couple of minutes"
                >
                  Health checks unlock after the first calibration.
                </Sentence>
              ) : (
                report.lines.map((line, i) => {
                  // Clear action rides the stops line (last) once there is a
                  // log to reset and the fan is not stalled right now
                  const isStops = i === report.lines.length - 1;
                  const showClear =
                    isStops && (cal?.stall_count ?? 0) > 0 && !stalled;
                  return (
                    <div className="fic-sent" key={i} title={line.tooltip}>
                      {stateIcon(line.state)}
                      <span className="fic-sent-text">{line.text}</span>
                      {showClear && (
                        <button
                          className="fic-clear"
                          type="button"
                          onClick={() => void handleClearStalls()}
                          title="Resets the stop counter - use after fixing the cause"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* ---- Calibration ---- */}
            <div className="bulk-edit-section">
              <h4 className="section-title">Calibration</h4>
              <div className="fic-grid">
                <div>
                  <Row k="Starts at" title="Lowest speed setting that reliably starts the fan from a standstill">
                    {calibrated ? <>{cal!.min_start}<span className="fic-unit">%</span></> : dash}
                  </Row>
                  <Row k="Stops below" title="Below this setting a spinning fan comes to a stop">
                    {calibrated ? <>{cal!.min_stop}<span className="fic-unit">%</span></> : dash}
                  </Row>
                  <Row k="Slowest speed" title="Measured at the lowest setting that keeps the fan spinning">
                    {calibrated ? <>{cal!.min_rpm}<span className="fic-unit">RPM</span></> : dash}
                  </Row>
                  <Row k="Top speed" title="Measured at the maximum setting">
                    {calibrated ? <>{cal!.max_rpm}<span className="fic-unit">RPM</span></> : dash}
                  </Row>
                  <Row k="Calibration runs" title="How many calibration runs back the health trends - more runs make them more reliable">
                    {runs > 0 ? runs : dash}
                  </Row>
                </div>
                <div>
                  <Row k="Time to start" title="How long the fan takes to spin up from a standstill">
                    {calibrated ? <>{cal!.spin_up_ms}<span className="fic-unit">ms</span></> : dash}
                  </Row>
                  <Row k="Time to stop" title="How long the fan keeps coasting after being switched off">
                    {calibrated ? <>{cal!.spin_down_ms}<span className="fic-unit">ms</span></> : dash}
                  </Row>
                  <Row k="Smallest step" title="Smallest speed change the fan actually responds to">
                    {calibrated ? <>{cal!.step_resolution}<span className="fic-unit">%</span></> : dash}
                  </Row>
                  <Row
                    k="Calibrated"
                    title={
                      calibrated
                        ? `When this fan was last measured (calibration v${cal!.calibration_version})`
                        : "This fan has not been calibrated yet"
                    }
                  >
                    {calibratedDate ?? "Never"}
                  </Row>
                  <Row k="Protocol version" title="The version of the measuring procedure used - newer versions measure more accurately">
                    {calibrated ? `v${cal!.calibration_version}` : dash}
                  </Row>
                </div>
              </div>
              <div className="fic-chart-wrap">
                <FanResponseChart
                  curve={curve}
                  deadZoneEnd={deadZoneEnd}
                  live={calibrated ? { duty: fan.speed, rpm: fan.rpm } : null}
                  width={chartWidth}
                />
                <div className="fic-chart-caption">
                  {calibrated
                    ? `Measured fan speed at each speed setting.${deadZoneEnd ? ` Shaded area: settings below ${deadZoneEnd}% cannot keep this fan running.` : ""} Green dot: where the fan is running right now.`
                    : "The response curve appears here after the first calibration."}
                </div>
              </div>
            </div>

            {/* ---- Info ---- */}
            <div className="bulk-edit-section">
              <h4 className="section-title">Info</h4>
              <Row k="Name" title="Your name for this fan - double-click the name on the fan card to change it">
                {fanDisplayName}
              </Row>
              <Row k="Hardware ID" title="How the system identifies this fan internally - fixed by the hardware" mono>
                {fan.id}
              </Row>
              <Row k="Chip" title="The motherboard chip this fan is wired to" mono>
                {fan.id.split("_")[0]}
              </Row>
              {cal?.zone_id && (
                <Row k="Zone" title="Fans in the same zone are controlled together as one unit" mono>
                  {cal.zone_id}
                </Row>
              )}
              <Row k="Controllable" title="Pankha Fan Control can change this fan's speed">
                <span className="fic-ok">Yes</span>
              </Row>
              <Row k="Self reporting" title="The fan has a tachometer wire and reports its true rotation speed">
                {fan.rpm > 0 || calibrated ? <span className="fic-ok">Yes</span> : "No"}
              </Row>
              <div className="fic-sublabel">Measurements</div>
              <Row k="Running as expected" title="Compares the fan's current speed to what its calibration predicts at this setting">
                {drift ? (
                  <>
                    {fan.rpm} vs ~{Math.round(drift.expected)} RPM{" "}
                    <span className="fic-unit">({drift.drift.toFixed(1)}%)</span>
                  </>
                ) : dash}
              </Row>
              <Row k="Top speed over time" title="The fan's best recorded top speed vs its latest - falling behind can mean dust buildup or worn bearings">
                {topDrop && runs >= 2 ? (
                  <>
                    {Math.round(topDrop.healthy)} &rarr; {topDrop.current} RPM{" "}
                    <span className="fic-unit">
                      ({topDrop.dropPct > 0 ? "-" : "+"}{Math.abs(topDrop.dropPct).toFixed(1)}%)
                    </span>
                  </>
                ) : dash}
              </Row>
              <Row k="Time to respond" title="Roughly how long this fan takes to settle after a speed change, measured during calibration">
                {respS !== null ? <>~{respS}<span className="fic-unit">s</span></> : dash}
              </Row>
              <Row k="Speed range used (24h)" title="Over the last 24 hours this fan was only ever set between these two speeds - it never went lower or higher">
                {cal && cal.speed_min_24h !== null && cal.speed_max_24h !== null ? (
                  <>{cal.speed_min_24h} - {cal.speed_max_24h}<span className="fic-unit">%</span></>
                ) : dash}
              </Row>
              <Row k="Dead zone" title="Speed settings in this range cannot keep the fan spinning - the control logic automatically jumps over them">
                {deadZoneEnd ? <>0 - {deadZoneEnd}<span className="fic-unit">%</span></> : dash}
              </Row>
              <Row k="Unexpected stops" title="Times the fan was told to spin but reported no movement - Clear in Health resets the counter">
                {stalled ? (
                  `${Math.max(cal?.stall_count ?? 0, 1)} (now)`
                ) : (cal?.stall_count ?? 0) > 0 ? (
                  cal!.stall_count
                ) : calibrated ? (
                  <span className="fic-ok">None</span>
                ) : dash}
              </Row>
            </div>

            {/* ---- How this works (collapsible) ---- */}
            <div className={`bulk-edit-section fic-how${howOpen ? " open" : ""}`}>
              <button
                className="fic-how-toggle"
                type="button"
                onClick={() => setHowOpen(!howOpen)}
              >
                <span className="section-title fic-how-title">How this works</span>
                <ChevronDown size={14} />
              </button>
              {howOpen && (
                <div className="fic-how-body">
                  <p className="fic-explain">
                    Calibration briefly takes over the fan and walks it through its
                    full speed range, measuring the speed it actually reaches at every
                    setting - including the lowest setting that starts it and the point
                    where it stops. Those measurements become this fan's{" "}
                    <b>baseline</b>: a record of how it performs when healthy. The run
                    takes a couple of minutes, and your fan settings resume right after.
                  </p>
                  <p className="fic-explain">
                    Health compares the fan today against that baseline. At the same
                    setting, a healthy fan reaches the same speed it did during
                    calibration - if it now spins noticeably slower, dust buildup or
                    worn bearings are the usual cause. Each new calibration adds a
                    snapshot, so gradual decline over time shows up too.
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="bulk-edit-footer">
            <button className="btn btn-secondary" onClick={handleCopyAll} type="button">
              Copy All
            </button>
            <button className="btn btn-primary" onClick={onClose} type="button">
              Close
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default FanInfoCard;

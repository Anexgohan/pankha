/**
 * FanItem - one fan inside a SystemCard.
 *
 * Mirrors SensorItem's structure: `fan-item-wrapper > fan-rack + fan-item`.
 * The rack (outside the card) carries the calibrate icon and the relocated
 * visibility toggle; the card keeps the identity block, single status badge
 * (calibrating > stalled > agent status) and the full-height speed gauge.
 *
 * Gauge geometry is parameterized by the measured fan-info height: stroke,
 * arrowheads and mask band keep fixed dimensions, only the radius moves.
 */
import React, { useLayoutEffect, useRef, useState } from "react";
import type { FanReading } from "../../types/api";
import type { FanCalibrationInfo } from "../../services/api";
import { InlineEdit } from "../../components/InlineEdit";
import AnimatedFanIcon from "../../components/icons/AnimatedFanIcon";
import { getFanDisplayName } from "../../utils/displayNames";
import { Gauge, Loader2 } from "lucide-react";
import "./FanItem.css";

type CalState = "pending" | "running" | "done" | "stale" | "failed" | "no_tach";

const CAL_TITLES: Record<CalState, string> = {
  pending:
    "Calibration pending - runs automatically when a profile is active, or click to start now",
  running: "Fan is calibrating, manual control is disabled until complete",
  done: "", // built dynamically with date + version
  stale:
    "Calibrated with an older protocol version - recalibrates automatically, or click to start now",
  failed: "Calibration failed (safety abort) - click to retry",
  no_tach: "No RPM feedback - calibration not possible",
};

interface FanItemProps {
  fan: FanReading;
  hidden: boolean;
  zoneMember?: boolean;
  rpmDecreasing: boolean;
  calibrating: boolean;
  stalled: boolean;
  calInfo?: FanCalibrationInfo;
  protocolVersion: number;
  /** offline / read-only license: calibrate trigger is blocked */
  controlsLocked: boolean;
  onSaveLabel: (newLabel: string) => Promise<void>;
  onToggleVisibility: () => void;
  onCalibrate: () => void;
  /** fan-controls rows (regular fans); zone members render none */
  children?: React.ReactNode;
}

const FanItem: React.FC<FanItemProps> = ({
  fan,
  hidden,
  zoneMember = false,
  rpmDecreasing,
  calibrating,
  stalled,
  calInfo,
  protocolVersion,
  controlsLocked,
  onSaveLabel,
  onToggleVisibility,
  onCalibrate,
  children,
}) => {
  // Gauge diameter = fan-info block height (min 60 = pre-V7 size)
  const infoRef = useRef<HTMLDivElement>(null);
  const [gaugeSize, setGaugeSize] = useState(60);
  useLayoutEffect(() => {
    const el = infoRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const h = Math.round(el.offsetHeight);
      setGaugeSize(h >= 60 ? h : 60);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Calibrate icon state; live WS flag wins over the REST snapshot
  const calState: CalState = calibrating
    ? "running"
    : !calInfo || calInfo.status === "pending"
      ? "pending"
      : calInfo.status === "done" && calInfo.version < protocolVersion
        ? "stale"
        : (calInfo.status as CalState);
  const canTrigger =
    !controlsLocked && calState !== "running" && calState !== "no_tach";
  const calTitle =
    calState === "done" && calInfo
      ? `Calibrated ${
          calInfo.calibrated_at
            ? new Date(calInfo.calibrated_at).toLocaleDateString()
            : ""
        } (v${calInfo.version}) - click to recalibrate`
      : CAL_TITLES[calState];

  // Speed gauge - live 60px geometry scaled by radius only
  const flowDir = fan.rpm === 0 ? "" : rpmDecreasing ? "ccw" : "cw";
  let speedClass: string;
  if (fan.speed > 95) speedClass = "critical";
  else if (fan.speed > 75) speedClass = "warning";
  else if (rpmDecreasing) speedClass = "caution";
  else speedClass = "normal";
  const ringColor = `var(--temp-${speedClass}-border)`;

  // 8px stroke (was 5px at the old 60px gauge) - arrowheads and mask band
  // derive from it so everything stays in registration at any diameter.
  const STROKE = 8;
  const halfH = STROKE / 2; // arrowhead radial half-height
  const halfW = STROKE * 0.6; // arrowhead tangential half-width (live ratio)
  const r = (gaugeSize - 2 * STROKE) / 2;
  const ctr = gaugeSize / 2;
  const circumference = 2 * Math.PI * r;
  const dashOffset = circumference * (1 - fan.speed / 100);
  const arrowPoints =
    flowDir === "cw"
      ? `${ctr - halfW},${ctr - r - halfH} ${ctr + halfW},${ctr - r} ${ctr - halfW},${ctr - r + halfH}`
      : `${ctr + halfW},${ctr - r - halfH} ${ctr - halfW},${ctr - r} ${ctr + halfW},${ctr - r + halfH}`;
  const flowMaskImage =
    `radial-gradient(circle at center, transparent ${r - halfH - 0.5}px, black ${r - halfH + 0.5}px, black ${r + halfH - 0.5}px, transparent ${r + halfH + 0.5}px), ` +
    `conic-gradient(from -90deg, black 0deg, black var(--arc-deg, 0deg), transparent var(--arc-deg, 0deg))`;

  // Exactly one badge: calibrating > stalled > agent status
  const badge = calibrating ? (
    <span
      className="status-indicator calibrating"
      title="Fan is calibrating, manual control is disabled until complete"
    >
      Calibrating
    </span>
  ) : stalled ? (
    <span
      className="status-indicator stalled"
      title="Commanded to spin but reporting 0 RPM - fan may be stuck, disconnected, or in need of recalibration"
    >
      Stalled
    </span>
  ) : (
    <span className={`status-indicator ${fan.status}`}>{fan.status}</span>
  );

  return (
    <div className="fan-item-wrapper">
      <div className="fan-rack">
        <button
          className={`rack-calibrate cal-${calState}`}
          onClick={canTrigger ? onCalibrate : undefined}
          disabled={!canTrigger}
          title={calTitle}
          aria-label="Calibrate fan"
        >
          {calState === "running" ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Gauge size={16} />
          )}
        </button>
        <button
          className="rack-visibility"
          onClick={onToggleVisibility}
          title={hidden ? "Show fan" : "Hide fan, Disables from Usage and Calculations"}
          aria-label={hidden ? "Show fan" : "Hide fan"}
        >
          {hidden ? (
            <img src="/icons/toggle-off-01.png" width={20} height={20} alt="Hidden" style={{ opacity: 0.65 }} />
          ) : (
            <img src="/icons/toggle-on-01.png" width={20} height={20} alt="Visible" style={{ opacity: 0.75 }} />
          )}
        </button>
      </div>

      <div
        className={`fan-item${zoneMember ? " zone-member" : ""}${hidden ? " fan-hidden" : ""}`}
      >
        <div
          className="fan-header"
          style={{ "--gauge-size": `${gaugeSize}px` } as React.CSSProperties}
        >
          <div className="fan-info" ref={infoRef}>
            <div className="fan-title">
              <span className="fan-icon">
                {/* Uses Web Animations API for jerk-free speed changes */}
                <AnimatedFanIcon size={28} speed={fan.speed} />
              </span>
              <div className="fan-name">
                <InlineEdit
                  value={getFanDisplayName(fan.id, fan.name, fan.label)}
                  hardwareId={fan.id}
                  onSave={onSaveLabel}
                  className="fan-name-edit"
                />
              </div>
            </div>
            <div className="fan-metrics">
              <span className="fan-rpm">{fan.rpm} RPM</span>
              {badge}
            </div>
          </div>

          <div className="speed-display">
            <div className="speed-circle">
              <svg width={gaugeSize} height={gaugeSize} className="speed-gauge">
                <circle
                  cx={ctr}
                  cy={ctr}
                  r={r}
                  fill="none"
                  className="speed-track"
                  strokeWidth={STROKE}
                />
                <circle
                  cx={ctr}
                  cy={ctr}
                  r={r}
                  fill="none"
                  stroke={ringColor}
                  strokeWidth={STROKE}
                  strokeDasharray={`${circumference}`}
                  strokeDashoffset={`${dashOffset}`}
                  transform={`rotate(-90 ${ctr} ${ctr})`}
                />
              </svg>
              {flowDir && (
                <div
                  className="speed-flow-mask"
                  style={
                    {
                      "--arc-deg": `${fan.speed * 3.6}deg`,
                      WebkitMaskImage: flowMaskImage,
                      maskImage: flowMaskImage,
                    } as React.CSSProperties
                  }
                >
                  <div className={`speed-flow-pattern flow-${flowDir}`}>
                    <svg viewBox={`0 0 ${gaugeSize} ${gaugeSize}`} width={gaugeSize} height={gaugeSize}>
                      {Array.from({ length: 16 }, (_, i) => (
                        <polygon
                          key={i}
                          points={arrowPoints}
                          fill="var(--speed-flow-color)"
                          opacity="0.35"
                          transform={`rotate(${i * 22.5}, ${ctr}, ${ctr})`}
                        />
                      ))}
                    </svg>
                  </div>
                </div>
              )}
              <span className="speed-value" style={{ color: ringColor }}>
                {fan.speed}%
              </span>
            </div>
          </div>
        </div>

        {children}
      </div>
    </div>
  );
};

export default FanItem;

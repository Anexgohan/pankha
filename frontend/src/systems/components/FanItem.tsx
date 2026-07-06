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
import React, { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { FanReading } from "../../types/api";
import type { FanCalibrationInfo } from "../../services/api";
import { InlineEdit } from "../../components/InlineEdit";
import AnimatedFanIcon from "../../components/icons/AnimatedFanIcon";
import { getFanDisplayName } from "../../utils/displayNames";
import { Gauge, Loader2 } from "lucide-react";
import "./FanItem.css";

// Gauge knobs - every dimension below derives from these numbers.
const GAUGE_FLOOR = 60; // minimum diameter (pre-redesign size)
const GAUGE_INSET = 20; // breathing room vs the header block
const STROKE = 6; // ring stroke; arrowheads and mask band follow it
const ARROW_RATIO = 0.6; // arrowhead tangential half-width per stroke px
const ARROW_SPIN_S = 10; // seconds per full arrow-pattern revolution
const TEXT_SIZE = 18; // % readout base px; multiplied by the user font-scale

/* Midpoint-anchored geometry: the SVG viewBox is centered on (0,0), so every
   element positions relative to the gauge center and only the radius moves. */
const gaugeGeometry = (size: number) => {
  const r = (size - 2 * STROKE) / 2;
  const halfH = STROKE / 2;
  const halfW = STROKE * ARROW_RATIO;
  return {
    size,
    r,
    circumference: 2 * Math.PI * r,
    viewBox: `${-size / 2} ${-size / 2} ${size} ${size}`,
    // arrowhead at 12 o'clock, tip pointing along the rotation direction
    arrowPoints: {
      cw: `${-halfW},${-r - halfH} ${halfW},${-r} ${-halfW},${-r + halfH}`,
      ccw: `${halfW},${-r - halfH} ${-halfW},${-r} ${halfW},${-r + halfH}`,
    },
    maskImage:
      `radial-gradient(circle at center, transparent ${r - halfH - 0.5}px, black ${r - halfH + 0.5}px, black ${r + halfH - 0.5}px, transparent ${r + halfH + 0.5}px), ` +
      `conic-gradient(from -90deg, black 0deg, black var(--arc-deg, 0deg), transparent var(--arc-deg, 0deg))`,
  };
};

type CalState = "pending" | "running" | "done" | "stale" | "failed" | "no_tach";

const CAL_TITLES: Record<CalState, string> = {
  pending:
    "Calibration pending - runs automatically when a profile is active, or click to start now",
  running: "Fan is calibrating, manual control is disabled until complete",
  done: "", // built dynamically with the date
  stale:
    "Calibration is outdated - it will rerun automatically, or click to start now",
  failed: "Calibration stopped early to keep temperatures safe - click to retry",
  no_tach: "This fan does not report its speed, so it cannot be calibrated",
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
  const [gaugeSize, setGaugeSize] = useState(GAUGE_FLOOR);
  useLayoutEffect(() => {
    const el = infoRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const h = Math.round(el.offsetHeight) - GAUGE_INSET;
      setGaugeSize(h >= GAUGE_FLOOR ? h : GAUGE_FLOOR);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
    // constants in deps: inert in prod, lets HMR re-measure on knob edits
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [GAUGE_FLOOR, GAUGE_INSET]);

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
        } - click to recalibrate`
      : CAL_TITLES[calState];

  // Speed gauge - geometry derives once per size, elements hang off the midpoint
  const flowDir = fan.rpm === 0 ? "" : rpmDecreasing ? "ccw" : "cw";
  let speedClass: string;
  if (fan.speed > 95) speedClass = "critical";
  else if (fan.speed > 75) speedClass = "warning";
  else if (rpmDecreasing) speedClass = "caution";
  else speedClass = "normal";
  const ringColor = `var(--temp-${speedClass}-border)`;

  const geo = useMemo(() => gaugeGeometry(gaugeSize), [gaugeSize]);
  const dashOffset = geo.circumference * (1 - fan.speed / 100);

  // One arrowhead in <defs>, 16 rotated <use> stamps; cached so React skips
  // re-diffing the pattern unless the size or direction changes. The id must
  // be instance-unique - <use href> resolves document-wide.
  const arrowId = useId();
  const arrowLayer = useMemo(() => {
    if (!flowDir) return null;
    return (
      <div
        className={`speed-flow-pattern flow-${flowDir}`}
        style={{ animationDuration: `${ARROW_SPIN_S}s` }}
      >
        <svg viewBox={geo.viewBox} width={geo.size} height={geo.size}>
          <defs>
            <polygon
              id={arrowId}
              points={geo.arrowPoints[flowDir]}
              fill="var(--speed-flow-color)"
              opacity="0.35"
            />
          </defs>
          {Array.from({ length: 16 }, (_, i) => (
            <use key={i} href={`#${arrowId}`} transform={`rotate(${i * 22.5})`} />
          ))}
        </svg>
      </div>
    );
  }, [geo, flowDir, arrowId]);

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
              <svg
                width={geo.size}
                height={geo.size}
                viewBox={geo.viewBox}
                className="speed-gauge"
              >
                <circle
                  r={geo.r}
                  fill="none"
                  className="speed-track"
                  strokeWidth={STROKE}
                />
                <circle
                  r={geo.r}
                  fill="none"
                  stroke={ringColor}
                  strokeWidth={STROKE}
                  strokeDasharray={`${geo.circumference}`}
                  strokeDashoffset={`${dashOffset}`}
                  transform="rotate(-90)"
                />
              </svg>
              {flowDir && (
                <div
                  className="speed-flow-mask"
                  style={
                    {
                      "--arc-deg": `${fan.speed * 3.6}deg`,
                      WebkitMaskImage: geo.maskImage,
                      maskImage: geo.maskImage,
                    } as React.CSSProperties
                  }
                >
                  {arrowLayer}
                </div>
              )}
              <span
                className="speed-value"
                style={{
                  color: ringColor,
                  fontSize: `calc(${TEXT_SIZE}px * var(--font-scale, 1))`,
                }}
              >
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

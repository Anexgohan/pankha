/**
 * Duty-to-RPM response chart for the Fan Info Card.
 *
 * Renders the calibration curve with the dead-zone band and, when live data is
 * supplied, the fan's current operating point: dashed drop-lines to both axes,
 * a pulsing dot, and a two-line value label that flips sides near the chart
 * edges. With no curve it renders the "Not calibrated yet" empty state.
 */
import React from "react";
import { expectedRpm, type CurvePoint } from "../../utils/fanHealth";

interface FanResponseChartProps {
  curve: CurvePoint[] | null;
  minStart: number | null;
  /** current operating point; omit to hide the live dot */
  live?: { duty: number; rpm: number } | null;
  width: number;
  height?: number;
}

const PAD_L = 34;
const PAD_R = 16; /* room for the centered "100%" x label */
const PAD_T = 10;
const PAD_B = 26;

/* y-axis step giving at most ~4 gridlines regardless of fan RPM ceiling */
const Y_STEPS = [100, 200, 500, 1000, 2000, 5000, 10000];
const yStepFor = (dataMax: number) =>
  Y_STEPS.find((s) => dataMax / s <= 4) ?? Y_STEPS[Y_STEPS.length - 1];

const FanResponseChart: React.FC<FanResponseChartProps> = ({
  curve,
  minStart,
  live,
  width,
  height = 180,
}) => {
  const iw = width - PAD_L - PAD_R;
  const ih = height - PAD_T - PAD_B;

  const empty = !curve || curve.length === 0;
  const dataMax = empty
    ? 1500
    : Math.max(...curve.map((p) => p.rpm), live?.rpm ?? 0, 1);
  const yStep = yStepFor(dataMax);
  const maxR = Math.max(yStep, Math.ceil(dataMax / yStep) * yStep);

  const x = (d: number) => PAD_L + (d / 100) * iw;
  const y = (r: number) => PAD_T + ih - (r / maxR) * ih;

  const gridRpms = Array.from({ length: maxR / yStep + 1 }, (_, i) => i * yStep);

  let liveEl: React.ReactNode = null;
  if (!empty && live) {
    const exp = expectedRpm(curve, live.duty);
    const drift = exp ? ((live.rpm - exp) / exp) * 100 : null;
    const driftTxt =
      drift === null ? "" : `${drift > 0 ? "+" : ""}${drift.toFixed(1)}%`;
    const lx = x(live.duty);
    const ly = y(live.rpm);
    // Flip the label to the left near the right edge
    const flip = live.duty > 65;
    const tx = flip ? lx - 7 : lx + 7;
    const anchor = flip ? "end" : "start";
    liveEl = (
      <>
        <line
          x1={lx} y1={ly} x2={lx} y2={PAD_T + ih}
          stroke="var(--color-success)" strokeWidth="1" strokeDasharray="3 3" opacity="0.55"
        />
        <line
          x1={PAD_L} y1={ly} x2={lx} y2={ly}
          stroke="var(--color-success)" strokeWidth="1" strokeDasharray="3 3" opacity="0.55"
        />
        <circle className="fic-live-ping" cx={lx} cy={ly} r="4" fill="none" stroke="var(--color-success)" />
        <circle cx={lx} cy={ly} r="4" fill="var(--color-success)" stroke="var(--bg-primary)" strokeWidth="1.5">
          <title>
            {drift === null
              ? `Running now: ${live.duty}% at ${live.rpm} RPM`
              : `Running now: ${live.duty}% at ${live.rpm} RPM - drifting ${driftTxt} from the expected ${Math.round(exp!)} RPM`}
          </title>
        </circle>
        <text x={tx} y={ly + 21} textAnchor={anchor} fontSize="12" fontWeight="600" fill="var(--color-success)">
          {live.duty}% at {live.rpm} RPM
          {drift !== null && (
            <tspan x={tx} dy="14">{driftTxt} drift</tspan>
          )}
        </text>
      </>
    );
  }

  return (
    <svg className="fic-chart" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {/* grid + axis labels; unlabeled half-step lines double the resolution */}
      {gridRpms.map((r) => (
        <React.Fragment key={r}>
          <line x1={PAD_L} y1={y(r)} x2={width - PAD_R} y2={y(r)} stroke="var(--border-color)" strokeWidth="1" />
          <text x={PAD_L - 6} y={y(r) + 3} textAnchor="end" fontSize="9.5" fill="var(--text-tertiary)">{r}</text>
          {r + yStep / 2 < maxR && (
            <line x1={PAD_L} y1={y(r + yStep / 2)} x2={width - PAD_R} y2={y(r + yStep / 2)} stroke="var(--border-color)" strokeWidth="1" opacity="0.45" />
          )}
        </React.Fragment>
      ))}
      {[0, 25, 50, 75, 100].map((d) => (
        <text key={d} x={x(d)} y={height - 8} textAnchor="middle" fontSize="9.5" fill="var(--text-tertiary)">{d}%</text>
      ))}

      {empty ? (
        <text
          x={PAD_L + iw / 2} y={PAD_T + ih / 2 + 8}
          textAnchor="middle" fontSize="22" fontWeight="600" fill="var(--text-tertiary)"
        >
          Not calibrated yet
        </text>
      ) : (
        <>
          {/* dead zone: settings below min_start cannot start the fan */}
          {minStart !== null && minStart > 0 && (
            <>
              <rect x={x(0)} y={PAD_T} width={x(minStart) - x(0)} height={ih} fill="var(--temp-caution-text)" opacity="0.08" />
              <line x1={x(minStart)} y1={PAD_T} x2={x(minStart)} y2={PAD_T + ih} stroke="var(--temp-caution-text)" strokeWidth="1" strokeDasharray="3 3" opacity="0.6" />
            </>
          )}
          <polyline
            points={curve.map((p) => `${x(p.duty)},${y(p.rpm)}`).join(" ")}
            fill="none" stroke="var(--color-info)" strokeWidth="2" strokeLinejoin="round"
          />
          {curve.map((p) => (
            <circle key={p.duty} cx={x(p.duty)} cy={y(p.rpm)} r="2.5" fill="var(--color-info)">
              <title>{p.duty}% - {p.rpm} RPM</title>
            </circle>
          ))}
          {liveEl}
        </>
      )}
    </svg>
  );
};

export default FanResponseChart;

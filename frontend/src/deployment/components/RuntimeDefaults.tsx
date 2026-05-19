import React from 'react';
import { uiOptions, getOption, interpolateTooltip } from '../../utils/uiOptions';

export type LogLevel = 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

interface RuntimeDefaultsProps {
  stepNumber: number;
  logLevel: LogLevel;
  onLogLevelChange: (v: LogLevel) => void;
  emergency: string;
  onEmergencyChange: (v: string) => void;
  failsafe: string;
  onFailsafeChange: (v: string) => void;
  agentRate: string;
  onAgentRateChange: (v: string) => void;
  fanStep: string;
  onFanStepChange: (v: string) => void;
  hysteresis: string;
  onHysteresisChange: (v: string) => void;
}

const RuntimeDefaults: React.FC<RuntimeDefaultsProps> = React.memo(({
  stepNumber,
  logLevel,
  onLogLevelChange,
  emergency,
  onEmergencyChange,
  failsafe,
  onFailsafeChange,
  agentRate,
  onAgentRateChange,
  fanStep,
  onFanStepChange,
  hysteresis,
  onHysteresisChange,
}) => {
  const tooltipContext = {
    logLevel,
    emergencyTemp: emergency,
    failsafeSpeed: failsafe,
    agentInterval: agentRate,
    fanStep,
    hysteresis,
  };

  // Full tooltip (multi-line, used as hover title)
  const logLevelTooltip = interpolateTooltip(getOption('logLevel').tooltip, tooltipContext);
  const emergencyTooltip = interpolateTooltip(getOption('emergencyTemp').tooltip, tooltipContext);
  const failsafeTooltip = interpolateTooltip(getOption('failsafeSpeed').tooltip, tooltipContext);
  const agentRateTooltip = interpolateTooltip(getOption('updateInterval').tooltip, tooltipContext);
  const fanStepTooltip = interpolateTooltip(getOption('fanStep').tooltip, tooltipContext);
  const hysteresisTooltip = interpolateTooltip(getOption('hysteresis').tooltip, tooltipContext);

  // Visible one-liner hint (first line of tooltip)
  const firstLine = (text: string) => (text || '').split('\n')[0];
  const logLevelHint = firstLine(logLevelTooltip);
  const emergencyHint = firstLine(emergencyTooltip);
  const failsafeHint = firstLine(failsafeTooltip);
  const agentRateHint = firstLine(agentRateTooltip);
  const fanStepHint = firstLine(fanStepTooltip);
  const hysteresisHint = firstLine(hysteresisTooltip);

  return (
    <section className="deployment-section step-block">
      <div className="step-header">
        <div className="step-number active">{stepNumber}</div>
        <div className="step-text">
          <div className="step-title">Runtime defaults</div>
          <div className="step-hint">Baked into the agent's config when the script runs.</div>
        </div>
      </div>

      <div className="builder-main-grid">
        <div className="builder-group" title={logLevelTooltip}>
          <span className="builder-label">{uiOptions.options.logLevel.label}</span>
          <div className="toggle-presets">
            {uiOptions.options.logLevel.values.map(opt => (
              <button
                key={String(opt.value)}
                type="button"
                className={`toggle-item ${logLevel === opt.value ? 'active' : ''}`}
                onClick={() => onLogLevelChange(opt.value as LogLevel)}
              >
                {opt.cleanLabel || opt.label}
              </button>
            ))}
          </div>
          <div className="field-hint">{logLevelHint}</div>
        </div>

        <div className="builder-group" title={emergencyTooltip}>
          <span className="builder-label">{uiOptions.options.emergencyTemp.label}</span>
          <div className="toggle-presets">
            {uiOptions.options.emergencyTemp.values.map(opt => (
              <button
                key={String(opt.value)}
                type="button"
                className={`toggle-item ${emergency === String(opt.value) ? 'active' : ''}`}
                onClick={() => onEmergencyChange(String(opt.value))}
              >
                {opt.cleanLabel || opt.label}
              </button>
            ))}
          </div>
          <div className="field-hint">{emergencyHint}</div>
        </div>

        <div className="builder-group" title={failsafeTooltip}>
          <span className="builder-label">{uiOptions.options.failsafeSpeed.label}</span>
          <div className="toggle-presets">
            {uiOptions.options.failsafeSpeed.values.map(opt => (
              <button
                key={String(opt.value)}
                type="button"
                className={`toggle-item ${failsafe === String(opt.value) ? 'active' : ''}`}
                onClick={() => onFailsafeChange(String(opt.value))}
              >
                {opt.cleanLabel || opt.label}
              </button>
            ))}
          </div>
          <div className="field-hint">{failsafeHint}</div>
        </div>

        <div className="builder-group" title={agentRateTooltip}>
          <span className="builder-label">{uiOptions.options.updateInterval.label}</span>
          <div className="toggle-presets">
            {uiOptions.options.updateInterval.values.map(opt => (
              <button
                key={String(opt.value)}
                type="button"
                className={`toggle-item ${agentRate === String(opt.value) ? 'active' : ''}`}
                onClick={() => onAgentRateChange(String(opt.value))}
              >
                {opt.cleanLabel || opt.label}
              </button>
            ))}
          </div>
          <div className="field-hint">{agentRateHint}</div>
        </div>

        <div className="builder-group" title={fanStepTooltip}>
          <span className="builder-label">{uiOptions.options.fanStep.label}</span>
          <div className="toggle-presets">
            {uiOptions.options.fanStep.values.map(opt => (
              <button
                key={String(opt.value)}
                type="button"
                className={`toggle-item ${fanStep === String(opt.value) ? 'active' : ''}`}
                onClick={() => onFanStepChange(String(opt.value))}
              >
                {opt.cleanLabel || opt.label}
              </button>
            ))}
          </div>
          <div className="field-hint">{fanStepHint}</div>
        </div>

        <div className="builder-group" title={hysteresisTooltip}>
          <span className="builder-label">{uiOptions.options.hysteresis.label}</span>
          <div className="toggle-presets">
            {uiOptions.options.hysteresis.values.map(opt => (
              <button
                key={String(opt.value)}
                type="button"
                className={`toggle-item ${hysteresis === String(opt.value) ? 'active' : ''}`}
                onClick={() => onHysteresisChange(String(opt.value))}
              >
                {opt.cleanLabel || opt.label}
              </button>
            ))}
          </div>
          <div className="field-hint">{hysteresisHint}</div>
        </div>
      </div>
    </section>
  );
});

RuntimeDefaults.displayName = 'RuntimeDefaults';

export default RuntimeDefaults;

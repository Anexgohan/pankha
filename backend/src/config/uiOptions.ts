/**
 * UI Options - Single Source of Truth (SST)
 * 
 * This module imports ui-options.json from the frontend (single source of truth).
 * In Docker, the file is copied to backend/config/ during build (see Dockerfile).
 * 
 * The JSON is inlined at compile time, so no runtime file reading is needed.
 */

import uiOptions from '../../../frontend/src/config/ui-options.json';

// Type definitions for ui-options.json structure
interface ValueLabelPair {
  value: number | string;
  label: string;
}

interface UIOption {
  label: string;
  description: string;
  tooltip: string;
  unit?: string;
  values?: (number | string | ValueLabelPair)[];  // Optional for checkboxes
  default: number | string | boolean;
}

interface UIOptionsJson {
  options: {
    fanControl: UIOption;
    logLevel: UIOption;
    emergencyTemp: UIOption;
    failsafeSpeed: UIOption;
    updateInterval: UIOption;
    fanStep: UIOption;
    hysteresis: UIOption;
  };
}

const options = (uiOptions as UIOptionsJson).options;

/**
 * Extract numeric values from an option's values array
 * Handles both simple arrays [1, 2, 3] and object arrays [{value: 1, label: "1"}]
 */
function extractNumericValues(optionKey: keyof typeof options): number[] {
  const opt = options[optionKey];
  if (!opt.values) return [];
  return opt.values.map(v => {
    if (typeof v === 'number') return v;
    if (typeof v === 'object' && 'value' in v && typeof v.value === 'number') return v.value;
    return NaN;
  }).filter(v => !isNaN(v));
}

/**
 * Extract string values from an option's values array
 */
function extractStringValues(optionKey: keyof typeof options): string[] {
  const opt = options[optionKey];
  if (!opt.values) return [];
  return opt.values.map(v => {
    if (typeof v === 'string') return v;
    if (typeof v === 'object' && 'value' in v && typeof v.value === 'string') return v.value;
    return '';
  }).filter(v => v !== '');
}

/**
 * Get default value for an option
 */
function getDefault<T>(optionKey: keyof typeof options): T {
  return options[optionKey].default as T;
}

// ========== EXPORTED VALIDATION ARRAYS ==========

/** Valid fan step percentages */
export const validFanSteps = extractNumericValues('fanStep');

/** Valid hysteresis temperatures in °C */
export const validHysteresis = extractNumericValues('hysteresis');

/** Valid emergency temperatures in °C */
export const validEmergencyTemps = extractNumericValues('emergencyTemp');

/** Valid update intervals in seconds */
export const validUpdateIntervals = extractNumericValues('updateInterval');

/** Valid failsafe speed percentages */
export const validFailsafeSpeeds = extractNumericValues('failsafeSpeed');

/** Valid log levels */
export const validLogLevels = extractStringValues('logLevel');

// ========== EXPORTED DEFAULT VALUES ==========

/** Default fan step percentage for new agents */
export const defaultFanStep = getDefault<number>('fanStep');

/** Default hysteresis temperature in °C for new agents */
export const defaultHysteresis = getDefault<number>('hysteresis');

/** Default emergency temperature in °C for new agents */
export const defaultEmergencyTemp = getDefault<number>('emergencyTemp');

/** Default update interval in seconds for new agents */
export const defaultUpdateInterval = getDefault<number>('updateInterval');

/** Default failsafe speed percentage for new agents */
export const defaultFailsafeSpeed = getDefault<number>('failsafeSpeed');

/** Default log level for new agents */
export const defaultLogLevel = getDefault<string>('logLevel');

/** Default fan control enabled state for new agents */
export const defaultFanControlEnabled = getDefault<boolean>('fanControl');

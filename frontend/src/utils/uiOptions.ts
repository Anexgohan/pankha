import uiOptions from '../config/ui-options.json';

// Type for option keys
type OptionKey = keyof typeof uiOptions.options;

// Type for option with values array
interface OptionWithValues {
  label: string;
  description: string;
  tooltip: string;
  unit?: string;
  values: (number | { value: number | string; label: string })[];
  default: number | string;
  min?: number;
  max?: number;
}

// Type for option without values (like fanControl)
interface OptionWithoutValues {
  label: string;
  description: string;
  tooltip: string;
  default: boolean;
}

type UIOption = OptionWithValues | OptionWithoutValues;

/**
 * Interpolate placeholders like {agentInterval} in tooltip strings
 * @param template - The template string with {placeholder} syntax
 * @param values - Object with placeholder values
 * @returns Interpolated string
 */
export function interpolateTooltip(
  template: string,
  values: Record<string, string | number>
): string {
  return template.replace(/{(\w+)}/g, (_, key) => 
    String(values[key] ?? `{${key}}`)
  );
}

/**
 * Get option config by key
 * @param key - The option key from ui-options.json
 * @returns The option configuration object
 */
export function getOption(key: OptionKey): UIOption {
  return uiOptions.options[key] as UIOption;
}

/**
 * Get dropdown values for a key
 * Returns an array of values or value/label pairs
 * @param key - The option key from ui-options.json
 * @returns Array of values or empty array if no values defined
 */
export function getValues(key: OptionKey): (number | { value: number | string; label: string })[] {
  const opt = uiOptions.options[key];
  return 'values' in opt ? opt.values : [];
}

/**
 * Get the label for an option
 * @param key - The option key from ui-options.json
 * @returns The label string
 */
export function getLabel(key: OptionKey): string {
  return uiOptions.options[key].label;
}

/**
 * Get the tooltip for an option (without interpolation)
 * @param key - The option key from ui-options.json
 * @returns The raw tooltip string with placeholders
 */
export function getTooltip(key: OptionKey): string {
  return uiOptions.options[key].tooltip;
}

/**
 * Get the default value for an option
 * @param key - The option key from ui-options.json
 * @returns The default value
 */
export function getDefault(key: OptionKey): number | string | boolean {
  return uiOptions.options[key].default;
}

// Export the full options object for direct access
export { uiOptions };

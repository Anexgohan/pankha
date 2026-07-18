// Human-friendly duration parsing, e.g. "6 minutes", "2 days", "1 year".
// Pattern adapted from the license token generator (private repo).

const UNIT_SECONDS: Record<string, number> = {
  minute: 60,
  hour: 60 * 60,
  day: 24 * 60 * 60,
  week: 7 * 24 * 60 * 60,
  month: 30 * 24 * 60 * 60, // approx 30 days
  year: 365 * 24 * 60 * 60, // approx 365 days
};

// Parse "<n> <unit>" (unit singular or plural) into seconds. Returns null when
// the input is empty or not in that form.
export function parseDurationSeconds(input: string | undefined | null): number | null {
  if (!input) return null;
  const match = input.trim().toLowerCase().match(/^(\d+)\s*(minute|hour|day|week|month|year)s?$/);
  if (!match) return null;
  const value = parseInt(match[1], 10);
  if (!(value > 0)) return null;
  return value * UNIT_SECONDS[match[2]];
}

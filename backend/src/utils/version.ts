// Semver compare with pre-release ordering (release > rc > beta > alpha ...).
// Mirrors the frontend's utils/version.ts - keep in sync.

const parsePreRelease = (version: string): number => {
  if (!version.includes('-')) return Infinity;

  const suffix = version.split('-')[1]?.toLowerCase() || '';
  const numMatch = suffix.match(/\d+$/);
  const num = numMatch ? parseInt(numMatch[0], 10) : 0;

  let weight = 0;
  if (suffix.startsWith('rc')) weight = 8000;
  else if (suffix.startsWith('beta')) weight = 7000;
  else if (suffix.startsWith('alpha')) weight = 6000;
  else if (suffix.startsWith('pre') || suffix.startsWith('preview')) weight = 5000;
  else if (suffix.startsWith('insiders')) weight = 4000;
  else if (suffix.startsWith('experimental')) weight = 3000;
  else if (suffix.startsWith('canary')) weight = 2000;
  else if (suffix.startsWith('dev')) weight = 1000;
  else if (suffix.startsWith('nightly')) weight = 500;
  else weight = 100;

  return weight + num;
};

const stripPreRelease = (version: string): string =>
  (version || '0.0.0').replace(/^v/, '').replace(/-.*$/, '');

export const compareSemver = (a: string, b: string): number => {
  const cleanA = (a || '0.0.0').replace(/^v/, '');
  const cleanB = (b || '0.0.0').replace(/^v/, '');
  const pa = stripPreRelease(cleanA).split('.').map(Number);
  const pb = stripPreRelease(cleanB).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na !== nb) return na - nb;
  }
  return (parsePreRelease(cleanA) - parsePreRelease(cleanB)) || 0;
};

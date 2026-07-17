import crypto from 'crypto';

// Agent tokens: 128-bit random, base64url, self-identifying prefix.
// Format: pka_ + 22 chars, ~26 chars total. Only the SHA-256 hex hash is
// stored Hub-side (systems.auth_token_hash); plaintext lives solely in the
// agent's config.json.
const TOKEN_PREFIX = 'pka_';
const TOKEN_BYTES = 16;

export const AGENT_TOKEN_PATTERN = /^pka_[A-Za-z0-9_-]{22}$/;

export function mintAgentToken(): string {
  return TOKEN_PREFIX + crypto.randomBytes(TOKEN_BYTES).toString('base64url');
}

export function hashAgentToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Timing-safe check of a presented token against a stored hash.
 */
export function verifyAgentToken(
  presented: string,
  storedHash: string | null | undefined
): boolean {
  if (!presented || !storedHash) return false;
  const actual = Buffer.from(hashAgentToken(presented), 'hex');
  const expected = Buffer.from(storedHash, 'hex');
  return (
    actual.length === expected.length &&
    crypto.timingSafeEqual(actual, expected)
  );
}

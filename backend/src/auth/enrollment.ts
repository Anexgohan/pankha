import Database from '../database/database';

/**
 * Check a deploy/enrollment token against deployment_templates. Multi-use by
 * design (fleet paste): validity is expiry-only, used_count is statistics.
 */
export async function isValidDeployToken(token: unknown): Promise<boolean> {
  if (typeof token !== 'string' || token.length === 0 || token.length > 64) {
    return false;
  }
  const db = Database.getInstance();
  const row = await db.get(
    'SELECT 1 FROM deployment_templates WHERE token = $1 AND expires_at > NOW()',
    [token]
  );
  return !!row;
}

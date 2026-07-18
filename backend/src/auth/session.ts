import crypto from 'crypto';
import { SignJWT, jwtVerify } from 'jose';
import Database from '../database/database';
import { log } from '../utils/logger';
import { parseDurationSeconds } from '../utils/duration';

// Browser sessions: HS256 JWT in an httpOnly cookie. The token carries the
// role NAME only - numeric levels exist solely in middleware/auth.ts.
export const SESSION_COOKIE = 'pankha_session';
// Session lifetime (sliding), e.g. "7 days", "12 hours". Via PANKHA_SESSION_DURATION; default 7 days.
export const SESSION_TTL_SECONDS =
  parseDurationSeconds(process.env.PANKHA_SESSION_DURATION) ?? 7 * 24 * 60 * 60;
// Reissue the cookie once a session has used ~1/7 of its life (sliding expiry).
export const SESSION_RENEW_AFTER_SECONDS = Math.floor(SESSION_TTL_SECONDS / 7);

const SECRET_SETTING_KEY = 'session_secret';

export interface SessionUser {
  userId: number;
  username: string;
  role: string;
}

let secretKey: Uint8Array | null = null;

/**
 * Load the session signing secret from backend_settings, generating and
 * persisting one on first boot (sessions survive container restarts).
 */
export async function initSessionSecret(): Promise<void> {
  const db = Database.getInstance();
  const row = await db.get(
    'SELECT setting_value FROM backend_settings WHERE setting_key = $1',
    [SECRET_SETTING_KEY]
  );
  if (row?.setting_value) {
    secretKey = Buffer.from(row.setting_value, 'base64');
    return;
  }
  const fresh = crypto.randomBytes(32);
  await db.run(
    `INSERT INTO backend_settings (setting_key, setting_value, description)
     VALUES ($1, $2, $3)
     ON CONFLICT (setting_key) DO NOTHING`,
    [SECRET_SETTING_KEY, fresh.toString('base64'), 'Session cookie signing secret']
  );
  // Re-read in case a concurrent boot won the insert race
  const persisted = await db.get(
    'SELECT setting_value FROM backend_settings WHERE setting_key = $1',
    [SECRET_SETTING_KEY]
  );
  secretKey = Buffer.from(persisted.setting_value, 'base64');
  log.info('Generated new session signing secret', 'auth');
}

export async function signSession(user: SessionUser): Promise<string> {
  if (!secretKey) throw new Error('Session secret not initialized');
  return new SignJWT({ username: user.username, role: user.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(user.userId))
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS)
    .sign(secretKey);
}

export interface VerifiedSession {
  user: SessionUser;
  /** Seconds since the token was issued (drives sliding renewal) */
  ageSeconds: number;
}

/**
 * Minimal cookie-header parser for the WebSocket upgrade request (Express's
 * cookie-parser only runs on HTTP routes).
 */
export function parseCookieHeader(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (name) cookies[name] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return cookies;
}

export async function verifySession(
  token: string
): Promise<VerifiedSession | null> {
  if (!secretKey) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey, {
      algorithms: ['HS256'],
    });
    if (!payload.sub || typeof payload.username !== 'string' || typeof payload.role !== 'string') {
      return null;
    }
    const now = Math.floor(Date.now() / 1000);
    return {
      user: {
        userId: parseInt(payload.sub, 10),
        username: payload.username,
        role: payload.role,
      },
      ageSeconds: now - (payload.iat ?? now),
    };
  } catch {
    return null;
  }
}

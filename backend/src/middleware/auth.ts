import { Request, Response, NextFunction } from 'express';
import Database from '../database/database';
import { log } from '../utils/logger';
import { isDemoMode } from '../utils/mode';
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  SESSION_RENEW_AFTER_SECONDS,
  SessionUser,
  initSessionSecret,
  signSession,
  verifySession,
} from '../auth/session';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      session?: SessionUser;
    }
  }
}

// The ONLY place role names map to levels. Persisted and transmitted values
// are role NAMES; numeric levels never leave this file.
const ROLE_LEVEL: Record<string, number> = {
  viewer: 1,
  operator: 2,
  admin: 3,
};

export const VALID_ROLES = Object.keys(ROLE_LEVEL);

type Role = 'viewer' | 'operator' | 'admin';
type AccessClass = 'public' | 'deploy-token' | 'agent-token' | Role;

// REST surface classification (task_02 section 5.5). Matched against
// "<METHOD> <path>" where path is relative to the /api mount. First match
// wins; defaults below the table: GET -> viewer, everything else -> operator.
const ACCESS_RULES: Array<{ pattern: RegExp; access: AccessClass }> = [
  // Auth bootstrap + boot-time frontend config (login page needs these).
  // register is public here; the route itself enforces the admin's
  // self-registration toggle (D15)
  { pattern: /^POST \/auth\/(login|logout|setup|register)$/, access: 'public' },
  { pattern: /^GET \/auth\/me$/, access: 'public' },
  { pattern: /^GET \/config\/deployment(\.js)?$/, access: 'public' },
  // Own-password change: any authenticated rank
  { pattern: /^PUT \/auth\/password$/, access: 'viewer' },
  // User management + registration settings: admin only
  { pattern: /^(GET|POST|PUT|DELETE) \/auth\/users(\/|$)/, access: 'admin' },
  { pattern: /^(GET|PUT) \/auth\/registration$/, access: 'admin' },
  // Install scripts fetch these headlessly with their own short-lived
  // ?token= (validated in the route; hardened in M3)
  { pattern: /^GET \/deploy\/(linux|ipmi)$/, access: 'deploy-token' },
  { pattern: /^PUT \/deploy\/profiles\/assign\/[^/]+$/, access: 'deploy-token' },
  // Binaries are public by design: they are the public GitHub release
  // artifacts, and pre-auth binaries must be able to self-update into a
  // build that can authenticate at all
  { pattern: /^GET \/deploy\/binaries\//, access: 'public' },
  // IPMI profile fetch: bearer required once the agent is secured
  // (grandfather-aware check lives in the route)
  { pattern: /^GET \/deploy\/profiles\/assigned\//, access: 'agent-token' },
  // Provisioning, fleet updates, settings, license mutations: admin
  { pattern: /^POST \/deploy\/templates$/, access: 'admin' },
  { pattern: /^(GET|POST|DELETE) \/deploy\/hub\//, access: 'admin' },
  { pattern: /^GET \/deploy\/profiles\/refresh$/, access: 'admin' },
  { pattern: /^POST \/deploy\/profiles\/custom$/, access: 'admin' },
  { pattern: /^POST \/systems\/\d+\/update$/, access: 'admin' },
  { pattern: /^DELETE \/systems\/\d+$/, access: 'admin' },
  // Pending-approval queue (D13): admitting machines is admin territory
  { pattern: /^(GET|POST|DELETE) \/systems\/pending(\/|$)/, access: 'admin' },
  { pattern: /^(POST|DELETE) \/license$/, access: 'admin' },
  { pattern: /^POST \/license\/(sync|renew|cancel|checkout)$/, access: 'admin' },
];

function classify(method: string, path: string): AccessClass {
  // Strip trailing slashes: Express routes "/foo/" to the "/foo" handler, so
  // a rule must not be dodged by a slash that drops the path to the default.
  const normalized = path.length > 1 ? path.replace(/\/+$/, '') : path;
  const key = `${method} ${normalized}`;
  for (const rule of ACCESS_RULES) {
    if (rule.pattern.test(key)) return rule.access;
  }
  return method === 'GET' ? 'viewer' : 'operator';
}

// Live user cache: userId -> role. The session JWT carries the role name,
// but the level check always uses the live role, so role changes and user
// deletions apply immediately without waiting for token expiry.
let userRoles = new Map<number, string>();
let authResetActive = false;

export async function reloadUserCache(): Promise<void> {
  const db = Database.getInstance();
  const rows = await db.all('SELECT id, role FROM users');
  userRoles = new Map(rows.map((r) => [r.id, r.role]));
}

export function usersExist(): boolean {
  return userRoles.size > 0;
}

export function isAuthResetActive(): boolean {
  return authResetActive;
}

/**
 * Boot-time init: session secret, PANKHA_AUTH_RESET handling, user cache.
 * Call after the database is initialized.
 */
export async function initAuth(): Promise<void> {
  await initSessionSecret();

  // Destructive switch: strict values only. Garbage means unclear operator
  // intent, so refuse to start rather than guess.
  const authReset = (process.env.PANKHA_AUTH_RESET ?? '').trim();
  if (authReset && authReset !== 'true' && authReset !== 'false') {
    log.error(
      `PANKHA_AUTH_RESET must be "true", "false", or unset - got "${authReset}". Refusing to start.`,
      'auth'
    );
    process.exit(1);
  }

  if (authReset === 'true') {
    authResetActive = true;
    const db = Database.getInstance();
    const result = await db.run('DELETE FROM users');
    log.warn(
      `PANKHA_AUTH_RESET is set: removed ${result.rowCount ?? 0} user account(s). ` +
        'The setup screen is open to anyone who can reach this Hub. ' +
        'Remove PANKHA_AUTH_RESET from .env after recovering access.',
      'auth'
    );
  }

  await reloadUserCache();
  if (!usersExist()) {
    log.info('No user accounts exist - setup screen active', 'auth');
  }
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS * 1000,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', path: '/' });
}

/**
 * Level check for routes that combine a session with another credential
 * (e.g. deploy token OR operator session). Keeps the ladder in this file.
 */
export function hasLevel(session: SessionUser | undefined, minRole: Role): boolean {
  return !!session && (ROLE_LEVEL[session.role] ?? 0) >= ROLE_LEVEL[minRole];
}

/**
 * Level check for explicit per-route use. Prefer classification via the
 * ACCESS_RULES table; this exists for handlers that need a second gate.
 */
export function requireLevel(minRole: Role) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.session) {
      return res.status(401).json({ error: 'authentication required' });
    }
    if ((ROLE_LEVEL[req.session.role] ?? 0) < ROLE_LEVEL[minRole]) {
      return res.status(403).json({ error: 'insufficient role' });
    }
    next();
  };
}

/**
 * Central API guard, mounted at /api before all routers. Attaches
 * req.session from a valid cookie, slides the expiry, then enforces the
 * access class from ACCESS_RULES.
 */
export async function apiAuthGuard(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void | Response> {
  const raw = req.cookies?.[SESSION_COOKIE];
  if (raw) {
    const verified = await verifySession(raw);
    if (verified) {
      const liveRole = userRoles.get(verified.user.userId);
      if (liveRole) {
        req.session = { ...verified.user, role: liveRole };
        if (verified.ageSeconds > SESSION_RENEW_AFTER_SECONDS) {
          setSessionCookie(res, await signSession(req.session));
        }
      }
    }
  }

  const access = classify(req.method, req.path);
  if (access === 'public' || access === 'deploy-token' || access === 'agent-token') {
    // deploy-token and agent-token routes validate their own credentials
    return next();
  }

  // Demo instances (PANKHA_MODE=demo) render a read-only viewer view.
  if (!req.session && isDemoMode()) {
    req.session = { userId: -1, username: 'demo', role: 'viewer' };
  }

  if (!req.session) {
    return res.status(401).json({
      error: 'authentication required',
      setup_required: !usersExist(),
    });
  }
  if ((ROLE_LEVEL[req.session.role] ?? 0) < ROLE_LEVEL[access]) {
    return res.status(403).json({ error: 'insufficient role' });
  }
  next();
}

// Login brute-force limiter: per-IP failure counter with lockout.
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const loginFailures = new Map<string, { fails: number; lockedUntil: number }>();

export function loginRateCheck(ip: string): { allowed: boolean; retryAfterSeconds: number } {
  const entry = loginFailures.get(ip);
  if (!entry) return { allowed: true, retryAfterSeconds: 0 };
  const now = Date.now();
  if (entry.lockedUntil > now) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((entry.lockedUntil - now) / 1000),
    };
  }
  if (entry.lockedUntil > 0 && entry.lockedUntil <= now) {
    loginFailures.delete(ip); // lockout expired
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

export function loginRateFail(ip: string): void {
  const entry = loginFailures.get(ip) ?? { fails: 0, lockedUntil: 0 };
  entry.fails += 1;
  if (entry.fails >= LOCKOUT_THRESHOLD) {
    entry.lockedUntil = Date.now() + LOCKOUT_MS;
    entry.fails = 0;
    log.warn(`Login lockout for ${ip} (${LOCKOUT_THRESHOLD} failures)`, 'auth');
  }
  loginFailures.set(ip, entry);
}

export function loginRateReset(ip: string): void {
  loginFailures.delete(ip);
}

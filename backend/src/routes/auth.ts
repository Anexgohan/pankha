import { Router, Request, Response } from 'express';
import Database from '../database/database';
import { log } from '../utils/logger';
import { hashPassword, verifyPassword } from '../auth/passwords';
import { signSession } from '../auth/session';
import {
  VALID_ROLES,
  usersExist,
  reloadUserCache,
  isAuthResetActive,
  setSessionCookie,
  clearSessionCookie,
  loginRateCheck,
  loginRateFail,
  loginRateReset,
} from '../middleware/auth';

const router = Router();

const USERNAME_PATTERN = /^[a-zA-Z0-9_.-]{3,32}$/;
const MIN_PASSWORD_LENGTH = 8;
// Fixed delay on failed logins to slow guessing
const FAIL_DELAY_MS = 500;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function validateCredentials(username: unknown, password: unknown): string | null {
  if (typeof username !== 'string' || !USERNAME_PATTERN.test(username)) {
    return 'Username must be 3-32 characters (letters, numbers, . _ -)';
  }
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  return null;
}

/**
 * POST /api/auth/setup
 * One-time creation of the initial admin account. Only works while no
 * users exist (fresh install or after PANKHA_AUTH_RESET).
 */
router.post('/setup', async (req: Request, res: Response) => {
  try {
    if (usersExist()) {
      return res.status(400).json({ error: 'Setup already completed' });
    }
    const { username, password } = req.body ?? {};
    const invalid = validateCredentials(username, password);
    if (invalid) {
      return res.status(400).json({ error: invalid });
    }

    const passwordHash = await hashPassword(password);
    // WHERE NOT EXISTS guards the race of two concurrent setup submissions
    const db = Database.getInstance();
    const row = await db.get(
      `INSERT INTO users (username, password_hash, role)
       SELECT $1, $2, 'admin'
       WHERE NOT EXISTS (SELECT 1 FROM users)
       RETURNING id`,
      [username, passwordHash]
    );
    if (!row) {
      return res.status(400).json({ error: 'Setup already completed' });
    }
    await reloadUserCache();

    const user = { userId: row.id, username, role: 'admin' };
    setSessionCookie(res, await signSession(user));
    log.info(`Initial admin account created: ${username}`, 'auth');
    res.json({ username, role: 'admin' });
  } catch (error) {
    log.error('Setup failed', 'auth', error);
    res.status(500).json({ error: 'Setup failed' });
  }
});

/**
 * POST /api/auth/login
 */
router.post('/login', async (req: Request, res: Response) => {
  try {
    const ip = req.ip ?? 'unknown';
    const gate = loginRateCheck(ip);
    if (!gate.allowed) {
      return res.status(429).json({
        error: 'Too many failed attempts, try again later',
        retry_after_seconds: gate.retryAfterSeconds,
      });
    }

    const { username, password } = req.body ?? {};
    if (typeof username !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const db = Database.getInstance();
    const user = await db.get(
      'SELECT id, username, password_hash, role FROM users WHERE username = $1',
      [username]
    );
    const valid = user ? await verifyPassword(password, user.password_hash) : false;
    if (!valid) {
      loginRateFail(ip);
      await sleep(FAIL_DELAY_MS);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    loginRateReset(ip);
    const session = { userId: user.id, username: user.username, role: user.role };
    setSessionCookie(res, await signSession(session));
    log.info(`User logged in: ${user.username}`, 'auth');
    res.json({ username: user.username, role: user.role });
  } catch (error) {
    log.error('Login failed', 'auth', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

/**
 * POST /api/auth/logout
 */
router.post('/logout', (req: Request, res: Response) => {
  clearSessionCookie(res);
  res.json({ message: 'Logged out' });
});

/**
 * GET /api/auth/me
 * Public: tells the frontend whether to show the app, login, or setup.
 */
router.get('/me', (req: Request, res: Response) => {
  if (req.session) {
    return res.json({
      authenticated: true,
      username: req.session.username,
      role: req.session.role,
      auth_reset_active: isAuthResetActive(),
    });
  }
  res.json({
    authenticated: false,
    setup_required: !usersExist(),
    auth_reset_active: isAuthResetActive(),
  });
});

/**
 * PUT /api/auth/password
 * Change own password (any authenticated rank).
 */
router.put('/password', async (req: Request, res: Response) => {
  try {
    if (!req.session) {
      return res.status(401).json({ error: 'authentication required' });
    }
    const { current_password, new_password } = req.body ?? {};
    if (typeof new_password !== 'string' || new_password.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({
        error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      });
    }

    const db = Database.getInstance();
    const user = await db.get(
      'SELECT password_hash FROM users WHERE id = $1',
      [req.session.userId]
    );
    if (!user || typeof current_password !== 'string' ||
        !(await verifyPassword(current_password, user.password_hash))) {
      await sleep(FAIL_DELAY_MS);
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const passwordHash = await hashPassword(new_password);
    await db.run(
      'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
      [passwordHash, req.session.userId]
    );
    log.info(`Password changed: ${req.session.username}`, 'auth');
    res.json({ message: 'Password updated' });
  } catch (error) {
    log.error('Password change failed', 'auth', error);
    res.status(500).json({ error: 'Password change failed' });
  }
});

/**
 * GET /api/auth/users (admin)
 */
router.get('/users', async (_req: Request, res: Response) => {
  try {
    const db = Database.getInstance();
    const users = await db.all(
      'SELECT id, username, role, created_at, updated_at FROM users ORDER BY id'
    );
    res.json(users);
  } catch (error) {
    log.error('Failed to list users', 'auth', error);
    res.status(500).json({ error: 'Failed to list users' });
  }
});

/**
 * POST /api/auth/users (admin)
 */
router.post('/users', async (req: Request, res: Response) => {
  try {
    const { username, password, role } = req.body ?? {};
    const invalid = validateCredentials(username, password);
    if (invalid) {
      return res.status(400).json({ error: invalid });
    }
    if (typeof role !== 'string' || !VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: `Role must be one of: ${VALID_ROLES.join(', ')}` });
    }

    const db = Database.getInstance();
    const passwordHash = await hashPassword(password);
    const row = await db.get(
      `INSERT INTO users (username, password_hash, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (username) DO NOTHING
       RETURNING id`,
      [username, passwordHash, role]
    );
    if (!row) {
      return res.status(409).json({ error: 'Username already exists' });
    }
    await reloadUserCache();
    log.info(`User created: ${username} (${role})`, 'auth');
    res.status(201).json({ id: row.id, username, role });
  } catch (error) {
    log.error('User creation failed', 'auth', error);
    res.status(500).json({ error: 'User creation failed' });
  }
});

/**
 * PUT /api/auth/users/:id (admin)
 * Update role and/or reset password.
 */
router.put('/users/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: 'Invalid user id' });
    }
    const { password, role } = req.body ?? {};

    const db = Database.getInstance();
    const target = await db.get('SELECT id, username, role FROM users WHERE id = $1', [id]);
    if (!target) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (role !== undefined) {
      if (typeof role !== 'string' || !VALID_ROLES.includes(role)) {
        return res.status(400).json({ error: `Role must be one of: ${VALID_ROLES.join(', ')}` });
      }
      if (target.role === 'admin' && role !== 'admin') {
        const admins = await db.get("SELECT COUNT(*)::int AS count FROM users WHERE role = 'admin'");
        if (admins.count <= 1) {
          return res.status(400).json({ error: 'Cannot demote the last admin' });
        }
      }
      await db.run('UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2', [role, id]);
    }

    if (password !== undefined) {
      if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
        return res.status(400).json({
          error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
        });
      }
      const passwordHash = await hashPassword(password);
      await db.run(
        'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
        [passwordHash, id]
      );
    }

    await reloadUserCache();
    log.info(`User updated: ${target.username}`, 'auth');
    res.json({ message: 'User updated' });
  } catch (error) {
    log.error('User update failed', 'auth', error);
    res.status(500).json({ error: 'User update failed' });
  }
});

/**
 * DELETE /api/auth/users/:id (admin)
 */
router.delete('/users/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: 'Invalid user id' });
    }

    const db = Database.getInstance();
    const target = await db.get('SELECT id, username, role FROM users WHERE id = $1', [id]);
    if (!target) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (target.role === 'admin') {
      const admins = await db.get("SELECT COUNT(*)::int AS count FROM users WHERE role = 'admin'");
      if (admins.count <= 1) {
        return res.status(400).json({ error: 'Cannot delete the last admin' });
      }
    }

    await db.run('DELETE FROM users WHERE id = $1', [id]);
    await reloadUserCache();
    log.info(`User deleted: ${target.username}`, 'auth');
    res.json({ message: 'User deleted' });
  } catch (error) {
    log.error('User deletion failed', 'auth', error);
    res.status(500).json({ error: 'User deletion failed' });
  }
});

export default router;

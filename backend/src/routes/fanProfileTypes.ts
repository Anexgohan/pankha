import { Router, Request, Response } from 'express';
import { FanProfileTypeManager } from '../services/FanProfileTypeManager';
import { log } from '../utils/logger';
import { createDemoLockResponse, isDemoMode } from '../utils/mode';

const router = Router();
const manager = FanProfileTypeManager.getInstance();

/**
 * GET /api/fan-profile-types
 * List all profile types (system + user) with is_system flag and in_use_count.
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const types = await manager.getAll();
    res.json({ success: true, data: types, count: types.length });
  } catch (error) {
    log.error('Error fetching fan profile types', 'fanProfileTypes', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch fan profile types',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/fan-profile-types
 * Body: { name: string }
 *
 * Creates a user-defined profile type. Returns 409 on collision with an
 * existing name (system or user), 400 on validation failure.
 */
router.post('/', async (req: Request, res: Response) => {
  if (isDemoMode()) {
    return res.status(403).json(createDemoLockResponse('create profile type'));
  }
  try {
    const { name, color } = req.body || {};
    if (typeof name !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'name (string) is required'
      });
    }
    if (color !== undefined && typeof color !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'color must be a string when provided'
      });
    }
    const created = await manager.create(name, color);
    if (!created) {
      return res.status(409).json({
        success: false,
        error: 'A profile type with this name already exists'
      });
    }
    return res.status(201).json({ success: true, data: created });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    log.warn(`Create fan profile type failed: ${msg}`, 'fanProfileTypes');
    return res.status(400).json({ success: false, error: msg });
  }
});

/**
 * PATCH /api/fan-profile-types/:name
 * Body: { color: string }
 *
 * Recolor an existing profile type. Works for both system and user types -
 * the is_system lock only applies to deletion. Returns 404 if the type
 * doesn't exist, 400 if the color body is malformed.
 */
router.patch('/:name', async (req: Request, res: Response) => {
  if (isDemoMode()) {
    return res.status(403).json(createDemoLockResponse('update profile type'));
  }
  try {
    const { color } = req.body || {};
    if (typeof color !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'color (string) is required'
      });
    }
    const updated = await manager.updateColor(req.params.name, color);
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Profile type not found' });
    }
    return res.json({ success: true, data: updated });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    log.warn(`Update fan profile type color failed: ${msg}`, 'fanProfileTypes');
    return res.status(400).json({ success: false, error: msg });
  }
});

/**
 * DELETE /api/fan-profile-types/:name
 *
 * Blocks deletion when the type is a system type or when any profile still
 * uses it (D1 semantics). Translates the service result into the appropriate
 * HTTP status:
 *   404 - not_found
 *   403 - is_system
 *   409 - in_use (response includes in_use_count)
 */
router.delete('/:name', async (req: Request, res: Response) => {
  if (isDemoMode()) {
    return res.status(403).json(createDemoLockResponse('delete profile type'));
  }
  try {
    const result = await manager.delete(req.params.name);
    if (result.ok) {
      return res.json({ success: true });
    }
    switch (result.reason) {
      case 'not_found':
        return res.status(404).json({ success: false, error: 'Profile type not found' });
      case 'is_system':
        return res.status(403).json({
          success: false,
          error: 'System profile types cannot be deleted'
        });
      case 'in_use':
        return res.status(409).json({
          success: false,
          error: 'Profile type is still in use',
          in_use_count: result.in_use_count
        });
    }
  } catch (error) {
    log.error('Error deleting fan profile type', 'fanProfileTypes', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to delete fan profile type',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;

/**
 * License API Routes
 * 
 * Endpoints for license management:
 * - GET /api/license - Get current license info
 * - POST /api/license - Set/update license key
 */

import { Router, Request, Response } from 'express';
import { licenseManager } from './LicenseManager';

const router = Router();

/**
 * GET /api/license
 * Get current license tier and limits
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const licenseInfo = await licenseManager.getLicenseInfo();
    res.json(licenseInfo);
  } catch (error) {
    console.error('[License API] Error getting license info:', error);
    res.status(500).json({ error: 'Failed to get license info' });
  }
});

/**
 * POST /api/license
 * Set or update license key
 * Body: { licenseKey: string }
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { licenseKey } = req.body;
    
    if (!licenseKey || typeof licenseKey !== 'string') {
      return res.status(400).json({ 
        success: false, 
        error: 'License key is required' 
      });
    }

    const result = await licenseManager.setLicenseKey(licenseKey.trim());
    
    if (result.success) {
      res.json({
        success: true,
        tier: result.tier,
        message: `License activated: ${result.tier}`,
      });
    } else {
      res.status(400).json({
        success: false,
        tier: 'free',
        error: result.error || 'Invalid license key',
      });
    }
  } catch (error) {
    console.error('[License API] Error setting license:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to validate license' 
    });
  }
});

/**
 * DELETE /api/license
 * Remove current license key (revert to free tier)
 */
router.delete('/', async (req: Request, res: Response) => {
  try {
    // TODO: Implement license removal
    res.json({
      success: true,
      tier: 'free',
      message: 'License removed, reverted to free tier',
    });
  } catch (error) {
    console.error('[License API] Error removing license:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to remove license' 
    });
  }
});

export default router;

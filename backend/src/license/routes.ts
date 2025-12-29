/**
 * License API Routes
 * 
 * Endpoints for license management:
 * - GET /api/license - Get current license info
 * - GET /api/license/pricing - Get all tier pricing info
 * - POST /api/license - Set/update license key
 */

import { Router, Request, Response } from 'express';
import { licenseManager } from './LicenseManager';
import { TIERS } from './tiers';

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
 * GET /api/license/pricing
 * Get all tier pricing and feature info
 */
router.get('/pricing', async (req: Request, res: Response) => {
  try {
    // Transform TIERS for frontend consumption
    const pricing = {
      free: {
        name: TIERS.free.name,
        agents: TIERS.free.agentLimit,
        retentionDays: TIERS.free.retentionDays,
        alerts: TIERS.free.alertLimit,
        alertChannels: TIERS.free.alertChannels,
        apiAccess: TIERS.free.apiAccess,
        showBranding: TIERS.free.showBranding,
        pricing: TIERS.free.pricing,
      },
      pro: {
        name: TIERS.pro.name,
        agents: TIERS.pro.agentLimit,
        retentionDays: TIERS.pro.retentionDays,
        alerts: TIERS.pro.alertLimit === Infinity ? -1 : TIERS.pro.alertLimit,
        alertChannels: TIERS.pro.alertChannels,
        apiAccess: TIERS.pro.apiAccess,
        showBranding: TIERS.pro.showBranding,
        pricing: TIERS.pro.pricing,
      },
      enterprise: {
        name: TIERS.enterprise.name,
        agents: TIERS.enterprise.agentLimit === Infinity ? -1 : TIERS.enterprise.agentLimit,
        retentionDays: TIERS.enterprise.retentionDays,
        alerts: TIERS.enterprise.alertLimit === Infinity ? -1 : TIERS.enterprise.alertLimit,
        alertChannels: TIERS.enterprise.alertChannels,
        apiAccess: TIERS.enterprise.apiAccess,
        showBranding: TIERS.enterprise.showBranding,
        pricing: TIERS.enterprise.pricing,
      },
    };
    res.json(pricing);
  } catch (error) {
    console.error('[License API] Error getting pricing:', error);
    res.status(500).json({ error: 'Failed to get pricing info' });
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
    const result = await licenseManager.removeLicense();
    
    if (result.success) {
      res.json({
        success: true,
        tier: 'free',
        message: 'License removed, reverted to free tier',
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error || 'Failed to remove license',
      });
    }
  } catch (error) {
    console.error('[License API] Error removing license:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to remove license' 
    });
  }
});

export default router;

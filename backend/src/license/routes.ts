/**
 * License API Routes
 *
 * Endpoints for license management:
 * - GET /api/license - Get current license info
 * - GET /api/license/pricing - Get all tier pricing info
 * - POST /api/license - Set/update license key
 * - POST /api/license/sync - Force sync with license server (for renewals)
 * - GET /api/license/promo - List advertised discounts (proxies to Worker)
 * - POST /api/license/checkout - Create Dodo checkout session (proxies to Worker)
 * - DELETE /api/license - Remove license (revert to free tier)
 */

import { Router, Request, Response } from 'express';
import { licenseManager } from './LicenseManager';
import { TIERS } from './tiers';
import { LICENSE_API_URL } from './license-config';

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
        benefits: TIERS.free.benefits,
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
        benefits: TIERS.pro.benefits,
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
        benefits: TIERS.enterprise.benefits,
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
 * POST /api/license/sync
 * Force sync with license server (user-triggered refresh)
 * Checks for license renewals and updates local cache
 */
router.post('/sync', async (req: Request, res: Response) => {
  try {
    const result = await licenseManager.syncWithLicenseServer();

    if (result.success && result.changed) {
      // License was renewed - return updated info
      const info = await licenseManager.getLicenseInfo();
      res.json({
        ...result,
        license: info
      });
    } else {
      res.json(result);
    }
  } catch (error) {
    console.error('[License API] Sync error:', error);
    res.status(500).json({
      success: false,
      error: 'Sync failed'
    });
  }
});

/**
 * GET /api/license/promo
 * List currently-advertised Dodo discounts. Proxies to Worker GET /promo.
 * Worker holds DODO_API_KEY; this backend never sees it.
 * On any failure, returns an empty offers array so the UI gracefully shows
 * no banner instead of erroring.
 */
router.get('/promo', async (req: Request, res: Response) => {
  try {
    const r = await fetch(`${LICENSE_API_URL}/promo`, {
      headers: { Accept: 'application/json' },
    });
    if (!r.ok) {
      return res.json({ offers: [], fetchedAt: null });
    }
    const data = await r.json();
    res.json(data);
  } catch (error) {
    console.error('[License API] Promo proxy error:', error);
    res.json({ offers: [], fetchedAt: null });
  }
});

/**
 * POST /api/license/checkout
 * Create a Dodo checkout session with optional pre-applied discount.
 * Proxies to Worker POST /checkout. Returns { ok, checkoutUrl } on success
 * or { ok: false, error, message } on failure so the frontend can decide
 * whether to retry, fall back to a static URL, or surface an error.
 */
router.post('/checkout', async (req: Request, res: Response) => {
  const { productId, discountCode, returnUrl } = req.body || {};

  if (!productId || typeof productId !== 'string') {
    return res.status(400).json({
      ok: false,
      error: 'invalid_request',
      message: 'productId required',
    });
  }

  try {
    const r = await fetch(`${LICENSE_API_URL}/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        productId,
        discountCode: typeof discountCode === 'string' ? discountCode : undefined,
        returnUrl: typeof returnUrl === 'string' ? returnUrl : undefined,
      }),
    });
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (error) {
    console.error('[License API] Checkout proxy error:', error);
    res.status(502).json({
      ok: false,
      error: 'dodo_error',
      message: 'License server unreachable',
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

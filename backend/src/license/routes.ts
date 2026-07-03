/**
 * License API Routes
 *
 * Endpoints for license management:
 * - GET /api/license - Get current license info
 * - GET /api/license/pricing - Get all tier pricing info
 * - POST /api/license - Set/update license key
 * - POST /api/license/sync - Force sync with license server (for renewals)
 * - POST /api/license/renew - Force-refresh token via worker /renew
 * - POST /api/license/cancel - Schedule cancel-at-period-end (proxies to Worker)
 * - GET /api/license/promo - List advertised discounts (proxies to Worker)
 * - POST /api/license/checkout - Create Dodo checkout session (proxies to Worker)
 * - DELETE /api/license - Remove license (revert to free tier)
 */

import { Router, Request, Response } from 'express';
import { licenseManager } from './LicenseManager';
import { TIERS } from './tiers';
import { LICENSE_API_URL } from './license-config';
import { log } from '../utils/logger';

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
    log.error('Error getting license info', 'License API', error);
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
    log.error('Error getting pricing', 'License API', error);
    res.status(500).json({ error: 'Failed to get pricing info' });
  }
});

/**
 * POST /api/license
 * Set or update license key
 * Body: { licenseKey: string, forceSeat?: boolean }
 * forceSeat moves the seat here when the license is bound to another system
 * (worker-enforced limits: 2 per 7 days, cumulative cap). A 409 response
 * carries seatConflict + canForce so the UI can offer the move.
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { licenseKey, forceSeat } = req.body;

    if (!licenseKey || typeof licenseKey !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'License key is required'
      });
    }

    const result = await licenseManager.setLicenseKey(licenseKey.trim(), {
      forceSeat: forceSeat === true,
    });

    if (result.success) {
      res.json({
        success: true,
        tier: result.tier,
        message: `License activated: ${result.tier}`,
      });
    } else if (result.seatConflict) {
      res.status(409).json({
        success: false,
        tier: 'free',
        error: result.error,
        seatConflict: true,
        boundAt: result.boundAt ?? null,
        canForce: result.canForce === true,
      });
    } else {
      res.status(400).json({
        success: false,
        tier: 'free',
        error: result.error || 'Invalid license key',
      });
    }
  } catch (error) {
    log.error('Error setting license', 'License API', error);
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
    log.error('Sync error', 'License API', error);
    res.status(500).json({
      success: false,
      error: 'Sync failed'
    });
  }
});

/**
 * POST /api/license/renew
 * Force-refresh license token via worker /renew (vendor-independent recovery path).
 * Different from /sync which only reads /status. /renew actively mints a fresh JWT.
 * Subject to worker-side rate limits (15min cooldown, 3/day cap).
 */
router.post('/renew', async (req: Request, res: Response) => {
  try {
    const result = await licenseManager.renewLicenseToken();

    if (result.success && result.changed) {
      const info = await licenseManager.getLicenseInfo();
      res.json({
        ...result,
        license: info,
      });
    } else {
      // 429 for rate limit, 400 for client-side problems, 502 for upstream
      const status = result.isRateLimited ? 429 : (result.success ? 200 : 502);
      res.status(status).json(result);
    }
  } catch (error) {
    log.error('Renew error', 'License API', error);
    res.status(500).json({
      success: false,
      error: 'Renew failed',
    });
  }
});

/**
 * POST /api/license/cancel
 * Self-serve cancellation. Proxies to worker /cancel which schedules a
 * cancel-at-period-end with the payment provider. Access continues until the
 * paid-through date; the provider webhook finalizes the ledger status.
 */
router.post('/cancel', async (req: Request, res: Response) => {
  try {
    const result = await licenseManager.cancelSubscription();

    if (result.success) {
      res.json(result);
    } else {
      // 400 for "nothing to cancel" (lifetime/free), 502 for upstream failure
      res.status(result.notCancellable ? 400 : 502).json(result);
    }
  } catch (error) {
    log.error('Cancel error', 'License API', error);
    res.status(500).json({
      success: false,
      error: 'Cancel failed',
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
    log.error('Promo proxy error', 'License API', error);
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
    log.error('Checkout proxy error', 'License API', error);
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
    log.error('Error removing license', 'License API', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to remove license' 
    });
  }
});

export default router;

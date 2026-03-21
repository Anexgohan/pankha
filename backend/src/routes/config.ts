import { Router } from 'express';
import { log } from '../utils/logger';
import { getHubConfig } from '../utils/hubConfig';
import { getPankhaMode, isDemoMode } from '../utils/mode';

const router = Router();

/**
 * GET /api/config/deployment
 * Returns deployment-related configuration (DB > env var > default).
 * Used by the frontend to populate the Hub URL selector.
 */
router.get('/deployment', async (req, res) => {
  try {
    const { hubIpInternal, hubIpExternal, hubPort } = await getHubConfig();
    const pankhaMode = getPankhaMode();
    const demoMode = isDemoMode();

    log.debug(
      `Deployment config requested: internal=${hubIpInternal}, external=${hubIpExternal}, port=${hubPort}, mode=${pankhaMode ?? "unset"}`,
      'config'
    );

    res.json({
      hubIp: hubIpInternal,
      hubIpExternal,
      hubPort,
      pankhaMode,
      isDemoMode: demoMode,
    });
  } catch (error) {
    log.error('Error fetching deployment config:', 'config', error);
    res.status(500).json({ error: 'Failed to fetch deployment config' });
  }
});

export default router;

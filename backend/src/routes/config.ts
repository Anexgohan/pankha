import { Router } from 'express';
import { log } from '../utils/logger';
import { getPankhaMode, isDemoMode } from '../utils/mode';

const router = Router();

/**
 * GET /api/config/deployment
 * Returns deployment-related configuration from environment variables.
 * Used by the frontend to populate the Hub URL selector.
 */
router.get('/deployment', (req, res) => {
  const hubIp = process.env.PANKHA_HUB_IP || null;
  const hubPort = process.env.PANKHA_PORT || '3000';
  const pankhaMode = getPankhaMode();
  const demoMode = isDemoMode();

  log.debug(
    `Deployment config requested: hubIp=${hubIp}, hubPort=${hubPort}, mode=${pankhaMode ?? "unset"}`,
    'config'
  );

  res.json({
    hubIp,
    hubPort,
    pankhaMode,
    isDemoMode: demoMode,
  });
});

export default router;

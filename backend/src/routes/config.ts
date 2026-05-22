import { Router } from 'express';
import { log } from '../utils/logger';
import { getPankhaMode, isDemoMode } from '../utils/mode';

const router = Router();

/**
 * GET /api/config/deployment
 * Returns deployment-related configuration from env vars.
 * Used by the frontend to populate the Hub URL selector.
 */
router.get('/deployment', (req, res) => {
  const hubIp = process.env.PANKHA_HUB_IP || null;
  const hubPort = process.env.PANKHA_PORT || '3143';
  const pankhaMode = getPankhaMode();
  const demoMode = isDemoMode();

  log.debug(
    `Deployment config requested: ip=${hubIp}, port=${hubPort}, mode=${pankhaMode ?? "unset"}`,
    'config'
  );

  res.json({
    hubIp,
    hubPort,
    pankhaMode,
    isDemoMode: demoMode,
  });
});

/**
 * GET /api/config/deployment.js
 * Boot-time config script - loaded by index.html before the React bundle.
 * Sets window.__PANKHA_CONFIG__ synchronously so isDemoMode and other
 * boot-derived values are known at first paint (no fetch flicker).
 */
router.get('/deployment.js', (req, res) => {
  const config = {
    hubIp: process.env.PANKHA_HUB_IP || null,
    hubPort: process.env.PANKHA_PORT || '3143',
    pankhaMode: getPankhaMode(),
    isDemoMode: isDemoMode(),
  };
  // Escape `<` so a hostile env value can't break out of </script>
  const safeJson = JSON.stringify(config).replace(/</g, '\\u003c');
  res.set('Content-Type', 'application/javascript');
  res.set('Cache-Control', 'no-store');
  res.send(`window.__PANKHA_CONFIG__ = ${safeJson};`);
});

export default router;

/**
 * Deploy Profiles Router — BMC Profile API
 *
 * Mounted at /api/deploy/profiles/* inside deploy.ts
 *
 * Endpoints:
 *   GET  /api/deploy/profiles                    — Vendor/model catalog (frontend dropdowns)
 *   GET  /api/deploy/profiles/refresh            — Refresh catalog from disk
 *   GET  /api/deploy/profiles/:vendor/:model     — Resolved profile details (frontend preview)
 *   GET  /api/deploy/profiles/assigned/:agentId  — Agent fetches its assigned profile (Option B)
 *   PUT  /api/deploy/profiles/assign/:agentId    — Admin assigns/changes profile for an agent
 */

import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { log } from '../utils/logger';
import Database from '../database/database';
import { ProfileService } from '../services/ProfileService';
import { CommandDispatcher } from '../services/CommandDispatcher';

const router = Router();
const db = Database.getInstance();
const commandDispatcher = CommandDispatcher.getInstance();

/**
 * GET /api/deploy/profiles
 * Returns vendor/model catalog for frontend profile selection dropdowns.
 */
router.get('/', (req, res) => {
  try {
    const profileService = ProfileService.getInstance();
    const catalog = profileService.getCatalog();
    res.json(catalog);
  } catch (error) {
    log.error('Failed to get profile catalog:', 'deploy-profiles', error);
    res.status(500).json({ error: 'Failed to load profile catalog' });
  }
});

/**
 * GET /api/deploy/profiles/refresh
 * Refresh the profile catalog from disk (for development / hot-reload).
 */
router.get('/refresh', (req, res) => {
  try {
    const profileService = ProfileService.getInstance();
    profileService.refresh();
    const catalog = profileService.getCatalog();
    res.json({
      message: 'Profile catalog refreshed',
      vendor_count: catalog.vendors.length,
      profile_count: catalog.vendors.reduce((sum, v) => sum + v.models.length, 0),
    });
  } catch (error) {
    log.error('Failed to refresh profile catalog:', 'deploy-profiles', error);
    res.status(500).json({ error: 'Failed to refresh profile catalog' });
  }
});

/**
 * GET /api/deploy/profiles/assigned/:agentId
 * Agent calls this on startup to fetch its assigned resolved profile.
 * This is the core Option B endpoint.
 *
 * Returns:
 *   200 + resolved profile JSON (extends fully merged)
 *   404 if no profile is assigned to this agent
 */
router.get('/assigned/:agentId', async (req, res) => {
  try {
    const { agentId } = req.params;

    const system = await db.get(
      'SELECT profile_id FROM systems WHERE agent_id = $1',
      [agentId]
    );

    if (!system || !system.profile_id) {
      return res.status(404).json({ error: 'No profile assigned to this agent' });
    }

    const profileService = ProfileService.getInstance();
    const profile = profileService.getResolvedProfile(system.profile_id);

    if (!profile) {
      log.warn(
        `Agent ${agentId} has profile_id "${system.profile_id}" but profile not found on disk`,
        'deploy-profiles'
      );
      return res.status(404).json({
        error: 'Assigned profile not found on server',
        profile_id: system.profile_id,
      });
    }

    log.debug(`Serving profile "${system.profile_id}" to agent ${agentId}`, 'deploy-profiles');
    // Inject profile_id into metadata so the agent can self-report it on registration
    const enriched = {
      ...profile,
      metadata: { ...profile.metadata, profile_id: system.profile_id },
    };
    res.json(enriched);
  } catch (error) {
    log.error('Failed to serve assigned profile:', 'deploy-profiles', error);
    res.status(500).json({ error: 'Failed to fetch assigned profile' });
  }
});

/**
 * PUT /api/deploy/profiles/assign/:agentId
 * Admin assigns or changes a profile for an agent.
 * After the DB update, fires a reloadProfile WebSocket command so an online
 * agent hot-reloads immediately. If the agent is offline the command fails
 * silently — the registration-time mismatch detector in WebSocketHub will
 * push reloadProfile on the agent's next reconnect.
 */
router.put('/assign/:agentId', async (req, res) => {
  try {
    const { agentId } = req.params;
    const { profile_id } = req.body;

    if (!profile_id) {
      return res.status(400).json({ error: 'profile_id is required' });
    }

    // Validate profile exists
    const profileService = ProfileService.getInstance();
    const profile = profileService.getResolvedProfile(profile_id);
    if (!profile) {
      return res.status(404).json({ error: `Profile "${profile_id}" not found` });
    }

    // Update systems table
    const result = await db.run(
      `UPDATE systems SET profile_id = $1, agent_type = 'ipmi_host' WHERE agent_id = $2`,
      [profile_id, agentId]
    );

    if ((result.rowCount ?? 0) === 0) {
      return res.status(404).json({ error: `Agent "${agentId}" not found in systems table` });
    }

    log.info(`Assigned profile "${profile_id}" to agent ${agentId}`, 'deploy-profiles');

    commandDispatcher.reloadProfile(agentId).catch((err) => {
      log.debug(
        `reloadProfile push failed for ${agentId} (likely offline); mismatch detector will fire on reconnect: ${err?.message ?? err}`,
        'deploy-profiles'
      );
    });

    res.json({ success: true, profile_id, agent_id: agentId });
  } catch (error) {
    log.error('Failed to assign profile:', 'deploy-profiles', error);
    res.status(500).json({ error: 'Failed to assign profile' });
  }
});

/**
 * POST /api/deploy/profiles/custom
 * Save a custom profile built via the Profile Builder UI.
 * Writes to backend/profiles/custom/{vendor}/{filename}.json
 * Body: { profile: <full profile JSON>, filename: "x570_taichi" }
 */
router.post('/custom', async (req, res) => {
  try {
    const { profile, filename } = req.body;

    if (!profile || !filename) {
      return res.status(400).json({ error: 'Missing profile or filename' });
    }

    // Validate required fields
    const vendor = profile.metadata?.vendor;
    if (!vendor || typeof vendor !== 'string') {
      return res.status(400).json({ error: 'Profile must have metadata.vendor' });
    }

    if (!profile.metadata || typeof profile.metadata !== 'object') {
      return res.status(400).json({ error: 'Profile must have metadata' });
    }

    // Builder-created profiles always start as experimental until curated.
    profile.metadata.profile_tier = 'experimental';

    // Sanitize vendor and filename to prevent path traversal
    const safeVendor = vendor.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    const safeFilename = filename.toLowerCase().replace(/[^a-z0-9_-]/g, '_');

    // Write to backend/profiles/{vendor}/user-profile/{filename}.json
    // Separated from official profiles — scanner picks up user-profile/ subdirs
    const userProfileDir = path.join(__dirname, '..', '..', 'profiles', safeVendor, 'user-profile');
    fs.mkdirSync(userProfileDir, { recursive: true });

    const filePath = path.join(userProfileDir, `${safeFilename}.json`);
    fs.writeFileSync(filePath, JSON.stringify(profile, null, 2), 'utf-8');

    // Refresh catalog so the new profile is immediately available
    const profileService = ProfileService.getInstance();
    profileService.refresh();

    const profileId = `${safeVendor}/user-profile/${safeFilename}`;
    log.info(`Custom profile saved: ${profileId} at ${filePath}`, 'deploy-profiles');

    res.json({
      success: true,
      profile_id: profileId,
      path: filePath,
    });
  } catch (error) {
    log.error('Failed to save custom profile:', 'deploy-profiles', error);
    res.status(500).json({ error: 'Failed to save custom profile' });
  }
});

/**
 * GET /api/deploy/profiles/:vendor/:model
 * Returns resolved profile details for frontend preview (AIO builder match card).
 */
router.get('/:vendor/:model', (req, res) => {
  try {
    const { vendor, model } = req.params;
    const profileId = `${vendor}/${model}`;

    const profileService = ProfileService.getInstance();
    const profile = profileService.getResolvedProfile(profileId);

    if (!profile) {
      return res.status(404).json({ error: `Profile "${profileId}" not found`, matched: false });
    }

    const ipmi = profile.protocols?.ipmi;
    const zones = (ipmi?.fan_zones || []).map((z: any) => ({
      id: z.id,
      name: z.name,
      members: z.members,
    }));
    const hasReadSpeed = (ipmi?.fan_zones || []).some(
      (z: any) => z.commands?.read_speed
    );
    const firstZone = ipmi?.fan_zones?.[0];
    const profileTier =
      profile.metadata?.profile_tier ||
      (profileId.includes('/user-profile/') ? 'experimental' : 'official');
    const isMonitorOnly = (ipmi?.fan_zones || []).length === 0;

    res.json({
      matched: true,
      profile_id: profileId,
      description: profile.metadata?.description || '',
      author: profile.metadata?.author || 'Unknown',
      vendor: profile.metadata?.vendor || vendor,
      model_family: profile.metadata?.model_family || [],
      profile_tier: profileTier,
      is_monitor_only: isMonitorOnly,
      zones,
      has_read_speed: hasReadSpeed,
      speed_translation_type: firstZone?.speed_translation?.type || 'unknown',
    });
  } catch (error) {
    log.error('Failed to get profile details:', 'deploy-profiles', error);
    res.status(500).json({ error: 'Failed to load profile details' });
  }
});

export default router;

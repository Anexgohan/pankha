import Database from '../database/database';

/**
 * Hub Configuration Helper
 *
 * Resolves hub connection settings with priority: DB > env var > default.
 * Used by config.ts and deploy.ts routes.
 */
export async function getHubConfig(): Promise<{
  hubIpInternal: string | null;
  hubIpExternal: string | null;
  hubPort: string;
}> {
  const db = Database.getInstance();

  const [ipInternal, ipExternal, port] = await Promise.all([
    db.get("SELECT setting_value FROM backend_settings WHERE setting_key = 'hub_ip_internal'"),
    db.get("SELECT setting_value FROM backend_settings WHERE setting_key = 'hub_ip_external'"),
    db.get("SELECT setting_value FROM backend_settings WHERE setting_key = 'hub_port'"),
  ]);

  return {
    hubIpInternal: ipInternal?.setting_value || process.env.PANKHA_HUB_IP || null,
    hubIpExternal: ipExternal?.setting_value || null,
    hubPort: port?.setting_value || process.env.PANKHA_PORT || '3000',
  };
}

/**
 * Seed hub config into DB from env vars on first boot.
 * Only writes if the DB key doesn't already exist.
 */
export async function seedHubConfig(): Promise<void> {
  const db = Database.getInstance();

  const seeds: { key: string; value: string | undefined; desc: string }[] = [
    { key: 'hub_ip_internal', value: process.env.PANKHA_HUB_IP, desc: 'Internal/LAN IP for agent connections' },
    { key: 'hub_port', value: process.env.PANKHA_PORT, desc: 'Port for agent connections (external-facing)' },
  ];

  for (const { key, value, desc } of seeds) {
    if (!value) continue;
    const existing = await db.get("SELECT setting_value FROM backend_settings WHERE setting_key = $1", [key]);
    if (!existing) {
      await db.run(
        `INSERT INTO backend_settings (setting_key, setting_value, description)
         VALUES ($1, $2, $3)
         ON CONFLICT (setting_key) DO NOTHING`,
        [key, value, desc]
      );
    }
  }
}

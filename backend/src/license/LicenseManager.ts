/**
 * LicenseManager - Manages license validation, caching, and tier enforcement
 * 
 * This service handles:
 * - License key validation (via LicenseValidator)
 * - Caching validation results (24 hours)
 * - Fallback to local database if API is unreachable
 * - Convenience methods for checking tier limits
 */

import { LicenseValidator, ValidationResult } from './LicenseValidator';
import { TIERS, TierConfig, getTier } from './tiers';
import Database from '../database/database';

export class LicenseManager {
  private validator: LicenseValidator;
  private cachedTier: TierConfig;
  private cacheExpiry: Date;
  private licenseExpiresAt: Date | null = null;  // License expiration date
  private licenseActivatedAt: Date | null = null;  // When license was issued
  private licenseBilling: 'monthly' | 'yearly' | 'lifetime' | null = null;
  private customerName: string | null = null;
  private customerEmail: string | null = null;
  private licenseId: string | null = null;  // License ID for /status lookups
  private nextBillingDate: Date | null = null;  // Next payment date (subscriptions)
  private discountCode: string | null = null;  // Applied promo code
  private discountCyclesRemaining: number | null = null;  // Remaining discounted renewals
  private lastSyncAt: Date | null = null;  // Last successful sync with license server
  private readonly CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours
  private readonly LICENSE_API_URL = 'https://license.pankha.app';

  constructor() {
    this.validator = new LicenseValidator();
    this.cachedTier = TIERS.free;
    this.cacheExpiry = new Date(0); // Expired by default
  }

  /**
   * Get database pool (lazy access to avoid initialization order issues)
   */
  private getPool() {
    return Database.getInstance().getPool();
  }

  /**
   * Initialize license manager - load and validate stored license key
   */
  async initialize(): Promise<void> {
    try {
      const result = await this.getPool().query(
        'SELECT license_key FROM license_config WHERE id = 1'
      );

      if (result.rows.length > 0 && result.rows[0].license_key) {
        await this.validateAndCache(result.rows[0].license_key);
        console.log(`[LicenseManager] Initialized with tier: ${this.cachedTier.name}`);

        // Auto-sync on startup for paid subscriptions to get nextBillingDate, discountCode, etc.
        if (this.cachedTier.name !== 'Free' && this.licenseBilling !== 'lifetime' && this.licenseId) {
          console.log('[LicenseManager] Syncing subscription data...');
          await this.syncWithLicenseServer();
        }
      } else {
        console.log('[LicenseManager] No license key found, using free tier');
      }
    } catch (error) {
      console.error('[LicenseManager] Initialization error:', error);
      // Continue with free tier
    }
  }

  /**
   * Set a new license key and validate it
   */
  async setLicenseKey(key: string): Promise<{ success: boolean; tier: string; error?: string }> {
    const result = await this.validator.validate(key);
    
    if (!result.valid) {
      return { success: false, tier: 'free', error: result.error };
    }

    try {
      // Save to database
      await this.getPool().query(`
        INSERT INTO license_config (id, license_key, updated_at)
        VALUES (1, $1, NOW())
        ON CONFLICT (id) DO UPDATE SET license_key = $1, updated_at = NOW()
      `, [key]);

      // Cache locally
      await this.cacheResult(key, result);

      return { success: true, tier: result.tier };
    } catch (error) {
      console.error('[LicenseManager] Failed to save license:', error);
      return { success: false, tier: 'free', error: 'Failed to save license' };
    }
  }

  /**
   * Remove license key and revert to free tier
   */
  async removeLicense(): Promise<{ success: boolean; error?: string }> {
    try {
      // Delete from database
      await this.getPool().query('DELETE FROM license_config WHERE id = 1');

      // Reset to free tier
      this.cachedTier = TIERS.free;
      this.licenseActivatedAt = null;
      this.licenseExpiresAt = null;
      this.licenseBilling = null;
      this.customerName = null;
      this.customerEmail = null;
      this.licenseId = null;
      this.cacheExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      console.log('[LicenseManager] License removed, reverted to free tier');
      return { success: true };
    } catch (error) {
      console.error('[LicenseManager] Failed to remove license:', error);
      return { success: false, error: 'Failed to remove license' };
    }
  }

  /**
   * Get current tier configuration (from cache or re-validate)
   */
  async getCurrentTier(): Promise<TierConfig> {
    if (new Date() < this.cacheExpiry) {
      return this.cachedTier;
    }

    // Re-validate if cache expired
    try {
      const result = await this.getPool().query(
        'SELECT license_key FROM license_config WHERE id = 1'
      );
      
      if (result.rows.length > 0 && result.rows[0].license_key) {
        await this.validateAndCache(result.rows[0].license_key);
      }
    } catch (error) {
      console.error('[LicenseManager] Re-validation failed:', error);
      // Keep using cached tier
    }

    return this.cachedTier;
  }

  /**
   * Get current tier name
   */
  async getTierName(): Promise<string> {
    return (await this.getCurrentTier()).name;
  }

  /**
   * Get agent limit for current tier
   */
  async getAgentLimit(): Promise<number> {
    return (await this.getCurrentTier()).agentLimit;
  }

  /**
   * Get data retention days for current tier
   */
  async getRetentionDays(): Promise<number> {
    return (await this.getCurrentTier()).retentionDays;
  }

  /**
   * Get alert limit for current tier
   */
  async getAlertLimit(): Promise<number> {
    return (await this.getCurrentTier()).alertLimit;
  }

  /**
   * Check if API access is enabled
   */
  async hasApiAccess(level: 'read' | 'full' = 'read'): Promise<boolean> {
    const tier = await this.getCurrentTier();
    if (level === 'full') return tier.apiAccess === 'full';
    return tier.apiAccess !== 'none';
  }

  /**
   * Check if branding should be shown
   */
  async shouldShowBranding(): Promise<boolean> {
    return (await this.getCurrentTier()).showBranding;
  }

  /**
   * Get full license info for API response
   */
  async getLicenseInfo(): Promise<{
    tier: string;
    billing: string | null;
    customerName: string | null;
    customerEmail: string | null;
    licenseId: string | null;
    agentLimit: number;
    retentionDays: number;
    alertLimit: number;
    alertChannels: string[];
    apiAccess: string;
    showBranding: boolean;
    expiresAt: string | null;
    activatedAt: string | null;
    nextBillingDate: string | null;
    discountCode: string | null;
    discountCyclesRemaining: number | null;
    lastSyncAt: string | null;
  }> {
    // Check if auto-sync is needed before returning info
    await this.checkAutoSync();

    const tier = await this.getCurrentTier();
    return {
      tier: tier.name,
      billing: this.licenseBilling,
      customerName: this.customerName,
      customerEmail: this.customerEmail,
      licenseId: this.licenseId,
      agentLimit: tier.agentLimit === Infinity ? -1 : tier.agentLimit,
      retentionDays: tier.retentionDays,
      alertLimit: tier.alertLimit === Infinity ? -1 : tier.alertLimit,
      alertChannels: tier.alertChannels,
      apiAccess: tier.apiAccess,
      showBranding: tier.showBranding,
      expiresAt: this.licenseExpiresAt ? this.licenseExpiresAt.toISOString() : null,
      activatedAt: this.licenseActivatedAt ? this.licenseActivatedAt.toISOString() : null,
      nextBillingDate: this.nextBillingDate ? this.nextBillingDate.toISOString() : null,
      discountCode: this.discountCode,
      discountCyclesRemaining: this.discountCyclesRemaining,
      lastSyncAt: this.lastSyncAt ? this.lastSyncAt.toISOString() : null,
    };
  }

  /**
   * Sync license status with license server (Cloudflare Worker)
   * Called manually by user or automatically based on time-to-expiry
   */
  async syncWithLicenseServer(): Promise<{
    success: boolean;
    changed: boolean;
    upgraded?: boolean;
    newExpiresAt?: Date;
    nextBillingDate?: Date | null;
    discountCode?: string;
    discountCyclesRemaining?: number;
    error?: string;
  }> {
    // Skip sync for free tier or lifetime licenses
    if (this.cachedTier.name === 'Free' || this.licenseBilling === 'lifetime') {
      return { success: true, changed: false };
    }

    // Need licenseId to sync
    if (!this.licenseId) {
      return { success: true, changed: false };
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

      const response = await fetch(`${this.LICENSE_API_URL}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ licenseId: this.licenseId }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = await response.text();
        console.error('[LicenseManager] Sync failed:', error);
        return { success: false, changed: false, error: 'License server error' };
      }

      const status = await response.json() as {
        found: boolean;
        expiresAt?: string;
        nextBillingDate?: string;
        discountCode?: string;
        discountCyclesRemaining?: number;
        upgradeToken?: string;
      };

      if (!status.found) {
        return { success: true, changed: false };
      }

      // Auto-upgrade: if server returns an upgradeToken, activate the new license
      if (status.upgradeToken) {
        console.log('[LicenseManager] Auto-upgrade detected! Activating new license...');
        const upgradeResult = await this.setLicenseKey(status.upgradeToken);
        if (upgradeResult.success) {
          console.log(`[LicenseManager] Auto-upgrade successful: now on ${upgradeResult.tier} tier`);
          // Sync again to fetch D1 metadata (discount, billing date, etc.) for the new license.
          // No recursion risk: the new license won't have an upgradeToken.
          const followUp = await this.syncWithLicenseServer();
          console.log(`[LicenseManager] Post-upgrade sync: discountCode=${followUp.discountCode || 'none'}`);
          return { success: true, changed: true, upgraded: true };
        } else {
          console.error(`[LicenseManager] Auto-upgrade failed: ${upgradeResult.error}`);
          // Fall through to normal sync logic
        }
      }

      // Check if expiry date changed
      const serverExpiry = status.expiresAt && status.expiresAt !== 'NA'
        ? new Date(status.expiresAt)
        : null;

      const currentExpiry = this.licenseExpiresAt;
      const changed = serverExpiry && currentExpiry &&
        serverExpiry.getTime() !== currentExpiry.getTime();

      if (changed && serverExpiry) {
        // Update cached expiry - renewal detected!
        this.licenseExpiresAt = serverExpiry;
        this.cacheExpiry = new Date(Date.now() + this.CACHE_DURATION_MS);
        console.log(`[LicenseManager] Expiry updated via sync: ${serverExpiry.toISOString()}`);
      }

      // Update other fields
      this.nextBillingDate = status.nextBillingDate && status.nextBillingDate !== 'NA'
        ? new Date(status.nextBillingDate)
        : null;
      this.discountCode = status.discountCode || null;
      this.discountCyclesRemaining = status.discountCyclesRemaining ?? null;
      this.lastSyncAt = new Date();

      return {
        success: true,
        changed: !!changed,
        newExpiresAt: serverExpiry || undefined,
        nextBillingDate: this.nextBillingDate,
        discountCode: this.discountCode || undefined,
        discountCyclesRemaining: this.discountCyclesRemaining ?? undefined
      };

    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.error('[LicenseManager] Sync timeout');
        return { success: false, changed: false, error: 'Timeout' };
      }
      console.error('[LicenseManager] Sync error:', error);
      return {
        success: false,
        changed: false,
        error: error instanceof Error ? error.message : 'Network error'
      };
    }
  }

  /**
   * Check if auto-sync is needed based on time-to-expiry
   * Progressive frequency: closer to expiry = more frequent syncs
   *
   * Schedule:
   * - 7+ days out: every 24 hours
   * - 3-7 days out: every 24 hours
   * - 2-3 days out: every 12 hours
   * - 1-2 days out: every 6 hours
   * - 12h-1 day out: every 1 hour
   * - < 12 hours out: every 15 minutes
   */
  private async checkAutoSync(): Promise<void> {
    // Skip for free tier or lifetime
    if (this.cachedTier.name === 'Free' || this.licenseBilling === 'lifetime') {
      return;
    }

    // Need expiry date and licenseId
    if (!this.licenseExpiresAt || !this.licenseId) {
      return;
    }

    const now = Date.now();
    const expiryTime = this.licenseExpiresAt.getTime();
    const timeToExpiry = expiryTime - now;
    const lastSync = this.lastSyncAt?.getTime() || 0;
    const timeSinceLastSync = now - lastSync;

    // Calculate required sync interval based on time-to-expiry
    let requiredInterval: number | null = null;

    const HOUR = 60 * 60 * 1000;
    const DAY = 24 * HOUR;

    if (timeToExpiry <= 12 * HOUR) {
      requiredInterval = 15 * 60 * 1000; // 15 minutes
    } else if (timeToExpiry <= 1 * DAY) {
      requiredInterval = 1 * HOUR; // 1 hour
    } else if (timeToExpiry <= 2 * DAY) {
      requiredInterval = 6 * HOUR; // 6 hours
    } else if (timeToExpiry <= 3 * DAY) {
      requiredInterval = 12 * HOUR; // 12 hours
    } else if (timeToExpiry <= 7 * DAY) {
      requiredInterval = 24 * HOUR; // 24 hours
    } else {
      requiredInterval = 24 * HOUR; // 7+ days: sync once per day
    }

    // Sync if interval exceeded
    if (requiredInterval && timeSinceLastSync >= requiredInterval) {
      console.log(`[LicenseManager] Auto-sync triggered (${Math.round(timeToExpiry / HOUR)}h to expiry, ${Math.round(timeSinceLastSync / 60000)}min since last sync)`);
      await this.syncWithLicenseServer();
    }
  }

  /**
   * Get stored license key from database
   */
  private async getStoredLicenseKey(): Promise<string | null> {
    try {
      const result = await this.getPool().query(
        'SELECT license_key FROM license_config WHERE id = 1'
      );
      return result.rows[0]?.license_key || null;
    } catch {
      return null;
    }
  }

  /**
   * Validate license key and update cache
   */
  private async validateAndCache(key: string): Promise<void> {
    try {
      const result = await this.validator.validate(key);
      await this.cacheResult(key, result);
    } catch (error) {
      console.error('[LicenseManager] Validation error, using cached value');
      // Try to load from local cache
      await this.loadFromLocalCache(key);
    }
  }

  /**
   * Cache validation result in memory and database
   */
  private async cacheResult(key: string, result: ValidationResult): Promise<void> {
    const tier = result.valid ? result.tier : 'free';
    this.cachedTier = getTier(tier);
    this.cacheExpiry = new Date(Date.now() + this.CACHE_DURATION_MS);
    this.licenseExpiresAt = result.expiresAt;  // Store license expiry date
    this.licenseActivatedAt = result.activatedAt;  // Store license issued date
    this.licenseBilling = result.billing || null;  // Store billing period
    this.customerName = result.customerName || null;  // Store customer name
    this.customerEmail = result.customerEmail || null;  // Store customer email
    this.licenseId = result.licenseId || null;  // Store license ID for /status lookups

    // Persist to database for offline resilience
    try {
      // Convert Infinity to -1 for PostgreSQL (INTEGER column can't store Infinity)
      const agentLimit = this.cachedTier.agentLimit === Infinity ? -1 : this.cachedTier.agentLimit;
      
      await this.getPool().query(`
        INSERT INTO licenses (license_key, tier, agent_limit, retention_days, validated_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (license_key) DO UPDATE SET
          tier = $2, agent_limit = $3, retention_days = $4, validated_at = NOW()
      `, [key, tier, agentLimit, this.cachedTier.retentionDays]);
    } catch (error) {
      console.error('[LicenseManager] Failed to cache result:', error);
    }
  }

  /**
   * Load tier from local database cache (fallback)
   */
  private async loadFromLocalCache(key: string): Promise<void> {
    try {
      const result = await this.getPool().query(
        'SELECT tier FROM licenses WHERE license_key = $1',
        [key]
      );
      
      if (result.rows.length > 0) {
        this.cachedTier = getTier(result.rows[0].tier);
        this.cacheExpiry = new Date(Date.now() + this.CACHE_DURATION_MS);
      }
    } catch (error) {
      console.error('[LicenseManager] Failed to load from cache:', error);
      this.cachedTier = TIERS.free;
    }
  }
}

// Singleton instance
export const licenseManager = new LicenseManager();

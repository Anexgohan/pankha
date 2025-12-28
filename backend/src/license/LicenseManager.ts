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
  private readonly CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

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
    agentLimit: number;
    retentionDays: number;
    alertLimit: number;
    alertChannels: string[];
    apiAccess: string;
    showBranding: boolean;
  }> {
    const tier = await this.getCurrentTier();
    return {
      tier: tier.name,
      agentLimit: tier.agentLimit === Infinity ? -1 : tier.agentLimit,
      retentionDays: tier.retentionDays,
      alertLimit: tier.alertLimit === Infinity ? -1 : tier.alertLimit,
      alertChannels: tier.alertChannels,
      apiAccess: tier.apiAccess,
      showBranding: tier.showBranding,
    };
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

    // Persist to database for offline resilience
    try {
      await this.getPool().query(`
        INSERT INTO licenses (license_key, tier, agent_limit, retention_days, validated_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (license_key) DO UPDATE SET
          tier = $2, agent_limit = $3, retention_days = $4, validated_at = NOW()
      `, [key, tier, this.cachedTier.agentLimit, this.cachedTier.retentionDays]);
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

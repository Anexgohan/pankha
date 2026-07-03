/**
 * LicenseManager - Manages license validation, caching, and tier enforcement
 * 
 * This service handles:
 * - License key validation (via LicenseValidator)
 * - Caching validation results (24 hours)
 * - Fallback to local database if API is unreachable
 * - Convenience methods for checking tier limits
 */

import { LicenseValidator, ValidationResult, GRACE_PERIOD_SECONDS } from './LicenseValidator';
import { TIERS, TierConfig, getTier } from './tiers';
import { LICENSE_API_URL } from './license-config';
import Database from '../database/database';
import { log } from '../utils/logger';
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';

export class LicenseManager extends EventEmitter {
  private validator: LicenseValidator;
  private cachedTier: TierConfig;
  private cacheExpiry: Date;
  private licenseExpiresAt: Date | null = null;  // License expiration date
  private licenseActivatedAt: Date | null = null;  // When license was issued
  private licenseBilling: 'monthly' | 'yearly' | 'lifetime' | null = null;
  private customerName: string | null = null;
  private customerEmail: string | null = null;
  private licenseId: string | null = null;  // License ID for /status lookups
  private subscriptionId: string | null = null;  // From JWT `sid` claim - Dodo subscription identifier (subscriptions only)
  private customerId: string | null = null;  // Dodo persistent customer identifier (from /status sync)
  private licenseKey: string | null = null;  // Raw JWT token - exposed read-only via getLicenseInfo for user copy/backup
  private nextBillingDate: Date | null = null;  // Next payment date (subscriptions)
  private discountCode: string | null = null;  // Applied promo code
  private discountCyclesRemaining: number | null = null;  // Remaining discounted renewals
  private periodInterval: string | null = null;  // From JWT period_interval claim - billing cadence display ("Day"|"Week"|"Month"|"Year")
  private periodCount: number | null = null;     // From JWT period_count claim - e.g. 1, 7
  private instanceId: string | null = null;  // Stable per-install identity for seat binding (persisted in license_config)
  private seatState: 'bound' | 'lost' | null = null;  // null = never bound / bind-exempt; 'lost' = seat held elsewhere (soft demote)
  private cancelScheduledAt: Date | null = null;  // When cancel-at-period-end was requested (from /status)
  private lastSyncAt: Date | null = null;  // Last successful sync with license server
  private readonly CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours
  // Autonomous background sync loop (self-rescheduling; see startAutoSync)
  private autoSyncTimer: ReturnType<typeof setTimeout> | null = null;
  private autoSyncInProgress = false;        // guards against overlapping ticks
  private autoSyncStopped = true;            // false only while the loop is running
  private readonly AUTO_SYNC_IDLE_INTERVAL_MS = 6 * 60 * 60 * 1000; // re-check cadence when no paid token / expiry unknown

  constructor() {
    super();
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
   * Whether we have a stored token from a paid (non-lifetime) purchase.
   * Drives sync eligibility independently of the current cached tier - so
   * a token that expired past grace can still recover via /status.
   */
  private hasPaidTokenOnFile(): boolean {
    return this.licenseId !== null
      && this.licenseBilling !== null
      && this.licenseBilling !== 'lifetime';
  }

  /**
   * Initialize license manager - load and validate stored license key
   */
  async initialize(): Promise<void> {
    try {
      const result = await this.getPool().query(
        'SELECT license_key, last_sync_at, instance_id, seat_state FROM license_config WHERE id = 1'
      );

      if (result.rows.length > 0) {
        // Load install identity + seat state before validation so the
        // seat-lost demotion applies from the first cacheResult (task_07)
        if (result.rows[0].instance_id) {
          this.instanceId = result.rows[0].instance_id;
        }
        this.seatState = result.rows[0].seat_state || null;
      }

      if (result.rows.length > 0 && result.rows[0].license_key) {
        // Load persisted lastSyncAt before sync so checkAutoSync can honor cooldown
        if (result.rows[0].last_sync_at) {
          this.lastSyncAt = new Date(result.rows[0].last_sync_at);
        }

        await this.validateAndCache(result.rows[0].license_key);
        log.info(`Initialized with tier: ${this.cachedTier.name}`, 'LicenseManager');

        // One-time seat bind (task_07): covers grandfathered installs and
        // lifetime licenses (which never sync). Best-effort - a network
        // failure leaves seatState NULL and we retry next boot.
        if (this.licenseId && this.seatState === null) {
          await this.ensureSeatBound(result.rows[0].license_key);
        }

        // Auto-sync on startup if we have a paid token on file (active OR
        // recently expired) to detect Dodo-side renewals during downtime.
        if (this.hasPaidTokenOnFile()) {
          log.info('Syncing subscription data...', 'LicenseManager');
          await this.syncWithLicenseServer();
        }
      } else {
        log.info('No license key found, using free tier', 'LicenseManager');
      }
    } catch (error) {
      log.error('Initialization error', 'LicenseManager', error);
      // Continue with free tier
    }
  }

  /**
   * Set a new license key and validate it.
   *
   * task_07 additions:
   * - Recovery: a signature-valid but hard-expired token still proves
   *   ownership of the lid; the ledger may hold a fresher JWT this install
   *   never saw (renewals while offline, fresh install with an old key).
   * - Seat binding: every paid activation binds (or confirms) the seat via
   *   the worker before persisting. Worker unreachable fails loud -
   *   activation is the one online-required step. 404 = CLI-minted token
   *   (not in the ledger) -> bind-exempt.
   */
  async setLicenseKey(key: string, opts: { forceSeat?: boolean; recovered?: boolean } = {}): Promise<{
    success: boolean;
    tier: string;
    error?: string;
    seatConflict?: boolean;
    boundAt?: string | null;
    canForce?: boolean;
  }> {
    const result = await this.validator.validate(key);

    if (!result.valid) {
      if (!opts.recovered && result.error === 'License expired' && result.licenseId) {
        const replacement = await this.fetchReplacementForToken(key);
        if (replacement) {
          log.info('Recovered current token via /status (expired key presented)', 'LicenseManager');
          return this.setLicenseKey(replacement, { ...opts, recovered: true });
        }
      }
      return { success: false, tier: 'free', error: result.error };
    }

    const bind = await this.bindSeat(key, opts.forceSeat === true);
    if (!bind.ok) {
      if (bind.seatConflict) {
        return {
          success: false,
          tier: 'free',
          error: bind.error || 'License is already in use on another system',
          seatConflict: true,
          boundAt: bind.boundAt ?? null,
          canForce: bind.canForce === true,
        };
      }
      return { success: false, tier: 'free', error: bind.error || 'License server unreachable' };
    }
    await this.setSeatState(bind.bindExempt ? null : 'bound');

    try {
      // Save to database - reset last_sync_at so the fresh license starts
      // with a clean sync history (prevents stale cooldown from prior token).
      await this.getPool().query(`
        INSERT INTO license_config (id, license_key, updated_at, last_sync_at)
        VALUES (1, $1, NOW(), NULL)
        ON CONFLICT (id) DO UPDATE SET license_key = $1, updated_at = NOW(), last_sync_at = NULL
      `, [key]);

      // Cache locally
      await this.cacheResult(key, result);
      this.lastSyncAt = null;

      // Re-pace the background loop to the new token's expiry (no-op if not started)
      this.scheduleNextAutoSync();

      // Notify connected clients to refresh (covers manual activation AND the
      // autonomous replacement path, which routes through here).
      this.emit('licenseUpdated');

      return { success: true, tier: result.tier };
    } catch (error) {
      log.error('Failed to save license', 'LicenseManager', error);
      return { success: false, tier: 'free', error: 'Failed to save license' };
    }
  }

  /**
   * Remove license key and revert to free tier
   */
  async removeLicense(): Promise<{ success: boolean; error?: string }> {
    try {
      // Release the seat first (best-effort, task_07): lets the customer
      // re-activate elsewhere without burning a force-move. Worker
      // unreachable is fine - the force-move path covers an orphaned binding.
      const storedToken = await this.getStoredLicenseKey();
      if (storedToken && this.seatState === 'bound') {
        await this.releaseSeat(storedToken);
      }

      // Clear the license but keep instance_id (stable install identity)
      await this.getPool().query(
        'UPDATE license_config SET license_key = NULL, last_sync_at = NULL, seat_state = NULL, updated_at = NOW() WHERE id = 1'
      );

      // Reset to free tier
      this.cachedTier = TIERS.free;
      this.licenseActivatedAt = null;
      this.licenseExpiresAt = null;
      this.licenseBilling = null;
      this.customerName = null;
      this.customerEmail = null;
      this.licenseId = null;
      this.subscriptionId = null;
      this.customerId = null;
      this.licenseKey = null;
      this.nextBillingDate = null;
      this.discountCode = null;
      this.discountCyclesRemaining = null;
      this.periodInterval = null;
      this.periodCount = null;
      this.seatState = null;
      this.cancelScheduledAt = null;
      this.lastSyncAt = null;
      this.cacheExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      // Loop idles now that no paid token is on file (no-op if not started)
      this.scheduleNextAutoSync();

      this.emit('licenseUpdated');

      log.info('License removed, reverted to free tier', 'LicenseManager');
      return { success: true };
    } catch (error) {
      log.error('Failed to remove license', 'LicenseManager', error);
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
      log.error('Re-validation failed', 'LicenseManager', error);
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
    subscriptionId: string | null;
    customerId: string | null;
    token: string | null;
    agentLimit: number;
    retentionDays: number;
    alertLimit: number;
    alertChannels: string[];
    apiAccess: string;
    showBranding: boolean;
    expiresAt: string | null;
    graceExpiresAt: string | null;  // expiresAt + offline grace; UI derives the Grace badge/countdown from this
    activatedAt: string | null;
    nextBillingDate: string | null;
    discountCode: string | null;
    discountCyclesRemaining: number | null;
    periodInterval: string | null;
    periodCount: number | null;
    seatState: 'bound' | 'lost' | null;
    cancelScheduledAt: string | null;
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
      subscriptionId: this.subscriptionId,
      customerId: this.customerId,
      token: this.licenseKey,
      agentLimit: tier.agentLimit === Infinity ? -1 : tier.agentLimit,
      retentionDays: tier.retentionDays,
      alertLimit: tier.alertLimit === Infinity ? -1 : tier.alertLimit,
      alertChannels: tier.alertChannels,
      apiAccess: tier.apiAccess,
      showBranding: tier.showBranding,
      expiresAt: this.licenseExpiresAt ? this.licenseExpiresAt.toISOString() : null,
      // Grace end = token exp + offline grace. Only meaningful for paid,
      // non-lifetime tokens with a known expiry; null otherwise (lifetime/free).
      graceExpiresAt: (this.licenseExpiresAt && this.licenseBilling && this.licenseBilling !== 'lifetime')
        ? new Date(this.licenseExpiresAt.getTime() + GRACE_PERIOD_SECONDS * 1000).toISOString()
        : null,
      activatedAt: this.licenseActivatedAt ? this.licenseActivatedAt.toISOString() : null,
      nextBillingDate: this.nextBillingDate ? this.nextBillingDate.toISOString() : null,
      discountCode: this.discountCode,
      discountCyclesRemaining: this.discountCyclesRemaining,
      periodInterval: this.periodInterval,
      periodCount: this.periodCount,
      seatState: this.seatState,
      cancelScheduledAt: this.cancelScheduledAt ? this.cancelScheduledAt.toISOString() : null,
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
    // Skip sync for lifetime licenses or when no paid token is on file.
    // Note: do NOT gate on cachedTier - a hard-expired paid token still
    // qualifies for sync so we can recover the renewed license from /status.
    if (!this.hasPaidTokenOnFile()) {
      return { success: true, changed: false };
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

      // Send token for ownership proof; licenseId kept for logging/correlation.
      // instanceId lets the worker return a seat verdict and claim the seat
      // for grandfathered (unbound) rows - task_07.
      const storedToken = await this.getStoredLicenseKey();
      if (!storedToken) {
        return { success: true, changed: false };
      }
      const instanceId = await this.getInstanceId();

      const response = await fetch(`${LICENSE_API_URL}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: storedToken, licenseId: this.licenseId, instanceId }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorBody = await response.text();
        log.error(`Sync failed: ${errorBody}`, 'LicenseManager');
        // Distinguish "license unknown to server" (permanent) from transient errors.
        // Worker returns 404 with {found: false, ...} when the lid is not in D1.
        let parsed: { found?: boolean } | null = null;
        try { parsed = JSON.parse(errorBody); } catch { /* non-JSON body */ }
        if (response.status === 404 && parsed?.found === false) {
          return { success: false, changed: false, error: 'License not found' };
        }
        return { success: false, changed: false, error: 'License server error' };
      }

      const status = await response.json() as {
        found: boolean;
        expiresAt?: string;
        nextBillingDate?: string;
        discountCode?: string;
        discountCyclesRemaining?: number;
        customerId?: string;
        replacementToken?: string;
        seat?: 'bound_here' | 'bound_elsewhere' | 'unbound';
        cancelScheduledAt?: string | null;
      };

      if (!status.found) {
        return { success: true, changed: false };
      }

      // Seat verdict (task_07): soft demote when the seat is held elsewhere;
      // restore when it comes back (e.g. released on the other system). The
      // worker also withholds replacementToken from non-seat callers, so a
      // shared copy hard-expires within one billing cycle.
      if (status.seat === 'bound_elsewhere') {
        if (this.seatState !== 'lost') {
          log.warn('License seat is bound to another system - demoting to Free (soft)', 'LicenseManager');
          await this.setSeatState('lost');
          this.cachedTier = TIERS.free;
          this.cacheExpiry = new Date(Date.now() + this.CACHE_DURATION_MS);
          this.emit('licenseUpdated');
        }
      } else if (status.seat === 'bound_here' && this.seatState !== 'bound') {
        const wasLost = this.seatState === 'lost';
        await this.setSeatState('bound');
        if (wasLost) {
          await this.validateAndCache(storedToken);  // restore demoted tier
          this.emit('licenseUpdated');
        }
      }

      // Same-lid token refresh: D1 holds a fresher JWT for our existing license
      // (e.g. after a Dodo subscription.renewed UPDATEd the row in place, or
      // after /renew). Identity-preserving - same lid, possibly new tier/billing
      // from a plan change. Worker enforces the lineage rules; trust the field.
      if (status.replacementToken) {
        log.info('Token replacement detected (same-lid refresh)', 'LicenseManager');
        const refreshResult = await this.setLicenseKey(status.replacementToken);
        if (refreshResult.success) {
          log.info(`Token refreshed: now on ${refreshResult.tier} tier`, 'LicenseManager');
          // Re-sync to capture updated metadata (discount, billing date, etc.).
          // Idempotent: post-refresh, status.replacementToken will be absent (hash match).
          const followUp = await this.syncWithLicenseServer();
          log.info(`Post-refresh sync: discountCode=${followUp.discountCode || 'none'}`, 'LicenseManager');
          return { success: true, changed: true, upgraded: false };
        } else {
          log.error(`Token replacement failed: ${refreshResult.error}`, 'LicenseManager');
          // Fall through to expiry-only update path below.
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
        log.info(`Expiry updated via sync: ${serverExpiry.toISOString()}`, 'LicenseManager');
        // Renewal picked up without a token swap; tell clients to refresh.
        this.emit('licenseUpdated');
      }

      // Update other fields
      this.nextBillingDate = status.nextBillingDate && status.nextBillingDate !== 'NA'
        ? new Date(status.nextBillingDate)
        : null;
      this.cancelScheduledAt = status.cancelScheduledAt
        ? new Date(status.cancelScheduledAt)
        : null;
      this.discountCode = status.discountCode || null;
      this.discountCyclesRemaining = status.discountCyclesRemaining ?? null;
      this.customerId = status.customerId || null;
      this.lastSyncAt = new Date();
      await this.persistLastSyncAt(this.lastSyncAt);

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
        log.error('Sync timeout', 'LicenseManager');
        return { success: false, changed: false, error: 'Timeout' };
      }
      log.error('Sync error', 'LicenseManager', error);
      return {
        success: false,
        changed: false,
        error: error instanceof Error ? error.message : 'Network error'
      };
    }
  }

  /**
   * Force-renew license token via Worker /renew (vendor-independent recovery path).
   *
   * Unlike syncWithLicenseServer (which reads /status to pick up existing fresher tokens),
   * this actively mints a new token via /renew. Use case: customer's token can't be
   * recovered via Sync (e.g., Dodo webhook failed to fire), customer wants to force
   * a refresh subject to the worker's cooldown (15min) + daily cap (3/day).
   *
   * D-redesign rules apply on the worker side: exp = MAX(Dodo's next_billing_date,
   * current_exp) when Dodo reachable, 24h bridge when Dodo unreachable. No
   * unilateral free extension.
   */
  async renewLicenseToken(): Promise<{
    success: boolean;
    changed: boolean;
    newExpiresAt?: Date;
    isRateLimited?: boolean;
    error?: string;
  }> {
    if (!this.licenseId) {
      return { success: false, changed: false, error: 'No license token to renew' };
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const storedToken = await this.getStoredLicenseKey();
      if (!storedToken) {
        return { success: false, changed: false, error: 'No stored license token' };
      }

      const response = await fetch(`${LICENSE_API_URL}/renew`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: storedToken }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorBody = await response.text();
        log.error(`Renew failed (${response.status}): ${errorBody}`, 'LicenseManager');
        let parsed: { error?: string } | null = null;
        try { parsed = JSON.parse(errorBody); } catch { /* non-JSON body */ }

        if (response.status === 429) {
          return {
            success: false,
            changed: false,
            isRateLimited: true,
            error: parsed?.error || 'Rate limit reached. Try again later.',
          };
        }
        return {
          success: false,
          changed: false,
          error: parsed?.error || 'License server error',
        };
      }

      const result = await response.json() as {
        success: boolean;
        newToken?: string;
        expiresAt?: string;
        error?: string;
      };

      if (!result.success || !result.newToken) {
        return {
          success: false,
          changed: false,
          error: result.error || 'Renewal returned no token',
        };
      }

      log.info('Renewal succeeded - applying new token', 'LicenseManager');
      const applyResult = await this.setLicenseKey(result.newToken);
      if (!applyResult.success) {
        return {
          success: false,
          changed: false,
          error: `Token apply failed: ${applyResult.error}`,
        };
      }

      log.info(`Token renewed: now on ${applyResult.tier} tier`, 'LicenseManager');
      return {
        success: true,
        changed: true,
        newExpiresAt: result.expiresAt && result.expiresAt !== 'NA'
          ? new Date(result.expiresAt)
          : undefined,
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        log.error('Renew timeout', 'LicenseManager');
        return { success: false, changed: false, error: 'Timeout' };
      }
      log.error('Renew error', 'LicenseManager', error);
      return {
        success: false,
        changed: false,
        error: error instanceof Error ? error.message : 'Network error',
      };
    }
  }

  /**
   * Schedule cancellation via Worker /cancel (vendor-independent, task_07).
   * Cancel-at-period-end: the tier stays active until the paid-through date;
   * the provider webhook flips the ledger status at the effective date.
   */
  async cancelSubscription(): Promise<{
    success: boolean;
    accessUntil?: string | null;
    notCancellable?: boolean;
    error?: string;
  }> {
    if (!this.licenseId || !this.licenseBilling || this.licenseBilling === 'lifetime') {
      return { success: false, notCancellable: true, error: 'No active subscription to cancel' };
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const storedToken = await this.getStoredLicenseKey();
      if (!storedToken) {
        return { success: false, notCancellable: true, error: 'No stored license token' };
      }

      const response = await fetch(`${LICENSE_API_URL}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: storedToken }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const bodyText = await response.text();
      let parsed: { success?: boolean; accessUntil?: string | null; error?: string } | null = null;
      try { parsed = JSON.parse(bodyText); } catch { /* non-JSON body */ }

      if (!response.ok || !parsed?.success) {
        log.error(`Cancel failed (${response.status}): ${bodyText}`, 'LicenseManager');
        return {
          success: false,
          notCancellable: response.status === 400,
          error: parsed?.error || 'License server error',
        };
      }

      // Local marker until the next /status sync confirms the authoritative value
      this.cancelScheduledAt = new Date();
      this.emit('licenseUpdated');
      log.info('Cancellation scheduled at period end', 'LicenseManager');

      return { success: true, accessUntil: parsed.accessUntil ?? null };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        log.error('Cancel timeout', 'LicenseManager');
        return { success: false, error: 'Timeout' };
      }
      log.error('Cancel error', 'LicenseManager', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Network error',
      };
    }
  }

  /**
   * Stable per-install identity for seat binding (task_07). Generated once,
   * persisted in license_config so it survives container rebuilds. A DB wipe
   * produces a new identity - that is the force-move case, by design.
   */
  private async getInstanceId(): Promise<string> {
    if (this.instanceId) return this.instanceId;

    const result = await this.getPool().query(
      'SELECT instance_id FROM license_config WHERE id = 1'
    );
    let id: string | null = result.rows[0]?.instance_id || null;

    if (!id) {
      id = randomUUID();
      await this.getPool().query(`
        INSERT INTO license_config (id, instance_id, updated_at)
        VALUES (1, $1, NOW())
        ON CONFLICT (id) DO UPDATE SET instance_id = COALESCE(license_config.instance_id, $1)
      `, [id]);
      // Re-read in case a concurrent writer won the race
      const check = await this.getPool().query(
        'SELECT instance_id FROM license_config WHERE id = 1'
      );
      id = check.rows[0]?.instance_id || id;
    }

    this.instanceId = id;
    return id!;
  }

  /** Persist seat state (task_07). Non-fatal on DB error, like persistLastSyncAt. */
  private async setSeatState(state: 'bound' | 'lost' | null): Promise<void> {
    this.seatState = state;
    try {
      await this.getPool().query(`
        INSERT INTO license_config (id, seat_state, updated_at)
        VALUES (1, $1, NOW())
        ON CONFLICT (id) DO UPDATE SET seat_state = $1
      `, [state]);
    } catch (error) {
      log.error('Failed to persist seat_state', 'LicenseManager', error);
    }
  }

  /**
   * One-time seat bind for a token already on file (task_07). Best-effort:
   * network failure leaves seatState NULL (retried next boot; subscriptions
   * also get claimed server-side on /status sync). A positive seat conflict
   * demotes softly.
   */
  private async ensureSeatBound(key: string): Promise<void> {
    try {
      const bind = await this.bindSeat(key, false);
      if (bind.ok) {
        await this.setSeatState(bind.bindExempt ? null : 'bound');
      } else if (bind.seatConflict) {
        log.warn('License seat is bound to another system - demoting to Free (soft)', 'LicenseManager');
        await this.setSeatState('lost');
        this.cachedTier = TIERS.free;
      }
    } catch (error) {
      log.error('Seat bind attempt failed', 'LicenseManager', error);
    }
  }

  /**
   * Bind this install's seat via Worker /activate (task_07).
   * 404 not_found = token not in the ledger (CLI-minted) -> bind-exempt.
   */
  private async bindSeat(token: string, force: boolean): Promise<{
    ok: boolean;
    bindExempt?: boolean;
    moved?: boolean;
    seatConflict?: boolean;
    boundAt?: string | null;
    canForce?: boolean;
    error?: string;
  }> {
    try {
      const instanceId = await this.getInstanceId();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(`${LICENSE_API_URL}/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, instanceId, force: force || undefined }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const body = await response.json().catch(() => null) as {
        success?: boolean;
        bound?: boolean;
        moved?: boolean;
        error?: string;
        message?: string;
        boundAt?: string | null;
        canForce?: boolean;
      } | null;

      if (response.ok && body?.success) {
        if (body.moved) log.info('Seat force-moved to this system', 'LicenseManager');
        return { ok: true, moved: body.moved === true };
      }
      if (response.status === 404) {
        log.info('License not in ledger (CLI-minted?) - bind-exempt', 'LicenseManager');
        return { ok: true, bindExempt: true };
      }
      if (response.status === 409) {
        return {
          ok: false,
          seatConflict: true,
          boundAt: body?.boundAt ?? null,
          canForce: body?.canForce === true,
          error: body?.message || 'License is already in use on another system',
        };
      }
      // 429 move_limit / 403 move_cap / 5xx - surface the worker's message
      return { ok: false, error: body?.message || body?.error || 'License server error' };
    } catch (error) {
      log.error('Seat bind request failed', 'LicenseManager', error);
      return { ok: false, error: 'License server unreachable. Check your connection and try again.' };
    }
  }

  /** Release this install's seat via Worker /release (best-effort, task_07). */
  private async releaseSeat(token: string): Promise<void> {
    try {
      const instanceId = await this.getInstanceId();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(`${LICENSE_API_URL}/release`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, instanceId }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        log.info('Seat released', 'LicenseManager');
      } else {
        log.warn(`Seat release returned ${response.status} (force-move path covers this)`, 'LicenseManager');
      }
    } catch (error) {
      log.error('Seat release failed (non-fatal)', 'LicenseManager', error);
    }
  }

  /**
   * Recovery lookup (task_07): ask /status whether the chain behind a
   * signature-valid but expired token is alive and holds a fresher JWT.
   */
  private async fetchReplacementForToken(candidate: string): Promise<string | null> {
    try {
      const instanceId = await this.getInstanceId();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(`${LICENSE_API_URL}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: candidate, instanceId }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) return null;
      const status = await response.json() as { found?: boolean; replacementToken?: string };
      return (status.found && status.replacementToken) ? status.replacementToken : null;
    } catch (error) {
      log.error('Recovery /status lookup failed', 'LicenseManager', error);
      return null;
    }
  }

  /**
   * Progressive sync cadence. Returns the minimum spacing (ms) between license-
   * server syncs for a given time-to-expiry: relaxed when far out, tightening as
   * expiry nears so a renewal token is picked up promptly.
   *
   * Schedule:
   * - 3+ days out:     every 24 hours
   * - 2-3 days out:    every 12 hours
   * - 1-2 days out:    every 6 hours
   * - 12h-1 day out:   every 1 hour
   * - < 12 hours out:  every 15 minutes
   *
   * A negative timeToExpiry (already expired, in or past grace) falls into the
   * tightest (< 12h) bucket so we recover as fast as possible. Single source of
   * truth for both the lazy on-access path (checkAutoSync) and the autonomous
   * background loop (scheduleNextAutoSync / autoSyncTick).
   */
  private computeSyncInterval(timeToExpiry: number): number {
    const HOUR = 60 * 60 * 1000;
    const DAY = 24 * HOUR;
    if (timeToExpiry <= 12 * HOUR) return 15 * 60 * 1000; // 15 minutes
    if (timeToExpiry <= 1 * DAY) return 1 * HOUR;          // 1 hour
    if (timeToExpiry <= 2 * DAY) return 6 * HOUR;          // 6 hours
    if (timeToExpiry <= 3 * DAY) return 12 * HOUR;         // 12 hours
    return 24 * HOUR;                                      // 3+ days out: once per day
  }

  /**
   * Sync if the progressive interval has elapsed since the last sync. Invoked
   * from getLicenseInfo() (lazy, on-access) and from the background loop.
   */
  private async checkAutoSync(): Promise<void> {
    // Paid (non-lifetime) token must be on file. A demoted-to-Free state with a
    // hard-expired token still passes, allowing recovery via /status.
    if (!this.hasPaidTokenOnFile()) return;
    if (!this.licenseExpiresAt) return; // need expiry to compute interval

    const now = Date.now();
    const timeToExpiry = this.licenseExpiresAt.getTime() - now;
    const timeSinceLastSync = now - (this.lastSyncAt?.getTime() || 0);
    const requiredInterval = this.computeSyncInterval(timeToExpiry);

    if (timeSinceLastSync >= requiredInterval) {
      const HOUR = 60 * 60 * 1000;
      log.info(`Auto-sync triggered (${Math.round(timeToExpiry / HOUR)}h to expiry, ${Math.round(timeSinceLastSync / 60000)}min since last sync)`, 'LicenseManager');
      await this.syncWithLicenseServer();
    }
  }

  /**
   * Start the autonomous background sync loop. Self-rescheduling: each tick
   * sleeps exactly the progressive interval for the current time-to-expiry, so a
   * healthy license is checked ~once/day and only ramps to every 15 min in the
   * final 12h before expiry. This is what lets a renewed token in D1 be picked
   * up with no open browser, no manual Refresh, and no container restart.
   * Idempotent - safe to call once at startup.
   */
  startAutoSync(): void {
    if (!this.autoSyncStopped) return; // already running
    this.autoSyncStopped = false;
    this.scheduleNextAutoSync();
    log.info('License auto-sync loop started', 'LicenseManager');
  }

  /** Stop the background sync loop (graceful shutdown). */
  stopAutoSync(): void {
    this.autoSyncStopped = true;
    if (this.autoSyncTimer) {
      clearTimeout(this.autoSyncTimer);
      this.autoSyncTimer = null;
    }
  }

  /**
   * Arm the timer for the next sync. Delay = progressive interval when a paid
   * token with a known expiry is on file; otherwise a relaxed idle re-check so a
   * later activation is still picked up. No fixed-interval polling.
   */
  private scheduleNextAutoSync(): void {
    if (this.autoSyncStopped) return;
    if (this.autoSyncTimer) {
      clearTimeout(this.autoSyncTimer);
      this.autoSyncTimer = null;
    }

    const delay = (this.hasPaidTokenOnFile() && this.licenseExpiresAt)
      ? this.computeSyncInterval(this.licenseExpiresAt.getTime() - Date.now())
      : this.AUTO_SYNC_IDLE_INTERVAL_MS;

    this.autoSyncTimer = setTimeout(() => { void this.autoSyncTick(); }, delay);
    // Never keep the event loop alive solely for this background timer.
    this.autoSyncTimer.unref?.();
  }

  /** One background sync attempt (guarded against overlap), then reschedule. */
  private async autoSyncTick(): Promise<void> {
    this.autoSyncTimer = null;
    if (this.autoSyncInProgress) {
      this.scheduleNextAutoSync();
      return;
    }
    this.autoSyncInProgress = true;
    try {
      await this.checkAutoSync();
    } catch (error) {
      log.error('Auto-sync tick failed', 'LicenseManager', error);
    } finally {
      this.autoSyncInProgress = false;
      this.scheduleNextAutoSync();
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
   * Persist lastSyncAt to license_config so it survives container restarts.
   * Failure here is non-fatal; in-memory value still drives behaviour for
   * the current process lifetime.
   */
  private async persistLastSyncAt(when: Date | null): Promise<void> {
    try {
      await this.getPool().query(
        'UPDATE license_config SET last_sync_at = $1 WHERE id = 1',
        [when]
      );
    } catch (error) {
      log.error('Failed to persist last_sync_at', 'LicenseManager', error);
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
      log.error('Validation error, using cached value', 'LicenseManager');
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
    // Seat lost (task_07): license bound to another system - soft demote.
    // Token stays on file so a later re-bind or force-move can restore.
    if (this.seatState === 'lost') {
      this.cachedTier = TIERS.free;
    }
    this.cacheExpiry = new Date(Date.now() + this.CACHE_DURATION_MS);
    this.licenseExpiresAt = result.expiresAt;  // Store license expiry date
    this.licenseActivatedAt = result.activatedAt;  // Store license issued date
    this.licenseBilling = result.billing || null;  // Store billing period
    this.customerName = result.customerName || null;  // Store customer name
    this.customerEmail = result.customerEmail || null;  // Store customer email
    this.licenseId = result.licenseId || null;  // Store license ID for /status lookups
    this.subscriptionId = result.subscriptionId || null;  // From JWT `sid` claim
    this.licenseKey = key;  // Store raw JWT for read-only exposure to user (copy/backup)
    this.periodInterval = result.periodInterval || null;  // From JWT period_interval claim
    this.periodCount = (typeof result.periodCount === 'number' && result.periodCount > 0) ? result.periodCount : null;  // From JWT period_count claim

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
      log.error('Failed to cache result', 'LicenseManager', error);
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
      log.error('Failed to load from cache', 'LicenseManager', error);
      this.cachedTier = TIERS.free;
    }
  }
}

// Singleton instance
export const licenseManager = new LicenseManager();

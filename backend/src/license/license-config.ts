/**
 * Shared license/worker configuration constants.
 *
 * Single source of truth for the license Worker's base URL. Imported by
 * LicenseManager (for /status, /sync) and routes (for /promo, /checkout
 * proxies).
 */

export const LICENSE_API_URL = 'https://license.pankha.app';

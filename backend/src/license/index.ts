/**
 * License Module - Barrel export
 * 
 * Re-exports all license-related functionality for clean imports.
 */

export { TIERS, TierConfig, getTier, hasFeature } from './tiers';
export { LicenseValidator, ValidationResult } from './LicenseValidator';
export { LicenseManager, licenseManager } from './LicenseManager';
export { default as licenseRouter } from './routes';

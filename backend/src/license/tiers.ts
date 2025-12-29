/**
 * Tier Configuration for Pankha License Management
 * 
 * Defines feature limits, capabilities, and pricing for each subscription tier.
 * 
 * Pricing Model:
 * - Free: $0 (no payment required)
 * - Pro: $5/month, $49/year, $149 lifetime
 * - Enterprise: $25/month, $249/year, $499 lifetime
 */

export interface TierPricing {
  monthly: number;    // Monthly price in USD (0 for free)
  yearly: number;     // Yearly price in USD (0 for free)
  lifetime: number;   // Lifetime price in USD (0 for free)
}

export interface TierConfig {
  name: string;
  agentLimit: number;
  retentionDays: number;
  alertLimit: number;
  alertChannels: ('dashboard' | 'email' | 'webhook' | 'sms')[];
  apiAccess: 'none' | 'read' | 'full';
  showBranding: boolean;
  pricing: TierPricing;
}

export const TIERS: Record<string, TierConfig> = {
  free: {
    name: 'Free',
    agentLimit: 3,
    retentionDays: 7,
    alertLimit: 2,  // Critical temp and fan fail only
    alertChannels: ['dashboard', 'email'],
    apiAccess: 'none',
    showBranding: true,
    pricing: { monthly: 0, yearly: 0, lifetime: 0 },
  },
  pro: {
    name: 'Pro',
    agentLimit: 10,
    retentionDays: 30,
    alertLimit: Infinity,
    alertChannels: ['dashboard', 'email', 'webhook'],
    apiAccess: 'full',
    showBranding: true,
    pricing: { monthly: 5, yearly: 49, lifetime: 149 },
  },
  enterprise: {
    name: 'Enterprise',
    agentLimit: Infinity,
    retentionDays: 365,
    alertLimit: Infinity,
    alertChannels: ['dashboard', 'email', 'webhook'],
    apiAccess: 'full',
    showBranding: false,
    pricing: { monthly: 25, yearly: 249, lifetime: 499 },
  },
};

/**
 * Get tier configuration by name (case-insensitive)
 */
export function getTier(tierName: string): TierConfig {
  return TIERS[tierName.toLowerCase()] || TIERS.free;
}

/**
 * Check if a feature is available for a given tier
 */
export function hasFeature(tierName: string, feature: keyof TierConfig): boolean {
  const tier = getTier(tierName);
  const value = tier[feature];
  
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (feature === 'pricing') return true;
  return value !== 'none';
}

/**
 * Get all available tiers (for display)
 */
export function getAllTiers(): TierConfig[] {
  return Object.values(TIERS);
}

/**
 * Get paid tiers only (for upgrade prompts)
 */
export function getPaidTiers(): TierConfig[] {
  return Object.values(TIERS).filter(t => t.pricing.monthly > 0);
}

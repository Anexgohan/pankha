/**
 * Tier Configuration for Pankha License Management
 * 
 * Defines feature limits, capabilities, and pricing for each subscription tier.
 * 
 * Pricing Model:
 * - Free: $0 (no payment required)
 * - Pro: $5/month, $49/year, $199 lifetime
 * - Enterprise: $25/month, $249/year, $649 lifetime
 * 
 * NOTE: Dodo Payments product IDs are defined in:
 *       frontend/src/settings/components/Settings.tsx → PRODUCT_IDS constant
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
  benefits: string[];
}

const free: TierConfig = {
  name: 'Free',
  agentLimit: 3,
  retentionDays: 7,
  alertLimit: 2,  // Critical temp and fan fail only
  alertChannels: ['dashboard', 'email'],
  apiAccess: 'none',
  showBranding: true,
  pricing: { monthly: 0, yearly: 0, lifetime: 0 },
  benefits: [],
};
free.benefits = [
  `${free.agentLimit} Agents`,
  `${free.retentionDays} Days History`,
  'Alerts',
  'Notifications',
];

const pro: TierConfig = {
  name: 'Pro',
  agentLimit: 10,
  retentionDays: 30,
  alertLimit: Infinity,
  alertChannels: ['dashboard', 'email', 'webhook'],
  apiAccess: 'full',
  showBranding: true,
  pricing: { monthly: 5, yearly: 49, lifetime: 199 },
  benefits: [],
};
pro.benefits = [
  `${pro.agentLimit} Agents`,
  `${pro.retentionDays} Days History`,
  'Alerts',
  'Notifications',
  'API Access',
];

const enterprise: TierConfig = {
  name: 'Enterprise',
  agentLimit: Infinity,
  retentionDays: 365,
  alertLimit: Infinity,
  alertChannels: ['dashboard', 'email', 'webhook'],
  apiAccess: 'full',
  showBranding: false,
  pricing: { monthly: 25, yearly: 249, lifetime: 649 },
  benefits: [],
};
enterprise.benefits = [
  enterprise.agentLimit === Infinity ? 'Unlimited Agents' : `${enterprise.agentLimit} Agents`,
  `${enterprise.retentionDays} Days History`,
  'Alerts',
  'Notifications',
  'API Access',
  'No Branding',
];

export const TIERS: Record<string, TierConfig> = { free, pro, enterprise };

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

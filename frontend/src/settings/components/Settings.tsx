/**
 * Settings Component - Main settings page with tabs
 */

import React, { useState, useEffect } from 'react';
import { useLicense } from '../../license';
import { useDashboardSettings } from '../../contexts/DashboardSettingsContext';
import { setLicense, getPricing, deleteLicense } from '../../services/api';
import { formatDate } from '../../utils/formatters';
import ColorPicker from './ColorPicker';
import '../styles/settings.css';

// Graph scale configuration constants
const GRAPH_SCALE_MIN_HOURS = 1;
const GRAPH_SCALE_MAX_HOURS = 720; // 30 days

type SettingsTab = 'general' | 'license' | 'about';

interface TierPricing {
  name: string;
  agents: number;
  retentionDays: number;
  alerts: number;
  alertChannels: string[];
  apiAccess: string;
  showBranding: boolean;
  pricing: { monthly: number; yearly: number; lifetime: number };
}

interface PricingData {
  free: TierPricing;
  pro: TierPricing;
  enterprise: TierPricing;
}

// Dodo Payments checkout URLs - direct product links
// TEST MODE: https://test.checkout.dodopayments.com/buy/{product_id}
// LIVE MODE: https://checkout.dodopayments.com/buy/{product_id}
const CHECKOUT_BASE = 'https://test.checkout.dodopayments.com/buy'; // Test mode
// const CHECKOUT_BASE = 'https://checkout.dodopayments.com/buy'; // Live mode - uncomment for production

const CHECKOUT_URLS = {
  pro: {
    monthly: `${CHECKOUT_BASE}/pdt_0NV3sqzBkKRDNGHgkyOT4`,
    yearly: `${CHECKOUT_BASE}/pdt_0NV8gT4no4UJnP34pVgnl`,
    lifetime: `${CHECKOUT_BASE}/pdt_0NV8jwCkXAYkXJYyFrPQb`,
  },
  enterprise: {
    monthly: `${CHECKOUT_BASE}/pdt_0NV3tEaaHxETmRVdeJ0Ei`,
    yearly: `${CHECKOUT_BASE}/pdt_0NV8l5b1st3Cwv9PBbTLL`,
    lifetime: `${CHECKOUT_BASE}/pdt_0NV8gqfMxnRCmhzbWUzyR`,
  },
} as const;

const Settings: React.FC = () => {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const { license, isLoading, refreshLicense } = useLicense();
  const [licenseKey, setLicenseKey] = useState('');
  const [licenseStatus, setLicenseStatus] = useState<{ success: boolean; message: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Billing period toggles for pricing cards
  const [proBilling, setProBilling] = useState<'monthly' | 'yearly'>('monthly');
  const [enterpriseBilling, setEnterpriseBilling] = useState<'monthly' | 'yearly'>('monthly');
  const [lifetimeTier, setLifetimeTier] = useState<'pro' | 'enterprise'>('pro');
  
  // Dynamic pricing from API
  const [pricing, setPricing] = useState<PricingData | null>(null);

  // General Settings from Context
  const { graphScale, updateGraphScale, dataRetentionDays, updateDataRetention, timezone } = useDashboardSettings();
  const [isCustomScale, setIsCustomScale] = useState(false);
  const [customScaleInput, setCustomScaleInput] = useState(graphScale.toString());
  const [isCustomRetention, setIsCustomRetention] = useState(false);
  const [customRetentionInput, setCustomRetentionInput] = useState(dataRetentionDays.toString());
  
  // Appearance state
  const { 
    accentColor, updateAccentColor,
    hoverTintColor, updateHoverTintColor
  } = useDashboardSettings();

  const tacticalPresets = [
    { name: 'Cyber Blue', color: '#2196F3' },
    { name: 'Toxic Green', color: '#4CAF50' },
    { name: 'Hazard Orange', color: '#FF9800' },
    { name: 'Neon Pulse', color: '#E91E63' },
    { name: 'Digital Violet', color: '#9C27B0' },
    { name: 'Cosmic Lavender', color: '#867CFF' },
    { name: 'Flash Pink', color: '#FF326E' },
  ];
  
  // Update custom inputs when global values change (e.g. from preset)
  useEffect(() => {
    setCustomScaleInput(graphScale.toString());
  }, [graphScale]);
  
  useEffect(() => {
    setCustomRetentionInput(dataRetentionDays.toString());
  }, [dataRetentionDays]);

  const scalePresets = [
    { label: '1h', value: 1 },
    { label: '6h', value: 6 },
    { label: '12h', value: 12 },
    { label: '24h', value: 24 },
    { label: '3d', value: 72 },
    { label: '1w', value: 168 },
  ];
  
  /**
   * Data Retention Presets
   * Options: 1d, 7d, 30d, 90d, 365d
   * Presets above license.retentionDays are disabled (grayed out)
   * The max limit comes from the SST via license API (not hardcoded)
   */
  const retentionPresets = [
    { label: '1d', value: 1 },
    { label: '7d', value: 7 },
    { label: '30d', value: 30 },
    { label: '90d', value: 90 },
    { label: '365d', value: 365 },
  ];
  
  // Max retention allowed by license tier (from SST via API)
  const maxRetentionDays = license?.retentionDays || 7;
  
  useEffect(() => {
    const fetchPricing = async () => {
      try {
        const data = await getPricing();
        setPricing(data);
      } catch (error) {
        console.error('Failed to fetch pricing:', error);
      }
    };
    fetchPricing();
  }, []);

  const handleCustomScaleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseInt(customScaleInput, 10);
    if (!isNaN(val) && val >= GRAPH_SCALE_MIN_HOURS && val <= GRAPH_SCALE_MAX_HOURS) {
      updateGraphScale(val);
      setIsCustomScale(false);
    }
  };

  const handleCustomRetentionSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseInt(customRetentionInput, 10);
    // Enforce license tier limit
    if (!isNaN(val) && val >= 1 && val <= maxRetentionDays) {
      updateDataRetention(val);
      setIsCustomRetention(false);
    }
  };

  const handleLicenseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!licenseKey.trim()) return;

    setIsSubmitting(true);
    setLicenseStatus(null);

    try {
      const result = await setLicense(licenseKey.trim());
      if (result.success) {
        setLicenseStatus({ success: true, message: `License activated: ${result.tier}` });
        setLicenseKey('');
        await refreshLicense();
      } else {
        setLicenseStatus({ success: false, message: result.error || 'Invalid license key' });
      }
    } catch (error) {
      setLicenseStatus({ success: false, message: 'Failed to validate license' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRemoveLicense = async () => {
    if (!confirm('Are you sure you want to remove your license? You will revert to the Free tier.')) {
      return;
    }

    try {
      setIsSubmitting(true);
      await deleteLicense();
      await refreshLicense();
      setLicenseStatus({ success: true, message: 'License removed. Reverted to Free tier.' });
    } catch (error) {
      setLicenseStatus({ success: false, message: 'Failed to remove license' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatLimit = (value: number) => {
    return value === -1 ? '∞' : value.toString();
  };

  /**
   * Format remaining time dynamically and return urgency level
   */
  const formatRemaining = (expiresAt: string | null): { text: string; urgency: 'normal' | 'caution' | 'critical' } => {
    if (!expiresAt) {
      return { text: 'Lifetime', urgency: 'normal' };
    }

    const now = new Date();
    const expires = new Date(expiresAt);
    const diffMs = expires.getTime() - now.getTime();
    
    if (diffMs <= 0) {
      return { text: 'Expired', urgency: 'critical' };
    }

    const totalDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    // Determine urgency
    let urgency: 'normal' | 'caution' | 'critical' = 'normal';
    if (totalDays <= 3) {
      urgency = 'critical';
    } else if (totalDays <= 7) {
      urgency = 'caution';
    }

    // Format based on duration
    if (totalDays < 30) {
      return { text: `${totalDays} day${totalDays !== 1 ? 's' : ''}`, urgency };
    }

    const years = Math.floor(totalDays / 365);
    const months = Math.floor((totalDays % 365) / 30);
    const days = totalDays % 30;

    const parts: string[] = [];
    if (years > 0) parts.push(`${years}y`);
    if (months > 0) parts.push(`${months}m`);
    if (days > 0 && years === 0) parts.push(`${days}d`);  // Only show days if less than a year

    return { text: parts.join(' '), urgency };
  };

  return (
    <div className="settings-container">
      <nav className="settings-tabs">
        <button
          className={`settings-tab ${activeTab === 'general' ? 'active' : ''}`}
          onClick={() => setActiveTab('general')}
        >
          General
        </button>
        <button
          className={`settings-tab ${activeTab === 'license' ? 'active' : ''}`}
          onClick={() => setActiveTab('license')}
        >
          Subscription
        </button>
        <button
          className={`settings-tab ${activeTab === 'about' ? 'active' : ''}`}
          onClick={() => setActiveTab('about')}
        >
          About
        </button>
      </nav>

      <div className="settings-content">
        {/* General Tab */}
        {activeTab === 'general' && (
          <div className="settings-section">
            <h2>General Settings</h2>
            <p className="settings-info">
              Configure global dashboard preferences and display options.
            </p>
            
            <div className="settings-list">
              <div className="setting-item graph-scale-section">
                <div className="setting-info-wrapper">
                  <span className="setting-label">Graph Scale</span>
                  <span className="setting-description">
                    Adjust the historical data window for all dashboard sparklines.
                  </span>
                </div>
                
                <div className="scale-control-wrapper">
                  {!isCustomScale ? (
                    <div className="scale-presets">
                      {scalePresets.map((preset) => (
                        <button
                          key={preset.value}
                          className={`scale-preset-btn ${graphScale === preset.value ? 'active' : ''}`}
                          onClick={() => updateGraphScale(preset.value)}
                        >
                          {preset.label}
                        </button>
                      ))}
                      <button 
                        className={`scale-preset-btn custom ${!scalePresets.some(p => p.value === graphScale) ? 'active' : ''}`}
                        onClick={() => setIsCustomScale(true)}
                      >
                        {scalePresets.some(p => p.value === graphScale) ? 'Custom' : `${graphScale}h`}
                      </button>
                    </div>
                  ) : (
                    <form onSubmit={handleCustomScaleSubmit} className="scale-custom-form">
                      <input
                        type="number"
                        min={GRAPH_SCALE_MIN_HOURS}
                        max={GRAPH_SCALE_MAX_HOURS}
                        autoFocus
                        value={customScaleInput}
                        onChange={(e) => setCustomScaleInput(e.target.value)}
                        className="setting-input scale-input"
                      />
                      <span className="setting-unit">hours</span>
                      <button type="submit" className="scale-apply-btn">Apply</button>
                      <button 
                        type="button" 
                        className="scale-cancel-btn"
                        onClick={() => setIsCustomScale(false)}
                      >
                        ✕
                      </button>
                    </form>
                  )}
                </div>
              </div>
              
              {/* Data Retention Days Setting
                  Configurable within license tier limit.
                  Options above license.retentionDays are disabled (from SST via API) */}
              <div className="setting-item graph-scale-section">
                <div className="setting-info-wrapper">
                  <span className="setting-label">Data Retention</span>
                  <span className="setting-description">
                    Configure how many days of historical data to keep.
                    {maxRetentionDays < 365 && (
                      <span className="tier-limit-note"> (Your tier allows up to {maxRetentionDays} days)</span>
                    )}
                  </span>
                </div>
                
                <div className="scale-control-wrapper">
                  {!isCustomRetention ? (
                    <div className="scale-presets">
                      {retentionPresets.map((preset) => (
                        <button
                          key={preset.value}
                          className={`scale-preset-btn ${dataRetentionDays === preset.value ? 'active' : ''} ${preset.value > maxRetentionDays ? 'disabled' : ''}`}
                          onClick={() => preset.value <= maxRetentionDays && updateDataRetention(preset.value)}
                          disabled={preset.value > maxRetentionDays}
                          title={preset.value > maxRetentionDays ? `Requires ${preset.value > 90 ? 'Enterprise' : preset.value > 30 ? 'Pro+' : 'Pro'} tier` : undefined}
                        >
                          {preset.label}
                        </button>
                      ))}
                      <button 
                        className={`scale-preset-btn custom ${!retentionPresets.some(p => p.value === dataRetentionDays) ? 'active' : ''}`}
                        onClick={() => setIsCustomRetention(true)}
                      >
                        {retentionPresets.some(p => p.value === dataRetentionDays) ? 'Custom' : `${dataRetentionDays}d`}
                      </button>
                    </div>
                  ) : (
                    <form onSubmit={handleCustomRetentionSubmit} className="scale-custom-form">
                      <input
                        type="number"
                        min={1}
                        max={maxRetentionDays}
                        autoFocus
                        value={customRetentionInput}
                        onChange={(e) => setCustomRetentionInput(e.target.value)}
                        className="setting-input scale-input"
                      />
                      <span className="setting-unit">days (max {maxRetentionDays})</span>
                      <button type="submit" className="scale-apply-btn">Apply</button>
                      <button 
                        type="button" 
                        className="scale-cancel-btn"
                        onClick={() => setIsCustomRetention(false)}
                      >
                        ✕
                      </button>
                    </form>
                  )}
                </div>
              </div>
            </div>

            <div className="settings-section">
              <h3>Appearance</h3>
              <p className="settings-info">
                Personalize the dashboard color scheme and interaction feedback.
              </p>
              
              <div className="settings-list aesthetics-compact-list">
                <div className="setting-item aesthetics-row">
                  <span className="setting-label">Accent Color</span>
                  <div className="tactical-accent-picker">
                    <ColorPicker 
                      color={accentColor} 
                      onChange={updateAccentColor} 
                      label="Accent Color" 
                      presets={tacticalPresets}
                    />
                  </div>
                </div>

                <div className="setting-item aesthetics-row">
                  <span className="setting-label">Hover Tint</span>
                  <div className="tactical-accent-picker">
                    <ColorPicker 
                      color={hoverTintColor} 
                      onChange={updateHoverTintColor} 
                      label="Hover Tint" 
                      presets={tacticalPresets}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* License/Subscription Tab */}
        {activeTab === 'license' && (
          <div className="settings-section">
            <h2>Subscription</h2>
            
            {isLoading ? (
              <p>Loading license info...</p>
            ) : license ? (
              <>
                {/* Available Plans - First */}
                <div className="pricing-section">
                  <h3>Available Plans</h3>
                  <div className="pricing-cards">
                    {/* Free Plan */}
                    <div className={`pricing-card ${license.tier === 'Free' ? 'current' : ''}`}>
                      <div className="pricing-header">
                        <h4>Free</h4>
                        <div className="pricing-price">$0</div>
                        <div className="pricing-period">forever</div>
                      </div>
                      <ul className="pricing-features">
                        <li>{pricing?.free.agents || 3} Agents</li>
                        <li>{pricing?.free.retentionDays || 7} Days History</li>
                        <li>Critical Temp & Fan Fail Alerts</li>
                        <li>Dashboard & Email Notifications</li>
                      </ul>
                      {license.tier === 'Free' && <div className="current-plan-badge">Current Plan</div>}
                    </div>

                    {/* Pro Plan */}
                    <div className="pricing-card featured">
                      <div className="pricing-header">
                        <h4>Pro</h4>
                        <div className="pricing-toggle">
                          <button 
                            className={`toggle-btn ${proBilling === 'monthly' ? 'active' : ''}`}
                            onClick={() => setProBilling('monthly')}
                          >
                            Monthly
                          </button>
                          <button 
                            className={`toggle-btn ${proBilling === 'yearly' ? 'active' : ''}`}
                            onClick={() => setProBilling('yearly')}
                          >
                            Yearly
                          </button>
                        </div>
                        <div className="pricing-price">
                          ${proBilling === 'monthly' 
                            ? pricing?.pro.pricing.monthly || 5 
                            : pricing?.pro.pricing.yearly || 49}
                        </div>
                        <div className="pricing-period">
                          {proBilling === 'monthly' ? 'per month' : 'per year'}
                          {proBilling === 'yearly' && <span className="savings"> (save 18%)</span>}
                        </div>
                      </div>
                      <ul className="pricing-features">
                        <li>{pricing?.pro.agents || 10} Agents</li>
                        <li>{pricing?.pro.retentionDays || 30} Days History</li>
                        <li>Unlimited Alerts</li>
                        <li>All Notification Channels</li>
                        <li>Full API Access</li>
                      </ul>
                      {license.tier === 'Pro' && license.billing === proBilling ? (
                        <div className="current-plan-badge">Current Plan</div>
                      ) : license.tier === 'Pro' ? (
                        <a 
                          href={CHECKOUT_URLS.pro[proBilling]} 
                          target="_blank" 
                          rel="noopener noreferrer" 
                          className="pricing-buy-btn current-tier-btn"
                        >
                          Switch to {proBilling === 'monthly' ? 'Monthly' : 'Yearly'} (${proBilling === 'monthly' 
                            ? `${pricing?.pro.pricing.monthly || 5}/mo` 
                            : `${pricing?.pro.pricing.yearly || 49}/yr`})
                        </a>
                      ) : (
                        <a 
                          href={CHECKOUT_URLS.pro[proBilling]} 
                          target="_blank" 
                          rel="noopener noreferrer" 
                          className="pricing-buy-btn"
                        >
                          Get Pro (${proBilling === 'monthly' 
                            ? `${pricing?.pro.pricing.monthly || 5}/mo` 
                            : `${pricing?.pro.pricing.yearly || 49}/yr`})
                        </a>
                      )}
                    </div>

                    {/* Enterprise Plan */}
                    <div className="pricing-card">
                      <div className="pricing-header">
                        <h4>Enterprise</h4>
                        <div className="pricing-toggle">
                          <button 
                            className={`toggle-btn ${enterpriseBilling === 'monthly' ? 'active' : ''}`}
                            onClick={() => setEnterpriseBilling('monthly')}
                          >
                            Monthly
                          </button>
                          <button 
                            className={`toggle-btn ${enterpriseBilling === 'yearly' ? 'active' : ''}`}
                            onClick={() => setEnterpriseBilling('yearly')}
                          >
                            Yearly
                          </button>
                        </div>
                        <div className="pricing-price">
                          ${enterpriseBilling === 'monthly' 
                            ? pricing?.enterprise.pricing.monthly || 35 
                            : pricing?.enterprise.pricing.yearly || 249}
                        </div>
                        <div className="pricing-period">
                          {enterpriseBilling === 'monthly' ? 'per month' : 'per year'}
                          {enterpriseBilling === 'yearly' && <span className="savings"> (save 17%)</span>}
                        </div>
                      </div>
                      <ul className="pricing-features">
                        <li>Unlimited Agents</li>
                        <li>{pricing?.enterprise.retentionDays || 365} Days History</li>
                        <li>Unlimited Alerts</li>
                        <li>All Notification Channels</li>
                        <li>Full API Access</li>
                        <li>No Branding</li>
                      </ul>
                      {license.tier === 'Enterprise' && license.billing === enterpriseBilling ? (
                        <div className="current-plan-badge">Current Plan</div>
                      ) : license.tier === 'Enterprise' ? (
                        <a 
                          href={CHECKOUT_URLS.enterprise[enterpriseBilling]} 
                          target="_blank" 
                          rel="noopener noreferrer" 
                          className="pricing-buy-btn current-tier-btn"
                        >
                          Switch to {enterpriseBilling === 'monthly' ? 'Monthly' : 'Yearly'} (${enterpriseBilling === 'monthly' 
                            ? `${pricing?.enterprise.pricing.monthly || 35}/mo` 
                            : `${pricing?.enterprise.pricing.yearly || 249}/yr`})
                        </a>
                      ) : (
                        <a 
                          href={CHECKOUT_URLS.enterprise[enterpriseBilling]} 
                          target="_blank" 
                          rel="noopener noreferrer" 
                          className="pricing-buy-btn"
                        >
                          Get Enterprise (${enterpriseBilling === 'monthly' 
                            ? `${pricing?.enterprise.pricing.monthly || 35}/mo` 
                            : `${pricing?.enterprise.pricing.yearly || 249}/yr`})
                        </a>
                      )}
                    </div>

                    {/* Lifetime Plan */}
                    <div className="pricing-card lifetime">
                      <div className="pricing-badge best-value">BEST VALUE</div>
                      <div className="pricing-header">
                        <h4>Lifetime</h4>
                        <div className="pricing-toggle">
                          <button 
                            className={`toggle-btn ${lifetimeTier === 'pro' ? 'active' : ''}`}
                            onClick={() => setLifetimeTier('pro')}
                          >
                            Pro
                          </button>
                          <button 
                            className={`toggle-btn ${lifetimeTier === 'enterprise' ? 'active' : ''}`}
                            onClick={() => setLifetimeTier('enterprise')}
                          >
                            Enterprise
                          </button>
                        </div>
                        <div className="pricing-price">
                          ${lifetimeTier === 'pro' 
                            ? pricing?.pro.pricing.lifetime || 149 
                            : pricing?.enterprise.pricing.lifetime || 499}
                        </div>
                        <div className="pricing-period">one-time payment</div>
                      </div>
                      <ul className="pricing-features">
                        <li>Pay once, own forever</li>
                        <li>{lifetimeTier === 'pro' 
                          ? (pricing?.pro.agents || 10)
                          : (pricing?.enterprise.agents === -1 ? 'Unlimited' : pricing?.enterprise.agents || 'Unlimited')} Agents</li>
                        <li>{lifetimeTier === 'pro' 
                          ? (pricing?.pro.retentionDays || 30)
                          : (pricing?.enterprise.retentionDays || 365)} Days History</li>
                        <li>Unlimited Alerts</li>
                        <li>All Notification Channels</li>
                        <li>Full API Access</li>
                        {lifetimeTier === 'enterprise' && <li>No Branding</li>}
                      </ul>
                      {license.tier === (lifetimeTier === 'pro' ? 'Pro' : 'Enterprise') && license.billing === 'lifetime' ? (
                        <div className="current-plan-badge">Current Plan</div>
                      ) : (
                        <a 
                          href={CHECKOUT_URLS[lifetimeTier].lifetime} 
                          target="_blank" 
                          rel="noopener noreferrer" 
                          className="pricing-buy-btn lifetime-btn"
                        >
                          Get {lifetimeTier === 'pro' ? 'Pro' : 'Enterprise'} Lifetime ($
                          {lifetimeTier === 'pro' 
                            ? pricing?.pro.pricing.lifetime || 149 
                            : pricing?.enterprise.pricing.lifetime || 499})
                        </a>
                      )}
                    </div>
                  </div>
                </div>

                {/* Current Subscription - Second */}
                <h3>Your Subscription</h3>
                <div className="license-info">
                  <div className="tier-badges">
                    <div className={`tier-badge tier-${license.tier.toLowerCase()}`}>
                      {license.tier}
                    </div>
                    {license.billing && (
                      <div className="billing-badge">
                        {license.billing.charAt(0).toUpperCase() + license.billing.slice(1)}
                      </div>
                    )}
                  </div>
                  <div className="license-limits">
                    <div className="limit-item">
                      <span className="limit-label">Agents</span>
                      <span className="limit-value">{formatLimit(license.agentLimit)}</span>
                    </div>
                    <div className="limit-item">
                      <span className="limit-label">History</span>
                      <span className="limit-value">{license.retentionDays} days</span>
                    </div>
                    <div className="limit-item">
                      <span className="limit-label">Alerts</span>
                      <span className="limit-value">{formatLimit(license.alertLimit)}</span>
                    </div>
                    <div className="limit-item">
                      <span className="limit-label">API</span>
                      <span className="limit-value">{license.apiAccess === 'none' ? 'No' : license.apiAccess}</span>
                    </div>
                    {license.activatedAt && (
                      <div className="limit-item">
                        <span className="limit-label">Activated</span>
                        <span className="limit-value">{formatDate(license.activatedAt, timezone)}</span>
                      </div>
                    )}
                    <div className="limit-item">
                      <span className="limit-label">Expires</span>
                      <span className="limit-value">
                        {license.expiresAt ? formatDate(license.expiresAt, timezone) : 'Lifetime'}
                      </span>
                    </div>
                    {(() => {
                      const remaining = formatRemaining(license.expiresAt);
                      return (
                        <div className={`limit-item remaining-${remaining.urgency}`}>
                          <span className="limit-label">Remaining</span>
                          <span className="limit-value">{remaining.text}</span>
                        </div>
                      );
                    })()}
                  </div>
                </div>

                <form onSubmit={handleLicenseSubmit} className="license-form">
                  <h3>Enter License Key</h3>
                  <div className="license-input-group">
                    <input
                      type="text"
                      value={licenseKey}
                      onChange={(e) => setLicenseKey(e.target.value)}
                      placeholder="Paste your license token (eyJhbGciOiJSUzI1NiIs...)"
                      className="license-input"
                      disabled={isSubmitting}
                    />
                    <button 
                      type="submit" 
                      className="license-submit"
                      disabled={isSubmitting || !licenseKey.trim()}
                    >
                      {isSubmitting ? 'Validating...' : 'Activate'}
                    </button>
                    {license.tier !== 'Free' && (
                      <button 
                        type="button"
                        className="remove-license-btn"
                        onClick={handleRemoveLicense}
                        disabled={isSubmitting}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  {licenseStatus && (
                    <p className={`license-status ${licenseStatus.success ? 'success' : 'error'}`}>
                      {licenseStatus.message}
                    </p>
                  )}
                </form>
              </>
            ) : (
              <p>Failed to load license info</p>
            )}
          </div>
        )}

        {/* About Tab */}
        {activeTab === 'about' && (
          <div className="settings-section">
            <h2>About Pankha</h2>
            <div className="about-info">
              <p><strong>Version:</strong> {typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'}</p>
              <p><strong>Description:</strong> Server room fan control system</p>
              <p><strong>License:</strong> AGPL-3.0 / Commercial</p>
            </div>
            <div className="about-links">
              <a href="https://github.com/Anexgohan/pankha" target="_blank" rel="noopener noreferrer">
                GitHub Repository
              </a>
              <a href="https://github.com/Anexgohan/pankha/wiki" target="_blank" rel="noopener noreferrer">
                Documentation
              </a>
              <a href="https://github.com/Anexgohan/pankha/issues" target="_blank" rel="noopener noreferrer">
                Report an Issue
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Settings;

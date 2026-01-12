/**
 * Settings Component - Main settings page with tabs
 */

import React, { useState, useEffect } from 'react';
import { useLicense } from '../../license';
import { setLicense, getPricing, deleteLicense } from '../../services/api';
import '../styles/settings.css';

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
              General settings will be added here in future updates.
            </p>
            <ul className="settings-list">
              <li>Theme: Controlled via header toggle</li>
              <li>Controller Interval: Controlled via header selector</li>
            </ul>
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
                        <span className="limit-value">{new Date(license.activatedAt).toLocaleDateString()}</span>
                      </div>
                    )}
                    <div className="limit-item">
                      <span className="limit-label">Expires</span>
                      <span className="limit-value">
                        {license.expiresAt ? new Date(license.expiresAt).toLocaleDateString() : 'Lifetime'}
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

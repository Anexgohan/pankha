/**
 * Settings Component - Main settings page with tabs
 */

import React, { useState } from 'react';
import { useLicense } from '../license';
import { setLicense } from '../services/api';
import './Settings.css';

type SettingsTab = 'general' | 'license' | 'about';

const Settings: React.FC = () => {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const { license, isLoading, refreshLicense } = useLicense();
  const [licenseKey, setLicenseKey] = useState('');
  const [licenseStatus, setLicenseStatus] = useState<{ success: boolean; message: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

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

  const formatLimit = (value: number) => {
    return value === -1 ? '∞' : value.toString();
  };

  return (
    <div className="settings-container">
      <nav className="settings-tabs">
        <button
          className={`settings-tab ${activeTab === 'general' ? 'active' : ''}`}
          onClick={() => setActiveTab('general')}
        >
          ⚙️ General
        </button>
        <button
          className={`settings-tab ${activeTab === 'license' ? 'active' : ''}`}
          onClick={() => setActiveTab('license')}
        >
          🔑 Subscription
        </button>
        <button
          className={`settings-tab ${activeTab === 'about' ? 'active' : ''}`}
          onClick={() => setActiveTab('about')}
        >
          ℹ️ About
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
              <li>🎨 Theme: Controlled via header toggle</li>
              <li>⏱️ Controller Interval: Controlled via header selector</li>
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
                <div className="license-info">
                  <div className={`tier-badge tier-${license.tier.toLowerCase()}`}>
                    {license.tier}
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
                      <span className="limit-value">{license.apiAccess === 'none' ? '❌' : license.apiAccess}</span>
                    </div>
                  </div>
                </div>

                <form onSubmit={handleLicenseSubmit} className="license-form">
                  <h3>Enter License Key</h3>
                  <div className="license-input-group">
                    <input
                      type="text"
                      value={licenseKey}
                      onChange={(e) => setLicenseKey(e.target.value)}
                      placeholder="PANKHA-XXXX-XXXX-XXXX"
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
                  </div>
                  {licenseStatus && (
                    <p className={`license-status ${licenseStatus.success ? 'success' : 'error'}`}>
                      {licenseStatus.message}
                    </p>
                  )}
                </form>

                <div className="license-upgrade">
                  <a 
                    href="https://pankha.dev/pricing" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="upgrade-link"
                  >
                    🚀 Upgrade to unlock more features
                  </a>
                </div>
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
                📦 GitHub Repository
              </a>
              <a href="https://github.com/Anexgohan/pankha/wiki" target="_blank" rel="noopener noreferrer">
                📚 Documentation
              </a>
              <a href="https://github.com/Anexgohan/pankha/issues" target="_blank" rel="noopener noreferrer">
                🐛 Report an Issue
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Settings;

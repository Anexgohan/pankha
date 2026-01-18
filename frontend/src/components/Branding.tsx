/**
 * Branding Component
 * Shows "Powered by Pankha" badge for Free and Pro tiers
 * Hidden for Enterprise tier (showBranding: false)
 */

import { useLicense } from '../license';
import './Branding.css';

export function Branding() {
  const { license } = useLicense();

  // Don't show branding for Enterprise or if explicitly disabled
  if (!license?.showBranding) return null;

  return (
    <div className="branding">
      <span>Powered by </span>
      <a href="https://pankha.app" target="_blank" rel="noopener noreferrer">
        Pankha
      </a>
    </div>
  );
}

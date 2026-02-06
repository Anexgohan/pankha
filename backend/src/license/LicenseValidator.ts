/**
 * LicenseValidator - Validates license tokens using cryptographic signatures
 * 
 * This module validates license tokens (JWTs) signed by Pankha's license server.
 * The public key is embedded here - only Pankha can create valid tokens.
 * 
 * How it works:
 * 1. User purchases license from pankha.dev (via e.g. Dodo Payments)
 * 2. User receives a signed JWT license token
 * 3. User enters the token in Settings → Subscription
 * 4. This validator verifies the signature using the embedded public key
 * 5. If valid, the tier is unlocked
 * 
 * Security: The private signing key never leaves our server. Users cannot
 * forge tokens without it, even though this code is fully public.
 */

import * as crypto from 'crypto';

export interface ValidationResult {
  valid: boolean;
  tier: string;
  billing?: 'monthly' | 'yearly' | 'lifetime';
  licenseId?: string;
  expiresAt: Date | null;
  isGracePeriod: boolean;      // New field: true if currently in 3-day buffer
  activatedAt: Date | null;  // When license was issued
  customerName?: string;
  customerEmail?: string;
  error?: string;
}

interface LicensePayload {
  // V2 token fields
  v?: number;      // Token version
  lid?: string;    // License ID
  billing?: 'monthly' | 'yearly' | 'lifetime';
  name?: string;   // Customer name
  oid?: string;    // Order ID
  
  // Core fields (both v1 and v2)
  tier: 'pro' | 'enterprise';
  email: string;
  exp: number;     // Unix timestamp (seconds)
  iat: number;     // Issued at (seconds)
  sub?: string;    // Subject (v1 license ID)
}

/**
 * Public key for verifying license tokens (ES256/ECDSA P-256)
 *
 * Generated with: openssl ecparam -genkey -name prime256v1 -noout -out private.pem
 * Extracted with: openssl ec -in private.pem -pubout -out public.pem
 *
 * The PRIVATE key stays on pankha.dev license server.
 * This PUBLIC key is embedded here for signature verification.
 *
 * Keys location: custom-files/.secrets/keys/license-validator/
 */
const LICENSE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE4+mp4y/9qNljmR3K8AE3KC1npWeR
IBURFnhfYbnDXwvKfNRSsB5bP2qjo+8IoOMZJLLQIB+/nwHbR+5O2GgZGg==
-----END PUBLIC KEY-----`;

// ================================================================
// OPTION C ALTERNATIVE: API-based validation (commented for later)
// ================================================================
//
// import axios from 'axios';
//
// const LICENSE_API_URL = 'https://api.pankha.dev/license/validate';
//
// async function validateViaApi(licenseKey: string): Promise<ValidationResult> {
//   try {
//     const response = await axios.post(LICENSE_API_URL, {
//       license_key: licenseKey,
//     }, {
//       timeout: 10000,
//     });
//
//     if (response.data.valid) {
//       return {
//         valid: true,
//         tier: response.data.tier,
//         expiresAt: response.data.expires_at ? new Date(response.data.expires_at) : null,
//       };
//     }
//
//     return {
//       valid: false,
//       tier: 'free',
//       expiresAt: null,
//       error: response.data.error || 'Invalid license',
//     };
//   } catch (error) {
//     console.error('[LicenseValidator] API validation failed:', error);
//     return {
//       valid: false,
//       tier: 'free',
//       expiresAt: null,
//       error: 'License server unreachable',
//     };
//   }
// }
// ================================================================

export class LicenseValidator {
  private publicKey: string;

  constructor() {
    this.publicKey = LICENSE_PUBLIC_KEY;
  }

  /**
   * Validate a license token (JWT format)
   *
   * Token format: header.payload.signature (base64url encoded)
   * Algorithm: ES256 (ECDSA P-256 + SHA-256)
   */
  async validate(licenseToken: string): Promise<ValidationResult> {
    console.log(`[LicenseValidator] Validating license token...`);

    // ================================================================
    // OPTION C HYBRID: Uncomment to try API first, then fall back to JWT
    // ================================================================
    // try {
    //   const apiResult = await validateViaApi(licenseToken);
    //   if (apiResult.valid) return apiResult;
    // } catch {
    //   console.log('[LicenseValidator] API unavailable, trying JWT validation...');
    // }
    // ================================================================

    try {
      // Check if public key is configured
      if (this.publicKey.includes('PLACEHOLDER')) {
        console.warn('[LicenseValidator] Public key not configured yet');
        return {
          valid: false,
          tier: 'free',
          expiresAt: null,
          isGracePeriod: false,
          activatedAt: null,
          error: 'License system not configured. Contact support@pankha.app',
        };
      }

      // Parse JWT parts
      const parts = licenseToken.split('.');
      if (parts.length !== 3) {
        return {
          valid: false,
          tier: 'free',
          expiresAt: null,
          isGracePeriod: false,
          activatedAt: null,
          error: 'Invalid license format',
        };
      }

      const [headerB64, payloadB64, signatureB64] = parts;

      // Verify signature
      const signedData = `${headerB64}.${payloadB64}`;
      const signature = Buffer.from(this.base64UrlDecode(signatureB64), 'base64');

      const isValid = crypto.verify(
        'sha256',
        Buffer.from(signedData),
        {
          key: this.publicKey,
          dsaEncoding: 'ieee-p1363',
        },
        signature
      );

      if (!isValid) {
        return {
          valid: false,
          tier: 'free',
          expiresAt: null,
          isGracePeriod: false,
          activatedAt: null,
          error: 'Invalid license signature',
        };
      }

      // Decode and parse payload
      const payloadJson = Buffer.from(this.base64UrlDecode(payloadB64), 'base64').toString('utf8');
      const payload: LicensePayload = JSON.parse(payloadJson);

      // Check expiration with 3-day grace period for offline users
      const GRACE_PERIOD_SECONDS = 3 * 24 * 60 * 60; // 3 days
      const now = Math.floor(Date.now() / 1000);
      const isLifetime = payload.exp === 0;
      const isHardExpired = !isLifetime && !!payload.exp && (payload.exp + GRACE_PERIOD_SECONDS) < now;
      const isGracePeriod = !isLifetime && !!payload.exp && payload.exp < now && (payload.exp + GRACE_PERIOD_SECONDS) >= now;

      if (isHardExpired) {
        return {
          valid: false,
          tier: 'free',
          expiresAt: new Date(payload.exp * 1000),
          isGracePeriod: false,
          activatedAt: payload.iat ? new Date(payload.iat * 1000) : null,
          error: 'License expired',
        };
      }

      // Determine billing period (for v1 tokens, derive from expiration)
      let billing = payload.billing;
      if (!billing) {
        // V1 token - derive billing from expiration
        if (isLifetime) {
          billing = 'lifetime';
        } else {
          // Rough check: if expiration is ~1 year away, it's yearly
          const daysRemaining = (payload.exp - now) / (24 * 60 * 60);
          billing = daysRemaining > 180 ? 'yearly' : 'monthly';
        }
      }

      // Valid license!
      const expiresAt = isLifetime ? null : (payload.exp ? new Date(payload.exp * 1000) : null);
      const licenseId = payload.lid || payload.sub;
      
      console.log(`[LicenseValidator] License valid: ${payload.tier} tier (${billing}), expires ${isLifetime ? 'LIFETIME' : expiresAt?.toISOString()}`);
      
      return {
        valid: true,
        tier: payload.tier,
        billing,
        licenseId,
        expiresAt,
        isGracePeriod,
        activatedAt: payload.iat ? new Date(payload.iat * 1000) : null,
        customerName: payload.name,
        customerEmail: payload.email,
      };
    } catch (error) {
      console.error('[LicenseValidator] Validation error:', error);
      return {
        valid: false,
        tier: 'free',
        expiresAt: null,
        isGracePeriod: false,
        activatedAt: null,
        error: 'License validation failed',
      };
    }
  }

  /**
   * Convert base64url to regular base64
   */
  private base64UrlDecode(str: string): string {
    // Replace URL-safe chars with standard base64 chars
    let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    
    // Add padding if needed
    const padding = base64.length % 4;
    if (padding) {
      base64 += '='.repeat(4 - padding);
    }
    
    return base64;
  }
}

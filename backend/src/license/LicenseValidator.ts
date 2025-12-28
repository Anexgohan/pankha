/**
 * LicenseValidator - Validates license tokens using cryptographic signatures
 * 
 * This module validates license tokens (JWTs) signed by Pankha's license server.
 * The public key is embedded here - only Pankha can create valid tokens.
 * 
 * How it works:
 * 1. User purchases license from pankha.dev (via Dodo Payments)
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
  expiresAt: Date | null;
  error?: string;
}

interface LicensePayload {
  tier: 'pro' | 'enterprise';
  email: string;
  exp: number;  // Unix timestamp (seconds)
  iat: number;  // Issued at (seconds)
  sub: string;  // Subject (license ID)
}

/**
 * Public key for verifying license tokens (RS256/RSA)
 * 
 * TODO: Replace this with your actual public key
 * Generate keypair: openssl genrsa -out private.pem 2048
 * Extract public: openssl rsa -in private.pem -pubout -out public.pem
 * 
 * The PRIVATE key stays on your license server (pankha.dev/api/license/generate)
 * The PUBLIC key is embedded here for verification
 */
const LICENSE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0000000000000000000
0000000000000000000000000000000000000000000000000000000000000000
0000000000000000000000000000000000000000000000000000000000000000
0000000000000000000000000000000000000000000000000000000000000000
0000000000000000000000000000000000000000000000000000000000000000
000000000000000000000000000000000000PLACEHOLDER0000000000000000
AQAB
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
   * Algorithm: RS256 (RSA-SHA256)
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
          error: 'License system not configured. Contact support@pankha.dev',
        };
      }

      // Parse JWT parts
      const parts = licenseToken.split('.');
      if (parts.length !== 3) {
        return {
          valid: false,
          tier: 'free',
          expiresAt: null,
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
          padding: crypto.constants.RSA_PKCS1_PADDING,
        },
        signature
      );

      if (!isValid) {
        return {
          valid: false,
          tier: 'free',
          expiresAt: null,
          error: 'Invalid license signature',
        };
      }

      // Decode and parse payload
      const payloadJson = Buffer.from(this.base64UrlDecode(payloadB64), 'base64').toString('utf8');
      const payload: LicensePayload = JSON.parse(payloadJson);

      // Check expiration
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp && payload.exp < now) {
        return {
          valid: false,
          tier: 'free',
          expiresAt: new Date(payload.exp * 1000),
          error: 'License expired',
        };
      }

      // Valid license!
      console.log(`[LicenseValidator] License valid: ${payload.tier} tier, expires ${new Date(payload.exp * 1000).toISOString()}`);
      
      return {
        valid: true,
        tier: payload.tier,
        expiresAt: payload.exp ? new Date(payload.exp * 1000) : null,
      };
    } catch (error) {
      console.error('[LicenseValidator] Validation error:', error);
      return {
        valid: false,
        tier: 'free',
        expiresAt: null,
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

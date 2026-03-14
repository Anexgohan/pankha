/**
 * ProfileService — BMC Profile Management
 *
 * Scans backend/profiles/ directory, resolves extends inheritance,
 * and provides a vendor/model catalog for the frontend deployment UI.
 * Also serves resolved profiles to IPMI agents via HTTP API (Option B).
 */

import fs from 'fs';
import path from 'path';
import { log } from '../utils/logger';

// ─── Types ───────────────────────────────────────────────────────────

export interface ProfileMetadata {
  schema_version: string;
  vendor: string;
  model_family?: string[];
  supported_protocols?: string[];
  author?: string;
  description?: string;
  profile_tier?: 'official' | 'experimental';
}

export interface ProfileCatalogEntry {
  vendor: string;
  model_family: string[];
  profile_id: string;               // e.g., "supermicro/x10_series"
  description: string;
  author: string;
  profile_tier: 'official' | 'experimental';
  is_monitor_only: boolean;
  zones: { id: string; name: string; members?: string[] }[];
  has_read_speed: boolean;
  speed_translation_type: string;    // "decimal_hex" | "byte_scale" | "integer"
}

export interface ProfileCatalog {
  vendors: {
    name: string;
    base_profile: string;            // e.g., "_bases/supermicro_ipmi"
    models: ProfileCatalogEntry[];
  }[];
}

// ─── Merge Rules (matches Rust merger.rs) ────────────────────────────

/**
 * Deep merge a child profile onto a base profile (JSON objects).
 *
 * Rules (from BMC_JSON_Profile_Schema.md Section 5.4):
 *   metadata:          shallow merge (child overrides fields)
 *   parsing:           shallow merge
 *   fan_zones:         REPLACE (child array replaces base)
 *   initialization:    APPEND (child commands added after base)
 *   reset_to_factory:  REPLACE (child replaces base entirely)
 */
function deepMergeProfile(base: any, child: any): any {
  const merged = JSON.parse(JSON.stringify(base));

  // metadata: shallow merge
  if (child.metadata) {
    merged.metadata = { ...merged.metadata, ...child.metadata };
  }

  // protocols.ipmi
  if (child.protocols?.ipmi) {
    if (!merged.protocols) merged.protocols = {};
    if (!merged.protocols.ipmi) merged.protocols.ipmi = {};

    const baseIpmi = merged.protocols.ipmi;
    const childIpmi = child.protocols.ipmi;

    // parsing: shallow merge
    if (childIpmi.parsing) {
      baseIpmi.parsing = { ...baseIpmi.parsing, ...childIpmi.parsing };
    }

    // fan_zones: REPLACE
    if (childIpmi.fan_zones) {
      baseIpmi.fan_zones = childIpmi.fan_zones;
    }

    // lifecycle
    if (childIpmi.lifecycle) {
      if (!baseIpmi.lifecycle) baseIpmi.lifecycle = {};

      // initialization: APPEND
      if (childIpmi.lifecycle.initialization) {
        baseIpmi.lifecycle.initialization = [
          ...(baseIpmi.lifecycle.initialization || []),
          ...childIpmi.lifecycle.initialization,
        ];
      }

      // reset_to_factory: REPLACE
      if (childIpmi.lifecycle.reset_to_factory) {
        baseIpmi.lifecycle.reset_to_factory = childIpmi.lifecycle.reset_to_factory;
      }
    }
  }

  // protocols.redfish (same pattern — future)
  if (child.protocols?.redfish) {
    if (!merged.protocols) merged.protocols = {};
    merged.protocols.redfish = {
      ...merged.protocols.redfish,
      ...child.protocols.redfish,
    };
  }

  // Remove extends from resolved profile
  delete merged.extends;

  return merged;
}

// ─── Service ─────────────────────────────────────────────────────────

export class ProfileService {
  private static instance: ProfileService;
  private profilesDir: string;
  private resolvedProfiles: Map<string, any> = new Map();
  private catalog: ProfileCatalog | null = null;

  private constructor() {
    this.profilesDir = path.join(__dirname, '../../profiles');
  }

  public static getInstance(): ProfileService {
    if (!ProfileService.instance) {
      ProfileService.instance = new ProfileService();
    }
    return ProfileService.instance;
  }

  /**
   * Initialize: scan profiles directory and build catalog.
   * Call once at startup.
   */
  public initialize(): void {
    try {
      this.scanAndResolve();
      log.info(
        `Loaded ${this.resolvedProfiles.size} BMC profiles from ${this.profilesDir}`,
        'ProfileService'
      );
    } catch (error) {
      log.error('Failed to initialize ProfileService:', 'ProfileService', error);
    }
  }

  /**
   * Scan profiles directory, resolve extends, build catalog.
   */
  private scanAndResolve(): void {
    if (!fs.existsSync(this.profilesDir)) {
      log.warn(`Profiles directory not found: ${this.profilesDir}`, 'ProfileService');
      this.catalog = { vendors: [] };
      return;
    }

    this.resolvedProfiles.clear();

    // Load all base profiles first
    const bases = new Map<string, any>();
    const basesDir = path.join(this.profilesDir, '_bases');
    if (fs.existsSync(basesDir)) {
      for (const file of fs.readdirSync(basesDir)) {
        if (!file.endsWith('.json')) continue;
        try {
          const content = fs.readFileSync(path.join(basesDir, file), 'utf-8');
          const baseId = `_bases/${file.replace('.json', '')}`;
          bases.set(baseId, JSON.parse(content));
        } catch (err) {
          log.warn(`Failed to parse base profile ${file}:`, 'ProfileService', err);
        }
      }
    }

    // Scan vendor directories for model profiles
    const vendorMap = new Map<string, ProfileCatalogEntry[]>();

    for (const entry of fs.readdirSync(this.profilesDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === '_bases') continue;

      const vendorDir = path.join(this.profilesDir, entry.name);
      const models: ProfileCatalogEntry[] = [];

      for (const file of fs.readdirSync(vendorDir)) {
        if (!file.endsWith('.json')) continue;

        try {
          const filePath = path.join(vendorDir, file);
          const content = fs.readFileSync(filePath, 'utf-8');
          const raw = JSON.parse(content);

          const profileId = `${entry.name}/${file.replace('.json', '')}`;

          // Resolve extends
          let resolved: any;
          if (raw.extends) {
            const base = bases.get(raw.extends);
            if (!base) {
              log.warn(
                `Profile ${profileId} extends "${raw.extends}" but base not found, skipping`,
                'ProfileService'
              );
              continue;
            }
            resolved = deepMergeProfile(base, raw);
          } else {
            resolved = JSON.parse(JSON.stringify(raw));
            delete resolved.extends;
          }

          this.resolvedProfiles.set(profileId, resolved);

          // Extract catalog entry
          const ipmi = resolved.protocols?.ipmi;
          const zones = (ipmi?.fan_zones || []).map((z: any) => ({
            id: z.id,
            name: z.name,
            members: z.members,
          }));

          const firstZone = ipmi?.fan_zones?.[0];
          const profileTier =
            resolved.metadata?.profile_tier ||
            (profileId.includes('/custom_') ? 'experimental' : 'official');
          const isMonitorOnly = (ipmi?.fan_zones || []).length === 0;
          const hasReadSpeed = (ipmi?.fan_zones || []).some(
            (z: any) => z.commands?.read_speed
          );

          models.push({
            vendor: resolved.metadata?.vendor || entry.name,
            model_family: resolved.metadata?.model_family || [],
            profile_id: profileId,
            description: resolved.metadata?.description || '',
            author: resolved.metadata?.author || 'Unknown',
            profile_tier: profileTier,
            is_monitor_only: isMonitorOnly,
            zones,
            has_read_speed: hasReadSpeed,
            speed_translation_type: firstZone?.speed_translation?.type || 'unknown',
          });
        } catch (err) {
          log.warn(`Failed to parse profile ${file} in ${entry.name}/:`, 'ProfileService', err);
        }
      }

      if (models.length > 0) {
        models.sort((a, b) => {
          if (a.profile_tier !== b.profile_tier) {
            return a.profile_tier === 'official' ? -1 : 1;
          }

          const aName = a.model_family[0] || a.profile_id;
          const bName = b.model_family[0] || b.profile_id;
          return aName.localeCompare(bName);
        });
        vendorMap.set(entry.name, models);
      }
    }

    // Build catalog
    this.catalog = {
      vendors: Array.from(vendorMap.entries()).map(([dirName, models]) => {
        const vendor = models[0]?.vendor || dirName;
        // Find matching base profile
        const baseKey = Array.from(bases.keys()).find((k) => {
          const base = bases.get(k);
          return base?.metadata?.vendor?.toLowerCase() === vendor.toLowerCase();
        });

        return {
          name: vendor,
          base_profile: baseKey || '',
          models,
        };
      }),
    };
  }

  /**
   * Get the vendor/model catalog (powers frontend dropdowns).
   */
  public getCatalog(): ProfileCatalog {
    if (!this.catalog) {
      this.scanAndResolve();
    }
    return this.catalog || { vendors: [] };
  }

  /**
   * Get a fully resolved profile by ID (e.g., "supermicro/x10_series").
   */
  public getResolvedProfile(profileId: string): any | null {
    return this.resolvedProfiles.get(profileId) || null;
  }

  /**
   * Refresh the catalog (call after profiles are added/changed on disk).
   */
  public refresh(): void {
    this.scanAndResolve();
    log.info(
      `Refreshed: ${this.resolvedProfiles.size} BMC profiles loaded`,
      'ProfileService'
    );
  }
}

import React, { useState, useCallback } from 'react';
import {
  Play,
  Plus,
  Trash2,
  Check,
  AlertCircle,
  Download,
  Upload,
  ChevronDown,
  ChevronRight,
  Cpu,
} from 'lucide-react';
import { toast } from '../../utils/toast';
import {
  executeRawIpmi,
  saveCustomProfile,
  assignProfileToAgent,
  type RawIpmiResult,
} from '../../services/api';
import type { SystemData } from '../../types/api';

// ─── Types ──────────────────────────────────────────────────────────

interface SpeedTranslation {
  type: 'byte_scale' | 'decimal_hex' | 'integer';
  input_min: number;
  input_max: number;
  output_min: number;
  output_max: number;
}

interface FanZone {
  id: string;
  name: string;
  members: string;
  speed_translation: SpeedTranslation;
  set_speed_bytes: string;
  read_speed_bytes: string;
  set_speed_result: TestResult | null;
  read_speed_result: TestResult | null;
}

interface LifecycleCommand {
  name: string;
  bytes: string;
  critical: boolean;
  result: TestResult | null;
}

interface TestResult {
  success: boolean;
  output: string;
  elapsed_ms: number;
  error?: string;
}

interface ProfileBuilderProps {
  systems: SystemData[];
}

// ─── Helpers ────────────────────────────────────────────────────────

function translateSpeed(percent: number, translation: SpeedTranslation): string {
  const { type, output_min, output_max } = translation;
  let value: number;

  switch (type) {
    case 'byte_scale':
      value = Math.round((percent / 100) * (output_max - output_min) + output_min);
      break;
    case 'decimal_hex':
      value = percent; // direct mapping
      break;
    case 'integer':
      value = percent;
      break;
    default:
      value = percent;
  }

  return `0x${value.toString(16).padStart(2, '0')}`;
}

function interpolateBytes(template: string, speedHex: string): string {
  return template.replace(/\{\{SPEED_HEX\}\}/g, speedHex);
}

const DEFAULT_ZONE: FanZone = {
  id: 'zone_0',
  name: 'Zone 0',
  members: '',
  speed_translation: {
    type: 'decimal_hex',
    input_min: 0,
    input_max: 100,
    output_min: 0,
    output_max: 100,
  },
  set_speed_bytes: '',
  read_speed_bytes: '',
  set_speed_result: null,
  read_speed_result: null,
};

const DEFAULT_LIFECYCLE: LifecycleCommand = {
  name: '',
  bytes: '',
  critical: true,
  result: null,
};

// ─── Vendor Hints (real-world IPMI command patterns) ─────────────────

interface VendorHints {
  zones: string;
  members: string;
  speedTranslation: string;
  setSpeed: string;
  readSpeed: string;
  init: string;
  reset: string;
  notes?: string;
  unsupported?: boolean;
  placeholders: {
    setSpeed: string;
    readSpeed: string;
    init: string;
    reset: string;
    members: string;
  };
}

const KNOWN_VENDORS = ['Dell', 'Supermicro', 'ASRock Rack', 'Tyan', 'Lenovo', 'HP/HPE', 'Gigabyte', 'Fujitsu', 'ASUS'] as const;

const VENDOR_HINTS: Record<string, VendorHints> = {
  Dell: {
    zones: 'Dell PowerEdge typically uses a single zone (0xFF = all fans). Some R-series models support per-zone control.',
    members: 'Common fan names: Fan1, Fan2, Fan3, Fan4, Fan5, Fan6.',
    speedTranslation: 'Dell uses byte_scale — 0x00 (0%) to 0xFF (100%), 256 steps.',
    setSpeed: 'Typical: 0x30 0x30 0x02 0xff {{SPEED_HEX}} — the 0xff targets all fans.',
    readSpeed: 'Dell fans are read via SDR (no OEM read command). Leave blank to use SDR auto-detection.',
    init: 'Disable auto fan control: 0x30 0x30 0x01 0x00 — required before manual control. Some models also need PCIe panic disable: 0x30 0xce 0x00 0x16 0x05 0x00 0x00 0x00 0x05 0x00 0x01 0x00 0x00',
    reset: 'Re-enable auto fan control: 0x30 0x30 0x01 0x01',
    notes: 'Supports iDRAC 7, 8, and early 9 (firmware < 3.30.30.30). Newer iDRAC 9 may require Redfish instead of raw IPMI.',
    placeholders: {
      setSpeed: '0x30 0x30 0x02 0xff {{SPEED_HEX}}',
      readSpeed: '',
      init: '0x30 0x30 0x01 0x00',
      reset: '0x30 0x30 0x01 0x01',
      members: 'Fan1, Fan2, Fan3, Fan4, Fan5, Fan6',
    },
  },
  Supermicro: {
    zones: 'Supermicro uses 2 zones: Zone 0 (CPU fans) and Zone 1 (Peripheral/System fans). The zone byte is the 5th byte in the set_speed command.',
    members: 'CPU zone: FAN1, FAN2, FAN3, FAN4. Peripheral zone: FANA, FANB.',
    speedTranslation: 'X9 boards: byte_scale (0x00–0xFF). X10/X11/X12 boards: decimal_hex — percentage 0–100 maps to 0x00–0x64.',
    setSpeed: 'X10/X11 Zone 0: 0x30 0x70 0x66 0x01 0x00 {{SPEED_HEX}}. Zone 1: 0x30 0x70 0x66 0x01 0x01 {{SPEED_HEX}}. X9 Zone 0: 0x30 0x91 0x5A 0x03 0x00 {{SPEED_HEX}}.',
    readSpeed: 'X10/X11: 0x30 0x70 0x66 0x00 0x00 (Zone 0) / 0x30 0x70 0x66 0x00 0x01 (Zone 1). X9: no OEM read command, uses SDR.',
    init: 'Set "Full Speed" mode first: 0x30 0x45 0x01 0x01 — required before manual override, otherwise BIOS fights the set_speed command.',
    reset: 'Restore "Standard" mode: 0x30 0x45 0x01 0x00. Alternative "Optimal" mode: 0x30 0x45 0x01 0x02.',
    placeholders: {
      setSpeed: '0x30 0x70 0x66 0x01 0x00 {{SPEED_HEX}}',
      readSpeed: '0x30 0x70 0x66 0x00 0x00',
      init: '0x30 0x45 0x01 0x01',
      reset: '0x30 0x45 0x01 0x00',
      members: 'FAN1, FAN2, FAN3, FAN4',
    },
  },
  'ASRock Rack': {
    zones: 'ASRock Rack has no zone abstraction. Each fan header is individually addressed as a byte position in the set_speed command (up to 6 fans + 2 reserved bytes).',
    members: 'Typical: CPU_FAN1, CPU_FAN2, REAR_FAN1, REAR_FAN2, FRNT_FAN1, FRNT_FAN2. Byte-to-fan mapping varies per board — verify by toggling one fan at a time.',
    speedTranslation: 'ASRock Rack uses decimal_hex — 0–100% maps to 0x00–0x64.',
    setSpeed: 'All fans at once: 0x3a 0x01 [F1] [F2] [F3] [F4] [F5] [F6] 0x00 0x00 — each byte is a fan duty (0x00–0x64). The speed value replaces the first fan byte.',
    readSpeed: 'Read current duty: 0x3a 0x06 0x01 0x00',
    init: 'No separate init command needed. Sending the set_speed command (0x3a 0x01) overrides automatic control.',
    reset: 'Restore fan curve: 0x3a 0x05 0x01 0x00 30 55 60 65 70 75 80 85 90 95 100 (sets default duty-cycle curve). Or use BMC web UI.',
    notes: 'Byte-to-fan-header mapping varies between board models (E3C246D4U, X470D4U, ROMED8-2T). Must be verified per board by toggling one fan at a time.',
    placeholders: {
      setSpeed: '0x3a 0x01 {{SPEED_HEX}} {{SPEED_HEX}} {{SPEED_HEX}} {{SPEED_HEX}} {{SPEED_HEX}} {{SPEED_HEX}} 0x00 0x00',
      readSpeed: '0x3a 0x06 0x01 0x00',
      init: '',
      reset: '0x3a 0x05 0x01 0x00',
      members: 'CPU_FAN1, CPU_FAN2, REAR_FAN1, REAR_FAN2, FRNT_FAN1, FRNT_FAN2',
    },
  },
  Tyan: {
    zones: 'Tyan has no zone abstraction. Each fan is addressed individually by PWM ID: 0x00=CPU_FAN, 0x01=SYS_FAN_1, 0x02=SYS_FAN_2, 0x03=SYS_FAN_3, 0x04=SYS_FAN_4.',
    members: 'Typical: CPU_FAN, SYS_FAN_1, SYS_FAN_2, SYS_FAN_3, SYS_FAN_4.',
    speedTranslation: 'Tyan uses decimal_hex — 0–100% encoded as 0x00–0x64. Read quirk: actual duty = response byte - 128.',
    setSpeed: 'Per-fan: 0x2e 0x05 0xfd 0x19 0x00 <PWM_ID> {{SPEED_HEX}} — 0xfd 0x19 is the Tyan/MiTAC IANA identifier (required in every command).',
    readSpeed: 'Read duty: 0x2e 0x05 0xfd 0x19 0x00 <PWM_ID> 0xfe — response byte minus 128 = actual duty %.',
    init: 'Disable smart fan: 0x2e 0x06 0xfd 0x19 0x00 0x00 — must be done before setting manual PWM values.',
    reset: 'Re-enable smart fan: 0x2e 0x06 0xfd 0x19 0x00 0x01. Per-fan auto: 0x2e 0x05 0xfd 0x19 0x00 <PWM_ID> 0xff.',
    notes: 'Verified on S8036. Other Tyan boards (S7106, S5553, S8030) with AST2500 BMC likely use the same commands but should be tested.',
    placeholders: {
      setSpeed: '0x2e 0x05 0xfd 0x19 0x00 0x00 {{SPEED_HEX}}',
      readSpeed: '0x2e 0x05 0xfd 0x19 0x00 0x00 0xfe',
      init: '0x2e 0x06 0xfd 0x19 0x00 0x00',
      reset: '0x2e 0x06 0xfd 0x19 0x00 0x01',
      members: 'CPU_FAN, SYS_FAN_1, SYS_FAN_2, SYS_FAN_3, SYS_FAN_4',
    },
  },
  Lenovo: {
    zones: 'IMM2 (x3650 M4/M5): 2 zones — Zone 0x01 (front: Fan 1A, 1B), Zone 0x02 (rear: Fan 2A, 2B). XCC (ThinkSystem): per-fan by number (2–7).',
    members: 'IMM2: Fan 1A Tach, Fan 1B Tach, Fan 2A Tach, Fan 2B Tach. XCC: Fan 1 Tach, Fan 2 Tach, Fan 3 Tach, etc.',
    speedTranslation: 'IMM2: Non-linear hex scale (NOT a direct percentage — 0x00≈20%, 0x50≈50%, 0xff=100%). XCC: integer 0–100 direct percentage.',
    setSpeed: 'IMM2: 0x3a 0x07 0xff {{SPEED_HEX}} 0x01 (all zones, 0x01=manual). XCC: 0x3c 0x14 <fan_num> {{SPEED_HEX}}.',
    readSpeed: 'No standard OEM read command. Use SDR for fan RPM readings.',
    init: 'IMM2: the trailing 0x01 in set_speed enables manual override. XCC: 0x3c 0x0b to disable cooling manager.',
    reset: 'IMM2: 0x3a 0x07 0xff 0x00 0x00 (restore automatic). XCC: re-enable cooling manager or reboot BMC.',
    notes: 'Two different command sets for IMM2 vs XCC. IMM2 sometimes reclaims fan control — scripts must re-send commands periodically. Each Lenovo system has its own command set — verify per model.',
    placeholders: {
      setSpeed: '0x3a 0x07 0xff {{SPEED_HEX}} 0x01',
      readSpeed: '',
      init: '',
      reset: '0x3a 0x07 0xff 0x00 0x00',
      members: 'Fan 1A Tach, Fan 1B Tach, Fan 2A Tach, Fan 2B Tach',
    },
  },
  'HP/HPE': {
    zones: 'HP ProLiant iLO aggressively controls fans. Standard IPMI raw commands do not override HP fan control.',
    members: 'Fan names vary: Fan 1, Fan 2, etc. Readable via SDR.',
    speedTranslation: 'Not applicable — HP does not support granular fan speed control via raw IPMI.',
    setSpeed: 'No known raw IPMI set_speed command. iLO 4 (Gen8/Gen9) requires community-patched firmware. iLO 5/6 (Gen10+) only exposes predefined cooling policies via Redfish.',
    readSpeed: 'Fan RPM readable via SDR. No OEM read command needed.',
    init: 'No init command — HP manages fans entirely through iLO firmware.',
    reset: 'No reset command needed — iLO retains control at all times.',
    notes: 'HP ProLiant is effectively monitor-only via IPMI. Fan control requires iLO firmware modifications (unsupported) or Redfish API with limited preset options.',
    unsupported: true,
    placeholders: { setSpeed: '', readSpeed: '', init: '', reset: '', members: 'Fan 1, Fan 2, Fan 3, Fan 4' },
  },
  Gigabyte: {
    zones: 'Fan zones are managed via the BMC web interface only.',
    members: 'Typical SDR names: FAN0, FAN1, FAN2, FAN3, FAN4, FAN5.',
    speedTranslation: 'Not applicable — no raw IPMI fan control.',
    setSpeed: 'Not available. Gigabyte BMCs do not expose OEM raw commands for fan speed. Use the BMC web interface (Gigabyte Management Console) instead.',
    readSpeed: 'Fan RPM readable via SDR.',
    init: 'Not available via IPMI.',
    reset: 'Not available via IPMI.',
    notes: 'Gigabyte server BMCs (AMI MegaRAC SP-X) do not support raw IPMI fan control. This has been officially confirmed by Gigabyte. Fan profiles can only be configured through the BMC web interface.',
    unsupported: true,
    placeholders: { setSpeed: '', readSpeed: '', init: '', reset: '', members: 'FAN0, FAN1, FAN2, FAN3' },
  },
  Fujitsu: {
    zones: 'Fan zones are managed internally by iRMC.',
    members: 'Varies by model. Readable via SDR.',
    speedTranslation: 'Not applicable — no raw IPMI fan control.',
    setSpeed: 'Not available. iRMC does not expose fan control via raw IPMI. Standard Dell/Supermicro commands return "Request data length invalid".',
    readSpeed: 'Fan RPM readable via SDR.',
    init: 'Not available via IPMI.',
    reset: 'Not available via IPMI.',
    notes: 'Fujitsu PRIMERGY iRMC does not support raw IPMI fan control. Fan management is only available through the iRMC web interface or Redfish API.',
    unsupported: true,
    placeholders: { setSpeed: '', readSpeed: '', init: '', reset: '', members: '' },
  },
  ASUS: {
    zones: 'Fan zones managed via BIOS settings or ASMB9-iKVM web interface.',
    members: 'Typical: CPU_FAN1, CPU_FAN2, CHA_FAN1, CHA_FAN2, CHA_FAN3.',
    speedTranslation: 'Not applicable — no known raw IPMI fan control commands.',
    setSpeed: 'No publicly documented raw IPMI commands for fan speed control. Use BIOS settings or the ASMB9-iKVM "Fan Customized Mode" in the BMC web interface.',
    readSpeed: 'Fan RPM readable via SDR.',
    init: 'Not available via IPMI.',
    reset: 'Not available via IPMI.',
    notes: 'ASUS server boards with ASMB8/ASMB9-iKVM have no known raw IPMI fan control. Multiple users report BMC web UI settings sometimes have no effect.',
    unsupported: true,
    placeholders: { setSpeed: '', readSpeed: '', init: '', reset: '', members: 'CPU_FAN1, CPU_FAN2, CHA_FAN1, CHA_FAN2' },
  },
};

function getVendorHints(vendorName: string): VendorHints | null {
  if (!vendorName) return null;
  // Exact match first
  if (VENDOR_HINTS[vendorName]) return VENDOR_HINTS[vendorName];
  // Case-insensitive fuzzy match
  const lower = vendorName.toLowerCase();
  if (lower.includes('dell')) return VENDOR_HINTS['Dell'];
  if (lower.includes('supermicro')) return VENDOR_HINTS['Supermicro'];
  if (lower.includes('asrock')) return VENDOR_HINTS['ASRock Rack'];
  if (lower.includes('tyan')) return VENDOR_HINTS['Tyan'];
  if (lower.includes('lenovo') || lower.includes('ibm')) return VENDOR_HINTS['Lenovo'];
  if (lower.includes('hp') || lower.includes('hpe') || lower.includes('proliant')) return VENDOR_HINTS['HP/HPE'];
  if (lower.includes('gigabyte')) return VENDOR_HINTS['Gigabyte'];
  if (lower.includes('fujitsu')) return VENDOR_HINTS['Fujitsu'];
  if (lower.includes('asus')) return VENDOR_HINTS['ASUS'];
  return null;
}

// ─── Component ──────────────────────────────────────────────────────

const ProfileBuilder: React.FC<ProfileBuilderProps> = ({ systems }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  // Step 1: Target agent
  const [selectedSystemId, setSelectedSystemId] = useState<number | null>(null);

  // Step 2: Metadata
  const [vendorSelection, setVendorSelection] = useState('');
  const [customVendor, setCustomVendor] = useState('');
  const vendor = vendorSelection === '__custom__' ? customVendor : vendorSelection;
  const hints = getVendorHints(vendor);
  const isUnsupported = hints?.unsupported === true;
  const [modelFamily, setModelFamily] = useState('');
  const [description, setDescription] = useState('');
  const [author, setAuthor] = useState('');

  // Step 3: Fan zones
  const [zones, setZones] = useState<FanZone[]>([{ ...DEFAULT_ZONE }]);

  // Step 4: Lifecycle
  const [initCommands, setInitCommands] = useState<LifecycleCommand[]>([{ ...DEFAULT_LIFECYCLE }]);
  const [resetCommands, setResetCommands] = useState<LifecycleCommand[]>([{ ...DEFAULT_LIFECYCLE }]);

  // Step 5: Export
  const [testSpeed, setTestSpeed] = useState(50);
  const [executing, setExecuting] = useState<string | null>(null);

  // Online IPMI agents only (Profile Builder is only for IPMI-capable agents)
  const onlineAgents = systems.filter(
    (s) => (s.real_time_status === 'online' || s.status === 'online') &&
           s.agent_type?.startsWith('ipmi')
  );
  const selectedSystem = systems.find((s) => s.id === selectedSystemId) || null;

  // ─── Execute IPMI command ───────────────────────────────────────

  const executeCommand = useCallback(
    async (bytes: string): Promise<TestResult> => {
      if (!selectedSystemId) {
        return { success: false, output: '', elapsed_ms: 0, error: 'No agent selected' };
      }
      try {
        const result: RawIpmiResult = await executeRawIpmi(selectedSystemId, bytes);
        if (result.success && result.data) {
          return {
            success: true,
            output: result.data.output || '(empty)',
            elapsed_ms: result.data.elapsed_ms,
          };
        }
        return {
          success: false,
          output: '',
          elapsed_ms: result.data?.elapsed_ms || 0,
          error: result.error || 'Command failed',
        };
      } catch (err: any) {
        const errorData = err?.response?.data;
        return {
          success: false,
          output: '',
          elapsed_ms: 0,
          error: errorData?.error || err.message || 'Request failed',
        };
      }
    },
    [selectedSystemId]
  );

  // ─── Zone handlers ────────────────────────────────────────────

  const updateZone = (index: number, updates: Partial<FanZone>) => {
    setZones((prev) => prev.map((z, i) => (i === index ? { ...z, ...updates } : z)));
  };

  const addZone = () => {
    const nextNum = zones.length;
    setZones((prev) => [
      ...prev,
      {
        ...DEFAULT_ZONE,
        id: `zone_${nextNum}`,
        name: `Zone ${nextNum}`,
        set_speed_result: null,
        read_speed_result: null,
      },
    ]);
  };

  const removeZone = (index: number) => {
    if (zones.length <= 1) return;
    setZones((prev) => prev.filter((_, i) => i !== index));
  };

  // ─── Lifecycle handlers ───────────────────────────────────────

  const updateLifecycle = (
    list: LifecycleCommand[],
    setter: React.Dispatch<React.SetStateAction<LifecycleCommand[]>>,
    index: number,
    updates: Partial<LifecycleCommand>
  ) => {
    setter(list.map((c, i) => (i === index ? { ...c, ...updates } : c)));
  };

  const addLifecycle = (setter: React.Dispatch<React.SetStateAction<LifecycleCommand[]>>) => {
    setter((prev) => [...prev, { ...DEFAULT_LIFECYCLE, result: null }]);
  };

  const removeLifecycle = (
    setter: React.Dispatch<React.SetStateAction<LifecycleCommand[]>>,
    index: number
  ) => {
    setter((prev) => prev.filter((_, i) => i !== index));
  };

  // ─── Test handlers ────────────────────────────────────────────

  const testSetSpeed = async (zoneIndex: number) => {
    const zone = zones[zoneIndex];
    if (!zone.set_speed_bytes.trim()) return;

    const key = `set_${zoneIndex}`;
    setExecuting(key);

    const speedHex = translateSpeed(testSpeed, zone.speed_translation);
    const finalBytes = interpolateBytes(zone.set_speed_bytes, speedHex);
    const result = await executeCommand(finalBytes);

    updateZone(zoneIndex, { set_speed_result: result });
    setExecuting(null);
  };

  const testReadSpeed = async (zoneIndex: number) => {
    const zone = zones[zoneIndex];
    if (!zone.read_speed_bytes.trim()) return;

    const key = `read_${zoneIndex}`;
    setExecuting(key);
    const result = await executeCommand(zone.read_speed_bytes);
    updateZone(zoneIndex, { read_speed_result: result });
    setExecuting(null);
  };

  const testLifecycleCommand = async (
    list: LifecycleCommand[],
    setter: React.Dispatch<React.SetStateAction<LifecycleCommand[]>>,
    index: number,
    prefix: string
  ) => {
    const cmd = list[index];
    if (!cmd.bytes.trim()) return;

    const key = `${prefix}_${index}`;
    setExecuting(key);
    const result = await executeCommand(cmd.bytes);
    updateLifecycle(list, setter, index, { result });
    setExecuting(null);
  };

  // ─── Build profile JSON ───────────────────────────────────────

  const buildProfileJson = () => {
    return {
      metadata: {
        schema_version: '2.0',
        vendor: vendor.trim(),
        profile_tier: 'experimental' as const,
        model_family: modelFamily
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        description: description.trim(),
        author: author.trim() || 'Community',
      },
      protocols: {
        ipmi: {
          parsing: {
            sdr_format: 'csv',
            fan_match_token: 'RPM',
            temp_match_token: 'degrees C',
          },
          fan_zones: zones.map((z) => ({
            id: z.id.trim(),
            name: z.name.trim(),
            members: z.members
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean),
            speed_translation: z.speed_translation,
            commands: {
              set_speed: {
                type: 'ipmitool_raw' as const,
                bytes: z.set_speed_bytes.trim(),
              },
              ...(z.read_speed_bytes.trim()
                ? {
                    read_speed: {
                      type: 'ipmitool_raw' as const,
                      bytes: z.read_speed_bytes.trim(),
                    },
                  }
                : {}),
            },
          })),
          lifecycle: {
            initialization: initCommands
              .filter((c) => c.bytes.trim())
              .map((c) => ({
                name: c.name.trim() || 'Unnamed',
                type: 'ipmitool_raw' as const,
                bytes: c.bytes.trim(),
                critical: c.critical,
              })),
            reset_to_factory: resetCommands
              .filter((c) => c.bytes.trim())
              .map((c) => ({
                name: c.name.trim() || 'Unnamed',
                type: 'ipmitool_raw' as const,
                bytes: c.bytes.trim(),
                critical: c.critical,
              })),
          },
        },
      },
    };
  };

  // ─── Export / Save ────────────────────────────────────────────

  const handleDownload = () => {
    const json = buildProfileJson();
    const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = vendor.toLowerCase().replace(/[^a-z0-9]/g, '_') || 'custom';
    const safeModel =
      modelFamily
        .split(',')[0]
        ?.trim()
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '_') || 'profile';
    a.download = `${safeName}_${safeModel}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Profile JSON downloaded');
  };

  const handleAssignToAgent = async () => {
    if (!selectedSystem) {
      toast.error('No agent selected');
      return;
    }

    const json = buildProfileJson();
    const safeName = vendor.toLowerCase().replace(/[^a-z0-9]/g, '_') || 'custom';
    const safeModel =
      modelFamily
        .split(',')[0]
        ?.trim()
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '_') || 'profile';

    try {
      // 1. Save profile to server
      const saveResult = await saveCustomProfile(json, `${safeName}_${safeModel}`);
      if (!saveResult.success) {
        toast.error('Failed to save profile');
        return;
      }

      // 2. Assign to agent
      await assignProfileToAgent(selectedSystem.agent_id, saveResult.profile_id);

      toast.success(`Profile assigned to ${selectedSystem.name}. Agent will reload.`);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || err.message || 'Failed to assign profile');
    }
  };

  // ─── Render helpers ───────────────────────────────────────────

  const renderTestResult = (result: TestResult | null) => {
    if (!result) return null;
    return (
      <div
        className={`profile-test-result ${result.success ? 'success' : 'error'}`}
      >
        {result.success ? <Check size={12} /> : <AlertCircle size={12} />}
        <span>
          {result.success
            ? `Response: ${result.output}`
            : `Error: ${result.error}`}
        </span>
        <span className="profile-test-elapsed">{result.elapsed_ms}ms</span>
      </div>
    );
  };

  // ─── Main render ──────────────────────────────────────────────

  return (
    <section className={`deployment-section profile-builder-panel ${!isExpanded ? 'collapsed' : ''}`}>
      <div className="maintenance-header-toggle">
        <h3 onClick={() => setIsExpanded(!isExpanded)} className="clickable-title">
          <Cpu size={20} /> Custom Profile Builder
          {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        </h3>
        <span className="maintenance-stats">
          Build &amp; test BMC profiles for unsupported hardware
        </span>
      </div>

      {isExpanded && (
        <div className="maintenance-content">
          {/* ── Step 1: Target Agent ─────────────────────────── */}
          <div className="profile-builder-step">
            <span className="builder-label">Target Agent</span>
            <p className="profile-builder-hint">
              Select the bare IPMI agent deployed on your server.
            </p>
            <div className="stealth-select-wrapper profile-select-wrapper" style={{ maxWidth: 400 }}>
              <select
                className="select-engine"
                value={selectedSystemId ?? ''}
                onChange={(e) =>
                  setSelectedSystemId(e.target.value ? Number(e.target.value) : null)
                }
              >
                <option value="">
                  {onlineAgents.length === 0
                    ? 'No agents online'
                    : 'Select agent...'}
                </option>
                {onlineAgents.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name || s.agent_id} ({s.agent_id})
                  </option>
                ))}
              </select>
              <div className="select-display">
                {selectedSystem
                  ? `${selectedSystem.name || selectedSystem.agent_id}`
                  : onlineAgents.length === 0
                  ? 'No agents online'
                  : 'Select agent...'}
              </div>
            </div>
          </div>

          {/* ── Step 2: Metadata ─────────────────────────────── */}
          <div className="profile-builder-step">
            <span className="builder-label">Profile Metadata</span>
            <p className="profile-vendor-hint">
              Builder-created profiles are saved as experimental until they are curated into the official profile set.
            </p>
            <div className="profile-builder-metadata-grid">
              <div className="builder-group">
                <span className="builder-label">Vendor</span>
                <div className="stealth-select-wrapper profile-select-wrapper">
                  <select
                    className="select-engine"
                    value={vendorSelection}
                    onChange={(e) => { setVendorSelection(e.target.value); if (e.target.value !== '__custom__') setCustomVendor(''); }}
                  >
                    <option value="">Select vendor...</option>
                    {KNOWN_VENDORS.map(v => (
                      <option key={v} value={v}>
                        {v}{VENDOR_HINTS[v]?.unsupported ? ' (unsupported)' : ''}
                      </option>
                    ))}
                    <option value="__custom__">Custom...</option>
                  </select>
                  <div className="select-display">
                    {vendorSelection === '__custom__'
                      ? (customVendor || 'Custom...')
                      : vendorSelection
                        ? `${vendorSelection}${hints?.unsupported ? ' (unsupported)' : ''}`
                        : 'Select vendor...'}
                  </div>
                </div>
                {vendorSelection === '__custom__' && (
                  <input
                    className="hub-url-input"
                    value={customVendor}
                    onChange={(e) => setCustomVendor(e.target.value)}
                    placeholder="e.g. ASRock Rack, Gigabyte, Lenovo"
                    style={{ marginTop: 'var(--spacing-sm)' }}
                  />
                )}
                {hints?.unsupported && (
                  <div className="profile-unsupported-warning">
                    <AlertCircle size={14} />
                    <span>This vendor does not support raw IPMI fan control. Fan RPM monitoring via SDR may still work, but manual speed control is not possible.</span>
                  </div>
                )}
                {hints?.notes && !hints.unsupported && (
                  <p className="profile-vendor-hint">{hints.notes}</p>
                )}
              </div>
              <div className="builder-group">
                <span className="builder-label">Model Family (comma-sep)</span>
                <input
                  className="hub-url-input"
                  value={modelFamily}
                  onChange={(e) => setModelFamily(e.target.value)}
                  placeholder="e.g. X570 Taichi, X570 Creator"
                />
              </div>
              <div className="builder-group">
                <span className="builder-label">Description</span>
                <input
                  className="hub-url-input"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Short description of this hardware"
                />
              </div>
              <div className="builder-group">
                <span className="builder-label">Author</span>
                <input
                  className="hub-url-input"
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                  placeholder="Your name"
                />
              </div>
            </div>
          </div>

          {/* ── Step 3: Fan Zones ────────────────────────────── */}
          <div className={`profile-builder-step${isUnsupported ? ' profile-step-disabled' : ''}`}>
            <span className="builder-label" title="Fan zones group fans that share the same speed command. Check your vendor's IPMI documentation or BMC web interface for zone layout.">Fan Zones</span>
            {hints && <p className="profile-vendor-hint">{hints.zones}</p>}

            {zones.map((zone, zi) => (
              <div key={zi} className="profile-zone-card">
                <div className="profile-zone-header">
                  <span className="profile-zone-title">Zone {zi}</span>
                  {zones.length > 1 && (
                    <button
                      className="btn-table-action"
                      onClick={() => removeZone(zi)}
                      title="Remove zone"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>

                <div className="profile-zone-fields">
                  <div className="builder-group">
                    <span className="builder-label">Zone ID</span>
                    <input
                      className="hub-url-input"
                      value={zone.id}
                      onChange={(e) => updateZone(zi, { id: e.target.value })}
                      placeholder="cpu_zone"
                    />
                  </div>
                  <div className="builder-group">
                    <span className="builder-label">Zone Name</span>
                    <input
                      className="hub-url-input"
                      value={zone.name}
                      onChange={(e) => updateZone(zi, { name: e.target.value })}
                      placeholder="CPU Fans"
                    />
                  </div>
                  <div className="builder-group">
                    <span className="builder-label" title="Run 'ipmitool sdr list full' on your server to see all sensor names including fans. Use the exact names from SDR output.">Members (comma-sep)</span>
                    <input
                      className="hub-url-input"
                      value={zone.members}
                      onChange={(e) => updateZone(zi, { members: e.target.value })}
                      placeholder={hints?.placeholders.members || 'FAN1, FAN2, FAN3'}
                    />
                    {hints && <p className="profile-vendor-hint">{hints.members}</p>}
                  </div>
                </div>

                {/* Speed Translation */}
                <div className="profile-zone-fields">
                  <div className="builder-group">
                    <span className="builder-label" title="How fan speed percentages are encoded into IPMI bytes. Most modern boards use decimal_hex (0-100%). Older Dell/Supermicro X9 use byte_scale (0-255).">Speed Translation</span>
                    <div className="toggle-presets">
                      {(['decimal_hex', 'byte_scale', 'integer'] as const).map((t) => (
                        <button
                          key={t}
                          className={`toggle-item ${zone.speed_translation.type === t ? 'active' : ''}`}
                          onClick={() =>
                            updateZone(zi, {
                              speed_translation: {
                                ...zone.speed_translation,
                                type: t,
                                output_min: t === 'byte_scale' ? 0 : 0,
                                output_max: t === 'byte_scale' ? 255 : 100,
                              },
                            })
                          }
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                    {hints && <p className="profile-vendor-hint">{hints.speedTranslation}</p>}
                  </div>
                  <div className="builder-group">
                    <span className="builder-label">Output Min</span>
                    <input
                      className="hub-url-input"
                      type="number"
                      value={zone.speed_translation.output_min}
                      onChange={(e) =>
                        updateZone(zi, {
                          speed_translation: {
                            ...zone.speed_translation,
                            output_min: Number(e.target.value),
                          },
                        })
                      }
                      style={{ maxWidth: 100 }}
                    />
                  </div>
                  <div className="builder-group">
                    <span className="builder-label">Output Max</span>
                    <input
                      className="hub-url-input"
                      type="number"
                      value={zone.speed_translation.output_max}
                      onChange={(e) =>
                        updateZone(zi, {
                          speed_translation: {
                            ...zone.speed_translation,
                            output_max: Number(e.target.value),
                          },
                        })
                      }
                      style={{ maxWidth: 100 }}
                    />
                  </div>
                </div>

                {/* Set Speed Command */}
                <div className="profile-command-group">
                  <span className="builder-label" title="The raw IPMI bytes for setting fan speed. Use {{SPEED_HEX}} where the speed value should go — Pankha replaces it with the calculated hex value at runtime. Check vendor docs, ServeTheHome forums, or TrueNAS community for your hardware's commands.">
                    Set Speed Command
                  </span>
                  {hints && <p className="profile-vendor-hint">{hints.setSpeed}</p>}
                  <div className="profile-command-row">
                    <input
                      className="hub-url-input"
                      value={zone.set_speed_bytes}
                      onChange={(e) =>
                        updateZone(zi, { set_speed_bytes: e.target.value })
                      }
                      placeholder={hints?.placeholders.setSpeed || '0x30 0x70 0x66 0x01 0x00 {{SPEED_HEX}}'}
                      style={{ flex: 1 }}
                    />
                    <div className="profile-test-controls">
                      <input
                        className="hub-url-input"
                        type="number"
                        min={0}
                        max={100}
                        value={testSpeed}
                        onChange={(e) => setTestSpeed(Number(e.target.value))}
                        style={{ width: 60 }}
                        title="Test speed %"
                      />
                      <button
                        className="btn-table-action"
                        onClick={() => testSetSpeed(zi)}
                        disabled={!selectedSystemId || !zone.set_speed_bytes.trim() || executing === `set_${zi}`}
                        title={`Test set speed at ${testSpeed}%`}
                      >
                        <Play size={12} />
                        {executing === `set_${zi}` ? 'Running...' : `Test ${testSpeed}%`}
                      </button>
                    </div>
                  </div>
                  {renderTestResult(zone.set_speed_result)}
                </div>

                {/* Read Speed Command */}
                <div className="profile-command-group">
                  <span className="builder-label" title="Optional OEM command to read current fan duty cycle. If left blank, Pankha reads fan RPM from SDR instead. Most vendors don't need this — only Supermicro X10+ and Tyan have OEM read commands.">Read Speed Command (optional)</span>
                  {hints && <p className="profile-vendor-hint">{hints.readSpeed}</p>}
                  <div className="profile-command-row">
                    <input
                      className="hub-url-input"
                      value={zone.read_speed_bytes}
                      onChange={(e) =>
                        updateZone(zi, { read_speed_bytes: e.target.value })
                      }
                      placeholder={hints?.placeholders.readSpeed || '0x30 0x70 0x66 0x00 0x00'}
                      style={{ flex: 1 }}
                    />
                    <button
                      className="btn-table-action"
                      onClick={() => testReadSpeed(zi)}
                      disabled={!selectedSystemId || !zone.read_speed_bytes.trim() || executing === `read_${zi}`}
                    >
                      <Play size={12} />
                      {executing === `read_${zi}` ? 'Running...' : 'Test Read'}
                    </button>
                  </div>
                  {renderTestResult(zone.read_speed_result)}
                </div>
              </div>
            ))}

            <button className="btn-table-action" onClick={addZone}>
              <Plus size={12} /> Add Zone
            </button>
          </div>

          {/* ── Step 4: Lifecycle Commands ────────────────────── */}
          <div className={`profile-builder-step${isUnsupported ? ' profile-step-disabled' : ''}`}>
            <span className="builder-label" title="Commands to disable automatic fan control before Pankha takes over. Required for most vendors — without this, the BMC fights manual speed commands. Run once on agent startup.">
              Initialization Commands (run before fan control)
            </span>
            {hints && <p className="profile-vendor-hint">{hints.init}</p>}

            {initCommands.map((cmd, ci) => (
              <div key={ci} className="profile-lifecycle-card">
                <div className="profile-lifecycle-fields">
                  <input
                    className="hub-url-input"
                    value={cmd.name}
                    onChange={(e) =>
                      updateLifecycle(initCommands, setInitCommands, ci, {
                        name: e.target.value,
                      })
                    }
                    placeholder="Command name"
                    style={{ maxWidth: 250 }}
                  />
                  <input
                    className="hub-url-input"
                    value={cmd.bytes}
                    onChange={(e) =>
                      updateLifecycle(initCommands, setInitCommands, ci, {
                        bytes: e.target.value,
                      })
                    }
                    placeholder={hints?.placeholders.init || '0x30 0x45 0x01 0x01'}
                    style={{ flex: 1 }}
                  />
                  <label className="profile-critical-toggle">
                    <input
                      type="checkbox"
                      checked={cmd.critical}
                      onChange={(e) =>
                        updateLifecycle(initCommands, setInitCommands, ci, {
                          critical: e.target.checked,
                        })
                      }
                    />
                    Critical
                  </label>
                  <button
                    className="btn-table-action"
                    onClick={() =>
                      testLifecycleCommand(initCommands, setInitCommands, ci, 'init')
                    }
                    disabled={!selectedSystemId || !cmd.bytes.trim() || executing === `init_${ci}`}
                  >
                    <Play size={12} />
                    {executing === `init_${ci}` ? '...' : 'Test'}
                  </button>
                  {initCommands.length > 1 && (
                    <button
                      className="btn-table-action"
                      onClick={() => removeLifecycle(setInitCommands, ci)}
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
                {renderTestResult(cmd.result)}
              </div>
            ))}

            <button className="btn-table-action" onClick={() => addLifecycle(setInitCommands)}>
              <Plus size={12} /> Add Init Command
            </button>
          </div>

          <div className={`profile-builder-step${isUnsupported ? ' profile-step-disabled' : ''}`}>
            <span className="builder-label" title="Commands to restore factory fan control when Pankha disconnects or shuts down. Ensures fans return to automatic mode so the server stays safe.">
              Reset to Factory Commands (run on shutdown/disconnect)
            </span>
            {hints && <p className="profile-vendor-hint">{hints.reset}</p>}

            {resetCommands.map((cmd, ci) => (
              <div key={ci} className="profile-lifecycle-card">
                <div className="profile-lifecycle-fields">
                  <input
                    className="hub-url-input"
                    value={cmd.name}
                    onChange={(e) =>
                      updateLifecycle(resetCommands, setResetCommands, ci, {
                        name: e.target.value,
                      })
                    }
                    placeholder="Command name"
                    style={{ maxWidth: 250 }}
                  />
                  <input
                    className="hub-url-input"
                    value={cmd.bytes}
                    onChange={(e) =>
                      updateLifecycle(resetCommands, setResetCommands, ci, {
                        bytes: e.target.value,
                      })
                    }
                    placeholder={hints?.placeholders.reset || '0x30 0x45 0x01 0x00'}
                    style={{ flex: 1 }}
                  />
                  <label className="profile-critical-toggle">
                    <input
                      type="checkbox"
                      checked={cmd.critical}
                      onChange={(e) =>
                        updateLifecycle(resetCommands, setResetCommands, ci, {
                          critical: e.target.checked,
                        })
                      }
                    />
                    Critical
                  </label>
                  <button
                    className="btn-table-action"
                    onClick={() =>
                      testLifecycleCommand(resetCommands, setResetCommands, ci, 'reset')
                    }
                    disabled={!selectedSystemId || !cmd.bytes.trim() || executing === `reset_${ci}`}
                  >
                    <Play size={12} />
                    {executing === `reset_${ci}` ? '...' : 'Test'}
                  </button>
                  {resetCommands.length > 1 && (
                    <button
                      className="btn-table-action"
                      onClick={() => removeLifecycle(setResetCommands, ci)}
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
                {renderTestResult(cmd.result)}
              </div>
            ))}

            <button className="btn-table-action" onClick={() => addLifecycle(setResetCommands)}>
              <Plus size={12} /> Add Reset Command
            </button>
          </div>

          {/* ── Step 5: Review & Export ───────────────────────── */}
          <div className={`profile-builder-step${isUnsupported ? ' profile-step-disabled' : ''}`}>
            <span className="builder-label">Review &amp; Export</span>
            <div className="profile-json-preview">
              <pre>{JSON.stringify(buildProfileJson(), null, 2)}</pre>
            </div>

            <div className="profile-export-actions">
              <button className="btn-outline-tactical" onClick={handleDownload}>
                <Download size={14} /> Download JSON
              </button>
              <button
                className="btn-outline-tactical"
                onClick={handleAssignToAgent}
                disabled={!selectedSystem || !vendor.trim()}
              >
                <Upload size={14} /> Assign to Agent
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

export default ProfileBuilder;

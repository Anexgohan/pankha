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

// ─── Component ──────────────────────────────────────────────────────

const ProfileBuilder: React.FC<ProfileBuilderProps> = ({ systems }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  // Step 1: Target agent
  const [selectedSystemId, setSelectedSystemId] = useState<number | null>(null);

  // Step 2: Metadata
  const [vendor, setVendor] = useState('');
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
            <div className="profile-builder-metadata-grid">
              <div className="builder-group">
                <span className="builder-label">Vendor Name</span>
                <input
                  className="hub-url-input"
                  value={vendor}
                  onChange={(e) => setVendor(e.target.value)}
                  placeholder="e.g. ASRock"
                />
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
          <div className="profile-builder-step">
            <span className="builder-label">Fan Zones</span>

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
                    <span className="builder-label">Members (comma-sep)</span>
                    <input
                      className="hub-url-input"
                      value={zone.members}
                      onChange={(e) => updateZone(zi, { members: e.target.value })}
                      placeholder="FAN1, FAN2, FAN3"
                    />
                  </div>
                </div>

                {/* Speed Translation */}
                <div className="profile-zone-fields">
                  <div className="builder-group">
                    <span className="builder-label">Speed Translation</span>
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
                  <span className="builder-label">
                    Set Speed Command (use {'{{SPEED_HEX}}'} placeholder)
                  </span>
                  <div className="profile-command-row">
                    <input
                      className="hub-url-input"
                      value={zone.set_speed_bytes}
                      onChange={(e) =>
                        updateZone(zi, { set_speed_bytes: e.target.value })
                      }
                      placeholder="0x30 0x70 0x66 0x01 0x00 {{SPEED_HEX}}"
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
                  <span className="builder-label">Read Speed Command (optional)</span>
                  <div className="profile-command-row">
                    <input
                      className="hub-url-input"
                      value={zone.read_speed_bytes}
                      onChange={(e) =>
                        updateZone(zi, { read_speed_bytes: e.target.value })
                      }
                      placeholder="0x30 0x70 0x66 0x00 0x00"
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
          <div className="profile-builder-step">
            <span className="builder-label">
              Initialization Commands (run before fan control)
            </span>

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
                    placeholder="0x30 0x45 0x01 0x01"
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

          <div className="profile-builder-step">
            <span className="builder-label">
              Reset to Factory Commands (run on shutdown/disconnect)
            </span>

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
                    placeholder="0x30 0x45 0x01 0x00"
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
          <div className="profile-builder-step">
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

import React, { useState, useEffect, useMemo } from "react";
import type { SystemData, SensorReading, FanReading } from "../../types/api";
import {
  deleteSystem,
  setAgentUpdateInterval,
  setFanStep,
  setHysteresis,
  setEmergencyTemp,
  setLogLevel,
  setFailsafeSpeed,
  setEnableFanControl,
  getFanAssignments,
  updateSensorLabel,
  updateFanLabel,
  updateAgentName,
  updateSensorVisibility,
  updateGroupVisibility,
  updateFanVisibility,
  updateSensorOrder,
  updateSensorGroupOrder,
  getSystemCalibrations,
  calibrateFan,
} from "../../services/api";
import type { SystemCalibrations } from "../../services/api";
import { useVisibility } from "../../contexts/VisibilityContext";
import {
  getFanProfiles,
  assignProfileToFan,
  type FanProfile,
} from "../../services/fanProfilesApi";
import { getFanProfileTypes } from "../../services/fanProfileTypesApi";
import type { FanProfileType } from "../../services/fanProfileTypesApi";
import { Select } from "../../components/ui/Select";
import type { SelectOption } from "../../components/ui/Select";
import { buildProfileOptions, makeProfileRenderers, NO_PROFILE } from "./profileSelectOptions";
import { buildSensorOptions, renderSensorTrigger, renderSensorOption } from "./sensorSelectOptions";
import {
  setFanSensor,
  getFanConfigurations,
} from "../../services/fanConfigurationsApi";
import { getChipDisplayName, getSensorLabel } from "../../config/sensorLabels";
import { sortSensorGroups, deriveSensorGroupId, groupSensorsByChip, compareSensorGroups } from "../../utils/sensorUtils";
import { sortByOrder } from "../../utils/ordering";
import { getFanDisplayName } from "../../utils/displayNames";
import { getTemperatureClass, getFanRPMClass } from "../../utils/statusColors";
import { formatTemperature, formatLastSeen, USER_TIMEZONE } from "../../utils/formatters";
import { useDashboardSettings } from "../../contexts/DashboardSettingsContext";
import {
  Loader2,
  X,
  ChevronDown,
  ChevronRight,
  Globe,
  Clock,
  Zap,
  ShieldCheck,
  Activity,
  Wind,
  Thermometer,
  ThermometerSun,
  Lock as LockIcon,
  Search,
  Plus,
  Sliders
} from 'lucide-react';
import { toast } from "../../utils/toast";
import { InlineEdit } from "../../components/InlineEdit";
import FanItem from "./FanItem";
import FanInfoCard from "./FanInfoCard";
import { BulkEditPanel } from "./BulkEditPanel";
import SensorBuilderModal from "./SensorBuilderModal";
import ManageSensorsModal from "./ManageSensorsModal";
import { useVirtualSensors } from "../hooks/useVirtualSensors";
import { useSensorOrder } from "../hooks/useSensorOrder";
import { updateVirtualSensor, updateVirtualSensorOrder } from "../../services/virtualSensorsApi";
import type { VirtualSensor } from "../../types/api";
import SensorItem from "./SensorItem";
import BmcProfilePicker from "./BmcProfilePicker";
import { useSensorHistory } from "../hooks/useSensorHistory";
import { assignProfileToAgent } from "../../services/api";
import { getOption, getValues, getLabel, getCleanLabel, getDefault, interpolateTooltip } from "../../utils/uiOptions";

// Settings-select options from the ui-options.json SST (static per session)
const toSelectOptions = <T extends string | number>(key: Parameters<typeof getValues>[0]) =>
  (getValues(key) as { value: T; label: string }[]).map(
    (o): SelectOption<T> => ({ value: o.value, label: o.label })
  );
const SETTING_OPTIONS = {
  logLevel: toSelectOptions<string>('logLevel'),
  emergencyTemp: toSelectOptions<number>('emergencyTemp'),
  failsafeSpeed: toSelectOptions<number>('failsafeSpeed'),
  updateInterval: toSelectOptions<number>('updateInterval'),
  fanStep: toSelectOptions<number>('fanStep'),
  hysteresis: toSelectOptions<number>('hysteresis'),
};

interface SystemCardProps {
  system: SystemData;
  isDemoMode: boolean;
  onUpdate: () => void;
  onRemove: () => void;
  expandedSensors: boolean;
  expandedFans: boolean;
  expandedBmc: boolean;
  onToggleSensors: (expanded: boolean) => void;
  onToggleFans: (expanded: boolean) => void;
  onToggleBmc: (expanded: boolean) => void;
  // Fan calibration + stall state pushed via WS, keyed "agentId:fanName"
  fanCalibration: Record<string, string>;
  stalledFans: Record<string, boolean>;
}

const SystemCard: React.FC<SystemCardProps> = ({
  system,
  isDemoMode,
  onUpdate,
  onRemove,
  expandedSensors,
  expandedFans,
  expandedBmc,
  onToggleSensors,
  onToggleFans,
  onToggleBmc,
  fanCalibration,
  stalledFans,
}) => {
  const [loading, setLoading] = useState<string | null>(null);
  const { tempThresholds } = useDashboardSettings();

  // Fan calibration/stall lookups. During calibration the backend
  // owns the fan - controls are disabled and a Calibrating badge is shown.
  // WS events win when present; the REST snapshot covers pages that loaded
  // or reconnected mid-calibration and never saw the "running" event.
  const isFanCalibrating = (fanId: string) => {
    const ws = fanCalibration[`${system.agent_id}:${fanId}`];
    if (ws !== undefined) return ws === "running";
    return calSnapshot?.calibrations[fanId]?.status === "running";
  };
  const isFanStalled = (fanId: string) =>
    !!stalledFans[`${system.agent_id}:${fanId}`];

  // Calibration snapshot for the rack icons (status/version/date per fan).
  // Refetched whenever a WS calibration event lands, so terminal states pick
  // up their stamped version and date.
  const [calSnapshot, setCalSnapshot] = useState<SystemCalibrations | null>(null);
  useEffect(() => {
    let cancelled = false;
    getSystemCalibrations(system.id)
      .then((snap) => {
        if (!cancelled) setCalSnapshot(snap);
      })
      .catch(() => {
        // icons fall back to "pending"; next WS event retries
      });
    return () => {
      cancelled = true;
    };
  }, [system.id, fanCalibration]);
  const [agentInterval, setAgentInterval] = useState<number>(
    system.current_update_interval ?? getDefault<number>('updateInterval')
  );
  // filterDuplicates and sensorTolerance state removed (deprecated feature)
  const [fanStep, setFanStepLocal] = useState<number>(
    system.fan_step_percent ?? getDefault<number>('fanStep')
  );
  const [hysteresis, setHysteresisLocal] = useState<number>(
    system.hysteresis_temp ?? getDefault<number>('hysteresis')
  );
  const [emergencyTemp, setEmergencyTempLocal] = useState<number>(
    system.emergency_temp ?? getDefault<number>('emergencyTemp')
  );
  const [logLevel, setLogLevelLocal] = useState<string>(
    system.log_level ?? getDefault<string>('logLevel')
  );
  const [failsafeSpeed, setFailsafeSpeedLocal] = useState<number>(
    system.failsafe_speed ?? getDefault<number>('failsafeSpeed')
  );
  const [enableFanControl, setEnableFanControlLocal] = useState<boolean>(
    system.enable_fan_control ?? getDefault<boolean>('fanControl')
  );
  const [showHidden, setShowHidden] = useState(false);
  const [fanProfiles, setFanProfiles] = useState<FanProfile[]>([]);
  // Lookup `profile_type` -> hex color for the dropdown. Populated once on
  // mount from /api/fan-profile-types; the catalog rarely changes during a
  // session so we don't refresh on profile create/delete - a stale entry
  // here just means the dot falls back to neutral grey, not a broken UI.
  const [typeColorMap, setTypeColorMap] = useState<Record<string, string | null>>({});
  const [selectedSensors, setSelectedSensors] = useState<
    Record<string, string>
  >({});
  const [selectedProfiles, setSelectedProfiles] = useState<
    Record<string, number>
  >({});
  const [isBulkEditOpen, setIsBulkEditOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  // Fan whose info card is open (null = closed; the card unmounts entirely)
  const [infoFanId, setInfoFanId] = useState<string | null>(null);
  const [isCardInView, setIsCardInView] = useState(true);
  const [stagedBmcProfileId, setStagedBmcProfileId] = useState<string | null>(
    system.profile_id ?? null
  );
  const [appliedProfileId, setAppliedProfileId] = useState<string | null>(
    system.profile_id ?? null
  );
  useEffect(() => {
    setStagedBmcProfileId(system.profile_id ?? null);
    setAppliedProfileId(system.profile_id ?? null);
  }, [system.profile_id]);
  const cardRef = React.useRef<HTMLDivElement>(null);
  const fanRpmStateRef = React.useRef<Record<string, { rpm: number; decreasing: boolean }>>({});

  React.useEffect(() => {
    if (system.current_fan_speeds) {
      const prev = fanRpmStateRef.current;
      const next: Record<string, { rpm: number; decreasing: boolean }> = {};
      for (const fan of system.current_fan_speeds) {
        const p = prev[fan.id];
        if (!p) {
          next[fan.id] = { rpm: fan.rpm, decreasing: false };
        } else {
          const delta = fan.rpm - p.rpm;
          const threshold = Math.max(p.rpm * 0.01, 50);
          if (Math.abs(delta) < threshold) {
            next[fan.id] = { rpm: p.rpm, decreasing: p.decreasing };
          } else if (delta < 0) {
            next[fan.id] = { rpm: fan.rpm, decreasing: true };
          } else {
            next[fan.id] = { rpm: fan.rpm, decreasing: false };
          }
        }
      }
      fanRpmStateRef.current = next;
    }
  }, [system.current_fan_speeds]);

  useEffect(() => {
    const element = cardRef.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        setIsCardInView(entry ? entry.isIntersecting : true);
      },
      { threshold: 0 }
    );

    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  const handleOpenBulkEdit = () => {
    if (cardRef.current) {
      setAnchorRect(cardRef.current.getBoundingClientRect());
    }
    setIsBulkEditOpen(true);
  };

  const handleOpenFanInfo = (fanId: string) => {
    if (cardRef.current) {
      setAnchorRect(cardRef.current.getBoundingClientRect());
    }
    setInfoFanId(fanId);
  };

  const {
    toggleSensorVisibility,
    isSensorHidden,
    toggleGroupVisibility,
    isGroupHidden,
    toggleFanVisibility,
    isFanHidden,
  } = useVisibility();

  // 24h Sensor History Hook with real-time WebSocket updates
  const { history, setExpanded: setHistoryExpanded } = useSensorHistory(
    system.id,
    system.agent_id,
    isCardInView
  );

  // Track sensor section expansion for history updates
  useEffect(() => {
    setHistoryExpanded(expandedSensors);
  }, [expandedSensors, setHistoryExpanded]);

  // Virtual sensors (user-built aggregates). Values are computed client-side from
  // member temps by the hook, which also keeps a 15-min sparkline buffer.
  const { rows: virtualRows, reload: reloadVirtualSensors } = useVirtualSensors(
    system.id,
    system.current_temperatures
  );

  // Shared/DB-backed sensor + group display order (Phase 2). Fetched off the WebSocket
  // path and refetched after a reorder; NULL positions fall back to the default order.
  const { order: sensorOrder, refetch: refetchSensorOrder } = useSensorOrder(system.id);

  const handleReorderSensors = async (orderedSensorIds: number[]) => {
    try {
      await updateSensorOrder(system.id, orderedSensorIds);
      await refetchSensorOrder();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to reorder sensors");
    }
  };
  const handleReorderGroups = async (orderedGroupNames: string[]) => {
    try {
      await updateSensorGroupOrder(system.id, orderedGroupNames);
      await refetchSensorOrder();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to reorder groups");
    }
  };
  const handleReorderVirtual = async (orderedIds: number[]) => {
    try {
      await updateVirtualSensorOrder(system.id, orderedIds);
      await Promise.all([reloadVirtualSensors(), refetchSensorOrder()]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to reorder virtual sensors");
    }
  };

  // Control Sensor dropdown ordering (Phase 2): make the picker agree with the dashboard.
  // Groups by group order (then alpha); individual sensors by group order, then sensor
  // order within the group, then name. The `!==` guards avoid Infinity - Infinity = NaN.
  const orderGroupIds = (ids: string[]): string[] =>
    sortByOrder(ids, (g) => sensorOrder.groups[g], (a, b) => compareSensorGroups(a, b));
  const compareSensorsForDropdown = (a: SensorReading, b: SensorReading): number => {
    const ga = deriveSensorGroupId(a);
    const gb = deriveSensorGroupId(b);
    if (ga !== gb) {
      const oa = sensorOrder.groups[ga] ?? Infinity;
      const ob = sensorOrder.groups[gb] ?? Infinity;
      if (oa !== ob) return oa - ob;
      return compareSensorGroups(ga, gb);
    }
    const sa = (a.dbId != null ? sensorOrder.sensors[a.dbId] : undefined) ?? Infinity;
    const sb = (b.dbId != null ? sensorOrder.sensors[b.dbId] : undefined) ?? Infinity;
    if (sa !== sb) return sa - sb;
    return a.id.localeCompare(b.id);
  };

  const [builderOpen, setBuilderOpen] = useState(false);
  const [builderEditing, setBuilderEditing] = useState<VirtualSensor | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  // Capture the card rect so these modals anchor beside the card (desktop), like Bulk Edit.
  const captureAnchor = () => { if (cardRef.current) setAnchorRect(cardRef.current.getBoundingClientRect()); };
  const openNewVirtual = () => { captureAnchor(); setBuilderEditing(null); setBuilderOpen(true); };
  const openEditVirtual = (vs: VirtualSensor) => { captureAnchor(); setBuilderEditing(vs); setBuilderOpen(true); };
  const openManage = () => { captureAnchor(); setManageOpen(true); };

  // Stable identity keys - reload configs only when the set of fans/sensors changes,
  // not on every temperature/RPM value update (which fires every agent update interval).
  // This prevents the useEffect from overwriting user's in-flight dropdown changes.
  const fanIdsKey = useMemo(
    () => system.current_fan_speeds?.map(f => f.id).sort().join(',') || '',
    [system.current_fan_speeds]
  );
  const sensorIdsKey = useMemo(
    () => system.current_temperatures?.map(s => s.id).sort().join(',') || '',
    [system.current_temperatures]
  );

  // Load the profile-type color catalog once. Done in a separate effect
  // (not bundled with the per-fan profile-assignment loader below) because
  // the catalog isn't tied to fanIdsKey - we want it whether or not fans
  // have been discovered, so the dropdown is ready to render correct colors
  // the moment any profile is selectable.
  useEffect(() => {
    let cancelled = false;
    getFanProfileTypes()
      .then(types => {
        if (cancelled) return;
        setTypeColorMap(
          types.reduce<Record<string, string | null>>((acc, t: FanProfileType) => {
            acc[t.name] = t.color;
            return acc;
          }, {})
        );
      })
      .catch(err => {
        // Non-fatal: dropdown still renders, just without color cues.
        console.error('Failed to load fan profile types for color map:', err);
      });
    return () => { cancelled = true; };
  }, []);

  // Sorted + grouped profile lists for the fan-profile dropdown.
  // Order in the popup: Manual placeholder -> System (A-Z) -> User (A-Z).
  // Memoised so the sort only re-runs when fanProfiles changes, not on
  // every render of this card.
  const { systemProfiles, userProfiles } = useMemo(() => {
    const system: FanProfile[] = [];
    const user: FanProfile[] = [];
    for (const p of fanProfiles) {
      (p.created_by === 'system' ? system : user).push(p);
    }
    const byName = (a: FanProfile, b: FanProfile) =>
      a.profile_name.localeCompare(b.profile_name);
    system.sort(byName);
    user.sort(byName);
    return { systemProfiles: system, userProfiles: user };
  }, [fanProfiles]);

  // Design1 <Select> parts for the Fan Profile dropdowns (zone + per-fan).
  const profileSelectGroups = useMemo(
    () => buildProfileOptions(systemProfiles, userProfiles),
    [systemProfiles, userProfiles]
  );
  const profileRenderers = useMemo(() => makeProfileRenderers(typeColorMap), [typeColorMap]);
  // Bulk-edit variants: same lists, "" row reads "Don't change"
  const bulkProfileGroups = useMemo(
    () => buildProfileOptions(systemProfiles, userProfiles, "Don't change"),
    [systemProfiles, userProfiles]
  );
  const bulkProfileRenderers = useMemo(
    () => makeProfileRenderers(typeColorMap, "Don't change"),
    [typeColorMap]
  );

  // Load fan profiles, assignments, and configurations on mount and when hardware structure changes
  useEffect(() => {
    // Skip if no fans/sensors discovered yet - will re-fire when they appear
    if (!fanIdsKey) return;

    const loadProfilesAndAssignments = async () => {
      try {
        // Load profiles
        console.log("Loading fan profiles...");
        const profiles = await getFanProfiles(system.id, true);
        console.log("Fan profiles loaded:", profiles.length);
        setFanProfiles(profiles);

        // Load fan configurations (independent sensor assignments)
        console.log("Loading fan configurations...");
        const configs = await getFanConfigurations(system.id);
        console.log("Fan configurations loaded:", configs.length);

        // Load profile assignments
        console.log("Loading fan assignments...");
        const assignments = await getFanAssignments(system.id);
        console.log("Fan assignments loaded:", assignments.length);

        // Map assignments to dropdown states
        const sensorMap: Record<string, string> = {};
        const profileMap: Record<string, number> = {};

        // First, load from fan configurations (independent sensor assignments)
        configs.forEach((config: any) => {
          const fan = system.current_fan_speeds?.find(
            (f) => f.dbId === config.fan_id
          );
          if (fan && config.sensor_id) {
            if (typeof config.sensor_id === "string") {
              sensorMap[fan.id] = config.sensor_id;
            } else {
              const sensor = system.current_temperatures?.find(
                (s) => s.dbId === config.sensor_id
              );
              if (sensor) {
                sensorMap[fan.id] = sensor.id;
              }
            }
          }
        });

        // Then load profile assignments
        assignments.forEach((assignment: any) => {
          const fan = system.current_fan_speeds?.find(
            (f) => f.dbId === assignment.fan_id
          );
          if (fan) {
            profileMap[fan.id] = assignment.profile_id;

            // If no sensor from config, use sensor from assignment (fallback)
            if (!sensorMap[fan.id] && assignment.sensor_id) {
              if (typeof assignment.sensor_id === "string") {
                console.log(
                  `Setting sensor for fan ${fan.id} to special identifier:`,
                  assignment.sensor_id
                );
                sensorMap[fan.id] = assignment.sensor_id;
              } else {
                const sensor = system.current_temperatures?.find(
                  (s) => s.dbId === assignment.sensor_id
                );
                console.log(
                  `Looking for sensor with dbId ${assignment.sensor_id} for fan ${fan.id}, found:`,
                  sensor?.id
                );
                if (sensor) {
                  sensorMap[fan.id] = sensor.id;
                }
              }
            }
          }
        });

        console.log("Final sensorMap:", sensorMap);
        console.log("Final profileMap:", profileMap);

        setSelectedSensors(sensorMap);
        setSelectedProfiles(profileMap);
      } catch (error) {
        console.error("Failed to load fan profiles and assignments:", error);
      }
    };
    loadProfilesAndAssignments();
  }, [system.id, fanIdsKey, sensorIdsKey]);

  // Sync local state with system prop changes (e.g., when dashboard refreshes)
  useEffect(() => {
    if (system.current_update_interval !== undefined) {
      setAgentInterval(system.current_update_interval);
    }
    // filter_duplicate_sensors sync removed (deprecated)
    // duplicate_sensor_tolerance sync removed (deprecated)
    if (system.fan_step_percent !== undefined) {
      setFanStepLocal(system.fan_step_percent);
    }
    if (system.hysteresis_temp !== undefined) {
      setHysteresisLocal(system.hysteresis_temp);
    }
    if (system.emergency_temp !== undefined) {
      setEmergencyTempLocal(system.emergency_temp);
    }
    if (system.log_level !== undefined) {
      setLogLevelLocal(system.log_level);
    }
    if (system.failsafe_speed !== undefined) {
      setFailsafeSpeedLocal(system.failsafe_speed);
    }
    if (system.enable_fan_control !== undefined) {
      setEnableFanControlLocal(isDemoMode ? true : system.enable_fan_control);
    }
  }, [
    isDemoMode,
    system.current_update_interval,
    // filter_duplicate_sensors removed (deprecated)
    // duplicate_sensor_tolerance removed (deprecated)
    system.fan_step_percent,
    system.hysteresis_temp,
    system.emergency_temp,
    system.log_level,
    system.failsafe_speed,
    system.enable_fan_control,
  ]);

  // In demo mode, keep fan control ON if incoming data reports it disabled.
  useEffect(() => {
    if (!isDemoMode || system.read_only === true || system.enable_fan_control !== false) {
      return;
    }

    let isCancelled = false;

    const enforceFanControl = async () => {
      try {
        setLoading("enable-fan-control");
        const result = await setEnableFanControl(system.id, true);
        if (result.locked) {
          toast.warning(
            result.message || "Fan Control cannot be disabled, it is locked in demo"
          );
          return;
        }
        if (!isCancelled) {
          setEnableFanControlLocal(true);
        }
      } catch (error) {
        toast.error(
          "Failed to enforce fan control in demo mode: " +
            (error instanceof Error ? error.message : "Unknown error")
        );
      } finally {
        if (!isCancelled) {
          setLoading(null);
        }
      }
    };

    enforceFanControl();

    return () => {
      isCancelled = true;
    };
  }, [isDemoMode, system.read_only, system.enable_fan_control, system.id]);

  // Wrapper to toggle sensor visibility (updates both localStorage and backend)
  const handleToggleSensorVisibility = async (
    sensorId: string,
    sensorDbId?: number
  ) => {
    // Update localStorage immediately for responsive UI
    toggleSensorVisibility(sensorId);

    // Sync to backend if we have dbId
    if (sensorDbId) {
      try {
        const isHidden = !isSensorHidden(sensorId); // Will be toggled state
        await updateSensorVisibility(system.id, sensorDbId, isHidden);
      } catch (error) {
        console.error("Failed to sync sensor visibility to backend:", error);
      }
    }
  };

  // Wrapper to toggle group visibility (updates both localStorage and backend)
  const handleToggleGroupVisibility = async (groupId: string) => {
    // Update localStorage immediately for responsive UI
    toggleGroupVisibility(groupId);

    // Sync to backend
    try {
      const isHidden = !isGroupHidden(groupId); // Will be toggled state
      await updateGroupVisibility(system.id, groupId, isHidden);
    } catch (error) {
      console.error("Failed to sync group visibility to backend:", error);
    }
  };

  // Wrapper to toggle fan visibility (updates both localStorage and backend)
  const handleToggleFanVisibility = async (
    fanId: string,
    fanDbId?: number
  ) => {
    toggleFanVisibility(fanId);

    if (fanDbId) {
      try {
        const isHidden = !isFanHidden(fanId);
        await updateFanVisibility(system.id, fanDbId, isHidden);
      } catch (error) {
        console.error("Failed to sync fan visibility to backend:", error);
      }
    }
  };

// icons are generally 96x96 resolution from icons8
  const getSensorIcon = (type: string) => {
    switch (type.toLowerCase()) {
      case "cpu":
        return <img src="/icons/processor-01.png" width={24} height={24} title="Processor" alt="Processor" />;
      case "gpu":
        return <img src="/icons/video-card-01.png" width={24} height={24} title="GPU" alt="GPU" />;
      case "motherboard":
        return <img src="/icons/motherboard-01.png" width={24} height={24} title="Motherboard" alt="Motherboard" />;
      case "pch":
        return <img src="/icons/icons8-electronics-96.png" width={24} height={24} title="PCH" alt="PCH" />;
      case "peripheral":
      case "pcie":
        return <img src="/icons/pci-e-01.png" width={24} height={24} title="Peripheral / PCIe" alt="Peripheral / PCIe" />;
      case "system":
      case "ambient":
        return <ThermometerSun size={20} />;
      case "memory":
      case "ram":
      case "dimm":
        return <img src="/icons/ram-01.png" width={24} height={24} title="Memory" alt="Memory" />;
      case "vrm":
        return <img src="/icons/vrm-01.png" width={24} height={24} title="VRM" alt="VRM" />;
      case "bmc":
        return <img src="/icons/bmc-01.png" width={24} height={24} title="BMC" alt="BMC" />;
      case "nic":
      case "network":
        return <img src="/icons/nic-01.png" width={24} height={24} title="NIC" alt="NIC" />;
      case "nvme":
      case "storage":
        return <img src="/icons/hdd-01.png" width={24} height={24} title="Storage" alt="Storage" />;
      case "acpi":
        return <Thermometer size={20} />;
      case "virtual":
        return <img src="/icons/motion-sensor-01.png" width={24} height={24} title="Virtual Sensor" alt="Virtual Sensor" />;
      default:
        return <Search size={20} />;
    }
  };

  // Removed manual fan speed control - profiles handle speed now
  // Original handleFanSpeedChange function removed as fans are now controlled via profiles

  const handleDeleteSystem = async () => {
    if (isDemoMode) {
      toast.warning("Cannot remove system, locked in demo");
      return;
    }

    if (
      !confirm(
        `Are you sure you want to delete "${system.name}"? This action cannot be undone.`
      )
    ) {
      return;
    }

    try {
      setLoading("delete");
      const result = await deleteSystem(system.id);
      if (result.locked) {
        toast.warning(result.message || "Cannot remove system, locked in demo");
        return;
      }
      toast.success(`System "${system.name}" deleted successfully`);
      onRemove();
    } catch (error) {
      toast.error(
        "Failed to delete system: " +
          (error instanceof Error ? error.message : "Unknown error")
      );
    } finally {
      setLoading(null);
    }
  };

  const handleAgentIntervalChange = async (newInterval: number) => {
    try {
      setLoading("agent-interval");
      await setAgentUpdateInterval(system.id, newInterval);
      setAgentInterval(newInterval);
      // No need to call onUpdate() since this doesn't affect displayed data
    } catch (error) {
      toast.error(
        "Failed to set agent refresh rate: " +
          (error instanceof Error ? error.message : "Unknown error")
      );
    } finally {
      setLoading(null);
    }
  };

  // handleFilterDuplicatesChange removed (deprecated feature)
  // handleSensorToleranceChange removed (deprecated feature)

  const handleBmcApply = async () => {
    if (!stagedBmcProfileId || stagedBmcProfileId === (system.profile_id ?? null)) return;
    if (isDemoMode) {
      toast.warning("Profile Change not allowed, it is locked in demo");
      return;
    }
    try {
      setLoading("bmc-apply");
      const result = await assignProfileToAgent(system.agent_id, stagedBmcProfileId);
      if (result.locked) {
        toast.warning(result.message || "Profile Change not allowed, it is locked in demo");
        return;
      }
      setAppliedProfileId(stagedBmcProfileId);
      toast.success(`BMC profile assigned: ${stagedBmcProfileId}`);
      onUpdate();
    } catch (error) {
      toast.error(
        "Failed to assign BMC profile: " +
          (error instanceof Error ? error.message : "Unknown error")
      );
    } finally {
      setLoading(null);
    }
  };

  const handleFanStepChange = async (newStep: number) => {
    try {
      setLoading("fan-step");
      await setFanStep(system.id, newStep);
      setFanStepLocal(newStep);
      // No need to call onUpdate() since this doesn't affect displayed data
    } catch (error) {
      toast.error(
        "Failed to set fan step: " +
          (error instanceof Error ? error.message : "Unknown error")
      );
    } finally {
      setLoading(null);
    }
  };

  const handleHysteresisChange = async (newHysteresis: number) => {
    try {
      setLoading("hysteresis");
      await setHysteresis(system.id, newHysteresis);
      setHysteresisLocal(newHysteresis);
      // No need to call onUpdate() since this doesn't affect displayed data
    } catch (error) {
      toast.error(
        "Failed to set hysteresis: " +
          (error instanceof Error ? error.message : "Unknown error")
      );
    } finally {
      setLoading(null);
    }
  };

  const handleEmergencyTempChange = async (newTemp: number) => {
    try {
      setLoading("emergency-temp");
      await setEmergencyTemp(system.id, newTemp);
      setEmergencyTempLocal(newTemp);
      // No need to call onUpdate() since this doesn't affect displayed data
    } catch (error) {
      toast.error(
        "Failed to set emergency temperature: " +
          (error instanceof Error ? error.message : "Unknown error")
      );
    } finally {
      setLoading(null);
    }
  };

  const handleLogLevelChange = async (newLevel: string) => {
    try {
      setLoading("log-level");
      await setLogLevel(system.id, newLevel);
      setLogLevelLocal(newLevel);
      // No need to call onUpdate() since this doesn't affect displayed data
    } catch (error) {
      toast.error(
        "Failed to set log level: " +
          (error instanceof Error ? error.message : "Unknown error")
      );
    } finally {
      setLoading(null);
    }
  };

  const handleFailsafeSpeedChange = async (newSpeed: number) => {
    try {
      setLoading("failsafe-speed");
      await setFailsafeSpeed(system.id, newSpeed);
      setFailsafeSpeedLocal(newSpeed);
      // No need to call onUpdate() since this doesn't affect displayed data
    } catch (error) {
      toast.error(
        "Failed to set failsafe speed: " +
          (error instanceof Error ? error.message : "Unknown error")
      );
    } finally {
      setLoading(null);
    }
  };

  const handleEnableFanControlChange = async (enabled: boolean) => {
    if (isDemoMode && enabled === false) {
      setEnableFanControlLocal(true);
      toast.warning("Fan Control cannot be disabled, it is locked in demo");
      return;
    }

    try {
      setLoading("enable-fan-control");
      const result = await setEnableFanControl(system.id, enabled);
      if (result.locked) {
        setEnableFanControlLocal(true);
        toast.warning(
          result.message || "Fan Control cannot be disabled, it is locked in demo"
        );
        return;
      }
      setEnableFanControlLocal(enabled);
      // No need to call onUpdate() since this doesn't affect displayed data
    } catch (error) {
      toast.error(
        "Failed to set enable fan control: " +
          (error instanceof Error ? error.message : "Unknown error")
      );
    } finally {
      setLoading(null);
    }
  };

  const handleFanProfileAssignment = async (
    fan: FanReading,
    profileId: number
  ) => {
    try {
      setLoading(`fan-profile-${fan.id}`);

      if (!fan.dbId) {
        toast.error("Fan database ID not available. Please refresh the page.");
        setLoading(null);
        return;
      }

      // Get the selected sensor for this fan (if any)
      const selectedSensorId = selectedSensors[fan.id];

      // Find the sensor's database ID or special identifier
      let sensorDbId: number | string | undefined = undefined;
      if (selectedSensorId) {
        // Check if it's a special identifier
        if (selectedSensorId.startsWith("__")) {
          // It's a special identifier like "__highest__" or "__group__<name>"
          sensorDbId = selectedSensorId;
        } else {
          // It's a regular sensor - find its database ID
          const sensor = system.current_temperatures?.find(
            (s) => s.id === selectedSensorId
          );
          if (sensor?.dbId) {
            sensorDbId = sensor.dbId;
          } else {
            toast.error(
              "Please select a sensor first or refresh the page to get updated sensor data."
            );
            setLoading(null);
            return;
          }
        }
      }

      await assignProfileToFan({
        fan_id: fan.dbId,
        profile_id: profileId,
        sensor_id: sensorDbId,
      });
      onUpdate();
    } catch (error) {
      toast.error(
        "Failed to assign fan profile: " +
          (error instanceof Error ? error.message : "Unknown error")
      );
    } finally {
      setLoading(null);
    }
  };

  const handleBulkApply = async (
    fanIds: string[],
    sensorId?: string,
    profileId?: number
  ) => {
    // Apply changes to multiple fans at once
    const fans =
      system.current_fan_speeds?.filter((f) => fanIds.includes(f.id)) || [];
    let failCount = 0;

    for (const fan of fans) {
      if (!fan.dbId) continue;

      try {
        // Update sensor if provided
        if (sensorId) {
          let sensorDbId: number | string | null = null;
          if (sensorId.startsWith("__")) {
            sensorDbId = sensorId; // Special identifier
          } else {
            const sensor = system.current_temperatures?.find(
              (s) => s.id === sensorId
            );
            sensorDbId = sensor?.dbId || null;
          }
          await setFanSensor(fan.dbId, sensorDbId);

          // Update local state
          setSelectedSensors((prev) => ({
            ...prev,
            [fan.id]: sensorId,
          }));
        }

        // Update profile if provided
        if (profileId) {
          const selectedSensorId = sensorId || selectedSensors[fan.id];
          let sensorDbId: number | string | undefined = undefined;

          if (selectedSensorId) {
            if (selectedSensorId.startsWith("__")) {
              sensorDbId = selectedSensorId;
            } else {
              const sensor = system.current_temperatures?.find(
                (s) => s.id === selectedSensorId
              );
              if (!sensor?.dbId) {
                toast.error(
                  "Please select a sensor first or refresh the page to get updated sensor data."
                );
                continue;
              }
              sensorDbId = sensor.dbId;
            }
          }

          await assignProfileToFan({
            fan_id: fan.dbId,
            profile_id: profileId,
            sensor_id: sensorDbId,
          });

          // Update local state
          setSelectedProfiles((prev) => ({
            ...prev,
            [fan.id]: profileId,
          }));
        }
      } catch (error) {
        failCount++;
        console.error(`Failed to apply bulk changes to fan ${fan.id}:`, error);
      }
    }

    if (failCount > 0) {
      toast.error(`Failed to apply changes to ${failCount} fan(s)`);
    }
    onUpdate();
  };

  // Format zone ID for display (e.g., "cpu_zone" → "CPU Zone")
  const formatZoneName = (zoneId: string): string => {
    return zoneId.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  };

  // Handle sensor change for all fans in a zone (IPMI zone-level control)
  const handleZoneSensorChange = async (zoneFans: FanReading[], newSensorId: string) => {
    // Update state for all fans in zone
    const updates: Record<string, string> = {};
    for (const f of zoneFans) {
      updates[f.id] = newSensorId;
    }
    setSelectedSensors(prev => ({ ...prev, ...updates }));

    // Save to backend for all fans in zone
    for (const f of zoneFans) {
      if (f.dbId) {
        try {
          let sensorDbId: number | string | null = null;
          if (newSensorId && newSensorId !== "") {
            if (newSensorId.startsWith("__")) {
              sensorDbId = newSensorId;
            } else {
              const sensor = system.current_temperatures?.find(s => s.id === newSensorId);
              sensorDbId = sensor?.dbId || null;
            }
          }
          await setFanSensor(f.dbId, sensorDbId);
        } catch (error) {
          console.error("Failed to save zone sensor selection:", error);
        }
      }
    }
  };

  // Handle profile assignment for all fans in a zone (IPMI zone-level control)
  const handleZoneProfileAssignment = async (zoneFans: FanReading[], profileId: number) => {
    const zoneId = zoneFans[0]?.zone || zoneFans[0]?.id;
    try {
      setLoading(`zone-profile-${zoneId}`);

      const selectedSensorId = selectedSensors[zoneFans[0]?.id];
      let sensorDbId: number | string | undefined = undefined;
      if (selectedSensorId) {
        if (selectedSensorId.startsWith("__")) {
          sensorDbId = selectedSensorId;
        } else {
          const sensor = system.current_temperatures?.find(s => s.id === selectedSensorId);
          if (sensor?.dbId) {
            sensorDbId = sensor.dbId;
          } else {
            toast.error("Please select a sensor first.");
            setLoading(null);
            return;
          }
        }
      }

      // Update state for all fans in zone
      const updates: Record<string, number> = {};
      for (const f of zoneFans) {
        updates[f.id] = profileId;
      }
      setSelectedProfiles(prev => ({ ...prev, ...updates }));

      // Assign profile to all fans in zone
      for (const f of zoneFans) {
        if (f.dbId) {
          await assignProfileToFan({
            fan_id: f.dbId,
            profile_id: profileId,
            sensor_id: sensorDbId,
          });
        }
      }
      onUpdate();
    } catch (error) {
      toast.error(
        "Failed to assign zone profile: " +
          (error instanceof Error ? error.message : "Unknown error")
      );
    } finally {
      setLoading(null);
    }
  };

  // Filter visible sensors for dashboard stats (exclude hidden sensors and groups)
  const visibleSensors =
    system.current_temperatures?.filter(
      (sensor) => !isSensorHidden(sensor.id) && !sensor.isHidden
    ) || [];

  const averageTemperature = visibleSensors.length
    ? visibleSensors.reduce((sum, sensor) => sum + sensor.temperature, 0) /
      visibleSensors.length
    : null;

  const highestTemperature = visibleSensors.length
    ? Math.max(...visibleSensors.map((sensor) => sensor.temperature))
    : null;

  const averageFanRPM = system.current_fan_speeds?.length
    ? system.current_fan_speeds.reduce((sum, fan) => sum + fan.rpm, 0) /
      system.current_fan_speeds.length
    : null;

  const highestFanRPM = system.current_fan_speeds?.length
    ? Math.max(...system.current_fan_speeds.map((fan) => fan.rpm))
    : null;

  // Check if a sensor is hidden (either individually or via group)
  const isSensorOrGroupHidden = (sensor: SensorReading): boolean => {
    // Check backend hidden flag (from database)
    if (sensor.isHidden) {
      return true;
    }

    // Check if sensor itself is hidden in localStorage
    if (isSensorHidden(sensor.id)) {
      return true;
    }

    // Extract chip name from sensor ID using the same pattern as groupSensorsByChip
    const chipName = deriveSensorGroupId(sensor);
    return isGroupHidden(chipName);
  };

  // Control Sensor dropdown (Design1 <Select>) - one option list shared by
  // the zone + per-fan dropdowns. Recomputed per render, like the Design0
  // inline <option> lists were, so temperatures stay live while open.
  const dropdownSensors =
    system.current_temperatures?.filter(
      (sensor: SensorReading) => !isSensorOrGroupHidden(sensor)
    ) || [];
  const dropdownSensorGroups = groupSensorsByChip(dropdownSensors);
  const sensorOptionInputs = {
    highestTemperature,
    virtualRows,
    sensorGroups: dropdownSensorGroups,
    sortedGroupIds: orderGroupIds(Object.keys(dropdownSensorGroups)),
    sortedSensors: [...dropdownSensors].sort(compareSensorsForDropdown),
  };
  const sensorSelectGroups = buildSensorOptions(sensorOptionInputs);
  const bulkSensorGroups = buildSensorOptions({ ...sensorOptionInputs, emptyLabel: "Don't change" });

  // Helper to check if agent is read-only (over license limit OR IPMI without profile)
  const isIpmiNoProfile = (system.agent_type === 'ipmi_host' || system.agent_type === 'ipmi_network') && !system.profile_id && system.status === 'online';
  const isReadOnly = system.read_only === true || isIpmiNoProfile;
  const readOnlyTooltip = isIpmiNoProfile
    ? "Monitor-only mode\nAssign a Profile to enable fan control from Deployment"
    : "This system exceeds your license limit. Upgrade to control this agent. You can still view data.";

  // Manual (re)calibration from the rack icon. A zone member
  // targets its zone id - the backend queues every member fan (atomic unit).
  const handleCalibrateFan = async (fan: FanReading) => {
    const target = fan.zone ?? fan.id;
    const label = fan.zone
      ? formatZoneName(fan.zone)
      : getFanDisplayName(fan.id, fan.name, fan.label);
    const scope = fan.zone ? "every fan in the zone" : "the fan";
    if (
      !window.confirm(
        `Recalibrate ${label}?\n\nDuring the run ${scope} sweeps through its full speed range (including brief stops) and manual control stays locked until it completes.`
      )
    ) {
      return;
    }
    try {
      await calibrateFan(system.id, target);
      toast.success(`Calibration queued for ${label}`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to queue calibration"
      );
    }
  };

  // Context for tooltip interpolation
  const tooltipContext = {
    logLevel,
    emergencyTemp,
    failsafeSpeed,
    agentInterval,
    fanStep,
    hysteresis,
    fanControl: enableFanControl ? "ENABLED" : "DISABLED"
  };

  const getPlatformIcon = () => {
    const isWindows =
      system.platform === "windows" ||
      system.agent_id.toLowerCase().startsWith("windows-");
    
    const getPlatformLabel = () => {
      if (isWindows) return "Windows";
      if (system.platform === "macos") return "macOS";
      if (system.platform === "linux" || system.agent_id.toLowerCase().includes("linux")) return "Linux";
      return "Agent";
    };

    const platformLabel = getPlatformLabel();
    const archLabel = system.architecture;
    const agentTypeMap: Record<string, string> = {
      os_linux: 'OS Agent Linux',
      os_windows: 'OS Agent Windows',
      ipmi_host: 'IPMI Agent Host',
      ipmi_network: 'IPMI Agent Network',
      unknown: 'Unknown Agent',
    };
    const agentTypeLabel = system.agent_type ? (agentTypeMap[system.agent_type] || system.agent_type) : null;
    const vendorLabel = (system.agent_type === 'ipmi_host' || system.agent_type === 'ipmi_network')
      ? appliedProfileId?.split('/')[0] || null
      : null;
    const tooltip = [vendorLabel, platformLabel, agentTypeLabel, archLabel].filter(Boolean).join(' · ');

    const getIconSrc = (): string => {
      if (system.agent_type === 'ipmi_host' || system.agent_type === 'ipmi_network') {
        const vendor = appliedProfileId?.split('/')[0]?.toLowerCase();
        const vendorIcons: Record<string, string> = {
          dell: '/icons/brands/dell_logo.svg',
          supermicro: '/icons/brands/supermicro-computer_logo.svg',
          asrock: '/icons/brands/asrock_logo.svg',
          tyan: '/icons/brands/tyan_logo.svg',
          lenovo: '/icons/brands/lenovo_logo.svg',
          hp: '/icons/brands/hp_logo.svg',
        };
        return vendor && vendorIcons[vendor] ? vendorIcons[vendor] : '/icons/bmc-01.png';
      }
      return isWindows ? '/icons/windows_01.svg' : '/icons/linux_01.svg';
    };

    return (
      <div className="platform-icon-minimal" title={tooltip}>
        <img src={getIconSrc()} alt={platformLabel} style={{ maxWidth: '48px', height: '26px', objectFit: 'contain' }} />
        {(agentTypeLabel || archLabel) && (
          <span className="arch-badge">
            {[agentTypeLabel, archLabel].filter(Boolean).join(' · ')}
          </span>
        )}
      </div>
    );
  };

  return (
    <div ref={cardRef} className={`system-card${isReadOnly ? " read-only" : ""}`}>
      <div className="system-header">
        <div className="system-title">
          <div className="system-title-top">
            <div className="status-group">
              <span
                className={`status-badge ${isIpmiNoProfile ? 'read-only' : system.status}`}
                title={isIpmiNoProfile
                  ? "Monitor-only mode\nAssign a Profile to enable fan control from Deployment"
                  : system.status === 'error' && system.last_error
                    ? `Agent status is currently "ERROR"\n\nReason: ${system.last_error}`
                    : `Agent status is currently "${system.status.toUpperCase()}"`}
              >
                <span className="status-dot" />
                {isIpmiNoProfile ? 'read only' : system.status}
              </span>
              {getPlatformIcon()}
            </div>

            <div className="header-actions">
              {isReadOnly && (
                <span className="read-only-badge" title={readOnlyTooltip}>
                  <LockIcon size={14} />
                </span>
              )}
              <button
                className="delete-button"
                onClick={handleDeleteSystem}
                disabled={loading === "delete"}
                title={isDemoMode ? "Cannot remove system, locked in demo" : "Delete system"}
              >
                {loading === "delete" ? (
                  <Loader2 className="animate-spin" size={14} />
                ) : (
                  <X size={14} />
                )}
              </button>
            </div>
          </div>

          <div className="system-title-main">
            <h3>
              <InlineEdit
                value={system.name}
                hardwareId={`agent-${system.id}`}
                onSave={async (newName) => {
                  await updateAgentName(system.id, newName);
                  onUpdate();
                }}
                className="agent-name-edit"
                showHardwareId={false}
              />
            </h3>
          </div>
        </div>

        <div className="system-meta">
          <div className="meta-item" title="IP Address">
            <Globe size={14} />
            <span>{system.ip_address || "Unknown"}</span>
          </div>
          <div className="meta-item" title="Last seen">
            <Clock size={14} />
            <span>{formatLastSeen(system.last_seen, USER_TIMEZONE)}</span>
          </div>
          <div className="meta-item" title="Agent Version">
            <ShieldCheck size={14} />
            <span>
              {system.agent_version
                ? system.agent_version.startsWith("v")
                  ? system.agent_version
                  : `v${system.agent_version}`
                : "Unknown"}
            </span>
          </div>
        </div>

        {(averageTemperature ||
          highestTemperature ||
          averageFanRPM ||
          highestFanRPM) && (
        <div className="system-summary-stats">
          {averageTemperature && (
            <div className="summary-stat" title="Average temperature across all active sensors, excluding hidden sensors">
              <div className="summary-stat-label">Avg Temp</div>
              <div
                className={`summary-stat-value temperature-${getTemperatureClass(
                  averageTemperature, undefined, tempThresholds
                )}`}
              >
                {formatTemperature(averageTemperature, "0.0")}
              </div>
            </div>
          )}
          {highestTemperature && (
            <div className="summary-stat" title="Highest temperature currently reported by any sensor, excluding hidden sensors">
              <div className="summary-stat-label">Peak Temp</div>
              <div
                className={`summary-stat-value temperature-${getTemperatureClass(
                  highestTemperature, undefined, tempThresholds
                )}`}
              >
                {formatTemperature(highestTemperature, "0.0")}
              </div>
            </div>
          )}
          {averageFanRPM !== null && system.current_fan_speeds && (
            <div className="summary-stat" title="Average RPM across all connected fans">
              <div className="summary-stat-label">Avg RPM</div>
              <div
                className={`summary-stat-value fan-${getFanRPMClass(
                  averageFanRPM,
                  system.current_fan_speeds
                )}`}
              >
                {Math.round(averageFanRPM)}
                <span className="unit">RPM</span>
              </div>
            </div>
          )}
          {highestFanRPM !== null && system.current_fan_speeds && (
            <div className="summary-stat" title="Highest RPM currently reported by any fan">
              <div className="summary-stat-label">Peak RPM</div>
              <div
                className={`summary-stat-value fan-${getFanRPMClass(
                  highestFanRPM,
                  system.current_fan_speeds
                )}`}
              >
                {highestFanRPM}
                <span className="unit">RPM</span>
              </div>
            </div>
          )}
        </div>
        )}

        {system.status === "online" && (
          <div className="system-command-center">
            <div className="command-grid">
              {/* Row 1: Fan Control, Log Level */}
              <div
                className="command-item"
                title={
                  isReadOnly
                    ? readOnlyTooltip
                    : isDemoMode
                    ? "Fan Control cannot be disabled, it is locked in demo"
                    : interpolateTooltip(getOption('fanControl').tooltip, tooltipContext)
                }
              >
                <div className="command-label-row">
                  <Zap size={14} className="label-icon" />
                  <span className="stat-label">{getLabel('fanControl')}</span>
                </div>
                <label className="tactical-checkbox">
                  <input
                    type="checkbox"
                    checked={enableFanControl}
                    onChange={(e) => handleEnableFanControlChange(e.target.checked)}
                    disabled={loading === "enable-fan-control" || isReadOnly}
                  />
                  <span className="checkbox-custom"></span>
                  <span className="checkbox-text">{enableFanControl ? "ENABLED" : "DISABLED"}</span>
                  {loading === "enable-fan-control" && <Loader2 className="animate-spin" size={12} />}
                </label>
              </div>

              <div className="command-item" title={interpolateTooltip(getOption('logLevel').tooltip, tooltipContext)}>
                <div className="command-label-row">
                  <Activity size={12} className="label-icon" />
                  <span className="stat-label">{getLabel('logLevel')}</span>
                </div>
                <Select
                  value={logLevel}
                  onChange={handleLogLevelChange}
                  options={SETTING_OPTIONS.logLevel}
                  renderTrigger={() => getCleanLabel('logLevel', logLevel)}
                  disabled={loading === "log-level" || isReadOnly}
                  ariaLabel={getLabel('logLevel')}
                />
              </div>

              {/* Row 2: Emergency Temp, Failsafe Speed */}
              <div className="command-item" title={interpolateTooltip(getOption('emergencyTemp').tooltip, tooltipContext)}>
                <div className="command-label-row">
                  <Thermometer size={12} className="label-icon" />
                  <span className="stat-label">{getLabel('emergencyTemp')}</span>
                </div>
                <Select
                  value={emergencyTemp}
                  onChange={handleEmergencyTempChange}
                  options={SETTING_OPTIONS.emergencyTemp}
                  renderTrigger={() => getCleanLabel('emergencyTemp', emergencyTemp)}
                  disabled={loading === "emergency-temp" || isReadOnly}
                  ariaLabel={getLabel('emergencyTemp')}
                />
              </div>

              <div className="command-item" title={interpolateTooltip(getOption('failsafeSpeed').tooltip, tooltipContext)}>
                <div className="command-label-row">
                  <Wind size={12} className="label-icon" />
                  <span className="stat-label">{getLabel('failsafeSpeed')}</span>
                </div>
                <Select
                  value={failsafeSpeed}
                  onChange={handleFailsafeSpeedChange}
                  options={SETTING_OPTIONS.failsafeSpeed}
                  renderTrigger={() => getCleanLabel('failsafeSpeed', failsafeSpeed)}
                  disabled={loading === "failsafe-speed" || isReadOnly}
                  ariaLabel={getLabel('failsafeSpeed')}
                />
              </div>

              {/* Row 3: Agent Rate, Fan Step, Hysteresis */}
              <div className="command-item" title={interpolateTooltip(getOption('updateInterval').tooltip, tooltipContext)}>
                <div className="command-label-row">
                  <Activity size={12} className="label-icon" />
                  <span className="stat-label">{getLabel('updateInterval')}</span>
                </div>
                <Select
                  value={agentInterval}
                  onChange={handleAgentIntervalChange}
                  options={SETTING_OPTIONS.updateInterval}
                  renderTrigger={() => getCleanLabel('updateInterval', agentInterval)}
                  disabled={loading === "agent-interval" || isReadOnly}
                  ariaLabel={getLabel('updateInterval')}
                />
              </div>

              <div className="command-item" title={interpolateTooltip(getOption('fanStep').tooltip, tooltipContext)}>
                <div className="command-label-row">
                  <ChevronRight size={12} className="label-icon" />
                  <span className="stat-label">{getLabel('fanStep')}</span>
                </div>
                <Select
                  value={fanStep}
                  onChange={handleFanStepChange}
                  options={SETTING_OPTIONS.fanStep}
                  renderTrigger={() => getCleanLabel('fanStep', fanStep)}
                  disabled={loading === "fan-step" || isReadOnly}
                  ariaLabel={getLabel('fanStep')}
                />
              </div>

              <div className="command-item" title={interpolateTooltip(getOption('hysteresis').tooltip, tooltipContext)}>
                <div className="command-label-row">
                  <Thermometer size={12} className="label-icon" />
                  <span className="stat-label">{getLabel('hysteresis')}</span>
                </div>
                <Select
                  value={hysteresis}
                  onChange={handleHysteresisChange}
                  options={SETTING_OPTIONS.hysteresis}
                  renderTrigger={() => getCleanLabel('hysteresis', hysteresis)}
                  disabled={loading === "hysteresis" || isReadOnly}
                  ariaLabel={getLabel('hysteresis')}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="system-stats">
        <div className="stat" title="Total number of sensors detected on this system">
          <span className="stat-number">
            {system.current_temperatures?.length || 0}
          </span>
          <span className="stat-label">Sensors</span>
        </div>
        <div className="stat" title="Total number of fans detected on this system">
          <span className="stat-number">
            {system.current_fan_speeds?.length || 0}
          </span>
          <span className="stat-label">Fans</span>
        </div>
        {system.current_temperatures &&
          system.current_temperatures.length > 0 && (
            <button
              className="system-stats-button"
              onClick={() => setShowHidden(!showHidden)}
              title={
                showHidden
                  ? "Hide hidden sensors and fans"
                  : "Show hidden sensors and fans"
              }
            >
              {showHidden ? "Hide" : "Show"}
            </button>
          )}

        {/* Bulk Edit Button */}
        {system.current_fan_speeds &&
          system.current_fan_speeds.length > 0 &&
          system.status === "online" && (
            <button
              className="system-stats-button"
              onClick={handleOpenBulkEdit}
              title={isReadOnly ? readOnlyTooltip : "Bulk edit fan settings"}
              disabled={isReadOnly}
            >
              Bulk Edit
            </button>
          )}
      </div>

      {/* Sensors Section */}
      {system.current_temperatures &&
        system.current_temperatures.length > 0 && (
          <div className="system-section">
            <div
              className="section-header clickable"
              onClick={() => onToggleSensors(!expandedSensors)}
            >
              <h4>Temperature Sensors</h4>
              <span className="expand-icon">
                {expandedSensors ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </span>
            </div>

            {expandedSensors && (
              <>
                {!isReadOnly && (
                  <div className="vs-toolbar">
                    <button
                      className="system-stats-button"
                      onClick={openNewVirtual}
                      disabled={system.status !== "online"}
                      title="Build a virtual sensor from existing sensors"
                    >
                      <Plus size={14} /> Sensor Builder
                    </button>
                    <button
                      className="system-stats-button"
                      onClick={openManage}
                      title="Manage sensors and virtual sensors"
                    >
                      <Sliders size={14} /> Manage
                    </button>
                  </div>
                )}
                <div className="sensors-list">
                  {(() => {
                    const filteredSensors = system.current_temperatures.filter(
                      (sensor: SensorReading) =>
                        showHidden ||
                        (!isSensorHidden(sensor.id) && !sensor.isHidden)
                    );

                    const sensorGroups = groupSensorsByChip(filteredSensors);

                    // Sort groups for consistent display order
                    const sortedGroups = sortSensorGroups(sensorGroups);

                    // Filter out hidden groups unless showHidden is true
                    const visibleGroups = sortedGroups.filter(
                      ([chipId]) => showHidden || !isGroupHidden(chipId)
                    );

                    const isIpmiAgent =
                      system.agent_type === 'ipmi_host' ||
                      system.agent_type === 'ipmi_network';
                    const ipmiHardwareName = isIpmiAgent
                      ? filteredSensors.find((s) => s.hardwareName)?.hardwareName ?? null
                      : null;

                    const renderedGroups = visibleGroups.map(([chipId, chipSensorsRaw]) => {
                      const isGroupHiddenState = isGroupHidden(chipId);
                      // Order sensors within the group by the shared sort_order (NULL -> default).
                      const chipSensors = sortByOrder(
                        chipSensorsRaw,
                        (s: SensorReading) => (s.dbId != null ? sensorOrder.sensors[s.dbId] : undefined)
                      );
                      return (
                        <div
                          key={chipId}
                          className={`sensor-group ${
                            isGroupHiddenState ? "group-hidden" : ""
                          }`}
                        >
                          <div className="sensor-group-header">
                            <h5>{isIpmiAgent ? getSensorLabel(chipId) : getChipDisplayName(chipId, chipSensors)}</h5>
                            <div className="group-header-right">
                              <button
                                className="visibility-toggle"
                                onClick={() =>
                                  handleToggleGroupVisibility(chipId)
                                }
                                title={
                                  isGroupHiddenState
                                    ? "Show group"
                                    : "Hide group, Disables from Usage and Calculations"
                                }
                              >
                                {/* {isGroupHiddenState ? "👁️🗨️" : "👁️"} */}
                                {isGroupHiddenState ? (
                                  <img src="/icons/toggle-off-01.png" width={24} height={24} alt="Hidden" style={{ opacity: 0.75 }} />
                                ) : (
                                  <img src="/icons/toggle-on-01.png" width={24} height={24} alt="Visible" style={{ opacity: 0.90 }} />
                                )}
                              </button>
                              <span className="sensor-count">
                                {chipSensors.length} sensor
                                {chipSensors.length > 1 ? "s" : ""}
                              </span>
                            </div>
                          </div>
                          <div className="sensor-group-items">
                            {chipSensors.map((sensor: SensorReading) => {
                              const isHidden =
                                isSensorHidden(sensor.id) || !!sensor.isHidden;
                              return (
                                <SensorItem
                                  key={sensor.id}
                                  sensor={sensor}
                                  systemId={system.id}
                                  isHidden={isHidden}
                                  onToggleVisibility={handleToggleSensorVisibility}
                                  onLabelSave={async (sensorDbId, newLabel) => {
                                    await updateSensorLabel(system.id, sensorDbId, newLabel);
                                    onUpdate();
                                  }}
                                  getTemperatureClass={(temp, _maxTemp, critTemp) => getTemperatureClass(temp, critTemp, tempThresholds)}
                                  getSensorIcon={getSensorIcon}
                                  history={history[sensor.id]}
                                />
                              );
                            })}
                          </div>
                        </div>
                      );
                    });

                    // Virtual Sensors render as one more group (reusing SensorItem),
                    // appended after the hardware groups. Hidden behind the same
                    // group-visibility toggle as real groups (group id "virtual").
                    const virtualGroupHidden = isGroupHidden("virtual");
                    const virtualGroup =
                      virtualRows.length > 0 && (showHidden || !virtualGroupHidden) ? (
                        <div
                          key="virtual"
                          className={`sensor-group ${virtualGroupHidden ? "group-hidden" : ""}`}
                        >
                          <div className="sensor-group-header">
                            <h5>Virtual Sensors</h5>
                            <div className="group-header-right">
                              <button
                                className="visibility-toggle"
                                onClick={() => handleToggleGroupVisibility("virtual")}
                                title={virtualGroupHidden ? "Show group" : "Hide group"}
                              >
                                {virtualGroupHidden ? (
                                  <img src="/icons/toggle-off-01.png" width={24} height={24} alt="Hidden" style={{ opacity: 0.75 }} />
                                ) : (
                                  <img src="/icons/toggle-on-01.png" width={24} height={24} alt="Visible" style={{ opacity: 0.90 }} />
                                )}
                              </button>
                              <span className="sensor-count">
                                {virtualRows.length} sensor{virtualRows.length > 1 ? "s" : ""}
                              </span>
                            </div>
                          </div>
                          <div className="sensor-group-items">
                            {virtualRows.map(({ def, reading, subtitle, tooltip, history: vHistory }) => (
                              <SensorItem
                                key={reading.id}
                                sensor={reading}
                                systemId={system.id}
                                isHidden={isSensorHidden(reading.id)}
                                isVirtual
                                subtitle={subtitle}
                                subtitleTooltip={tooltip}
                                onEdit={isReadOnly ? undefined : () => openEditVirtual(def)}
                                onToggleVisibility={handleToggleSensorVisibility}
                                onLabelSave={async (_dbId, newLabel) => {
                                  await updateVirtualSensor(def.id, { name: newLabel });
                                  await reloadVirtualSensors();
                                }}
                                getTemperatureClass={(temp, _maxTemp, critTemp) => getTemperatureClass(temp, critTemp, tempThresholds)}
                                getSensorIcon={getSensorIcon}
                                history={vHistory}
                              />
                            ))}
                          </div>
                        </div>
                      ) : null;

                    // Interleave hardware + virtual groups by the shared group order
                    // ('__virtual__' = the virtual group). NULL -> default: hardware A-Z, virtual last.
                    const orderedGroupEls = sortByOrder(
                      [
                        ...visibleGroups.map(([chipId], i) => ({ name: chipId, el: renderedGroups[i], isVirtual: false })),
                        ...(virtualGroup ? [{ name: "__virtual__", el: virtualGroup, isVirtual: true }] : []),
                      ],
                      (g) => sensorOrder.groups[g.name],
                      (a, b) => (a.isVirtual ? 1 : b.isVirtual ? -1 : compareSensorGroups(a.name, b.name))
                    ).map((g) => g.el);

                    if (isIpmiAgent) {
                      return (
                        <div className="ipmi-sensor-banner">
                          <div className="ipmi-banner-header">
                            IPMI: {ipmiHardwareName ?? 'BMC'}
                          </div>
                          <div className="ipmi-banner-body">
                            {orderedGroupEls}
                          </div>
                        </div>
                      );
                    }
                    return <>{orderedGroupEls}</>;
                  })()}
                </div>
              </>
            )}
          </div>
        )}

      {/* Fans Section */}
      {system.current_fan_speeds && system.current_fan_speeds.length > 0 && (
        <div className="system-section">
          <div
            className="section-header clickable"
            onClick={() => onToggleFans(!expandedFans)}
          >
            <h4>{system.current_fan_speeds.some((f: FanReading) => f.zone) ? 'Fan Zones' : 'Fans'}</h4>
            <span className="expand-icon">
              {expandedFans ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </span>
          </div>

          {expandedFans && (
            <div className="fans-list">
              {/* Zone-grouped rendering for IPMI agents (fans with zone field) */}
              {(() => {
                const hasZones = system.current_fan_speeds.some((f: FanReading) => f.zone);
                if (!hasZones) return null;

                // Group fans by zone
                const zoneGroups = new Map<string, FanReading[]>();
                for (const fan of system.current_fan_speeds) {
                  const z = fan.zone || '__ungrouped__';
                  if (!zoneGroups.has(z)) zoneGroups.set(z, []);
                  zoneGroups.get(z)!.push(fan);
                }

                return Array.from(zoneGroups.entries())
                  .filter(([, zoneFans]) => {
                    // Hide zone if all fans in it are hidden (unless showHidden)
                    if (showHidden) return true;
                    return zoneFans.some(f => !isFanHidden(f.id) && !f.isHidden);
                  })
                  .map(([zoneId, zoneFans]) => {
                  const representativeFan = zoneFans[0];
                  const zoneLoadingKey = `zone-profile-${zoneId}`;
                  const visibleZoneFans = showHidden
                    ? zoneFans
                    : zoneFans.filter(f => !isFanHidden(f.id) && !f.isHidden);

                  return (
                    <div key={`zone-${zoneId}`} className="zone-group">
                      <div className="zone-header-bar">
                        <span className="zone-name">{formatZoneName(zoneId)}</span>
                        <span className="zone-fan-count">
                          {visibleZoneFans.length} fan{visibleZoneFans.length !== 1 ? 's' : ''}
                        </span>
                      </div>

                      {/* Zone member fans - metrics only; calibrate targets the whole zone */}
                      {(showHidden ? zoneFans : visibleZoneFans).map(fan => (
                        <FanItem
                          key={fan.id}
                          fan={fan}
                          hidden={isFanHidden(fan.id) || !!fan.isHidden}
                          zoneMember
                          rpmDecreasing={fanRpmStateRef.current[fan.id]?.decreasing ?? false}
                          calibrating={isFanCalibrating(fan.id)}
                          stalled={isFanStalled(fan.id)}
                          calInfo={calSnapshot?.calibrations[fan.id]}
                          protocolVersion={calSnapshot?.protocol_version ?? 0}
                          controlsLocked={system.status !== "online" || isReadOnly}
                          onSaveLabel={async (newLabel) => {
                            if (!fan.dbId) throw new Error("Fan not registered in database");
                            await updateFanLabel(system.id, fan.dbId, newLabel);
                            onUpdate();
                          }}
                          onToggleVisibility={() => handleToggleFanVisibility(fan.id, fan.dbId)}
                          onCalibrate={() => void handleCalibrateFan(fan)}
                          onInfo={() => handleOpenFanInfo(fan.id)}
                        />
                      ))}

                      {/* Zone-level controls (shared by all fans in zone) */}
                      <div className="fan-controls zone-controls">
                        {/* Sensor Selection Dropdown */}
                        <div className="fan-control-row">
                          <label className="control-label">Control Sensor:</label>
                          {/* Control Sensor (Design1 <Select>) - grouped
                            * Virtual / Groups / Sensors options with search;
                            * name + temp on the trigger and on every open
                            * row. Options built once per render in
                            * sensorSelectGroups (shared with per-fan). */}
                          <Select
                            value={selectedSensors[representativeFan.id] || ""}
                            onChange={(newSensorId) => {
                              void handleZoneSensorChange(zoneFans, newSensorId);
                            }}
                            options={sensorSelectGroups}
                            renderTrigger={renderSensorTrigger}
                            renderOption={renderSensorOption}
                            searchable
                            menuMaxHeight={320}
                            disabled={system.status !== "online" || isReadOnly || zoneFans.some(f => isFanCalibrating(f.id))}
                            ariaLabel="Control Sensor"
                            className="sensor-select"
                          />
                        </div>

                        {/* Profile Selection Dropdown (Design1 <Select>)
                         *
                         * Closed trigger and open rows share the same cues:
                         * .profile-color-dot tinted by profile_type + name +
                         * (type) suffix. The open list is our own DOM
                         * (pk-select-*), so the dot cue works there too -
                         * the old native popup could not host a styled
                         * element. Order: Manual -> System (A-Z) -> User
                         * (A-Z), via headerless + labeled option groups.
                         */}
                        <div className="fan-control-row">
                          <label className="control-label">Fan Profile:</label>
                          <Select
                            value={selectedProfiles[representativeFan.id] ?? NO_PROFILE}
                            onChange={(profileId) => {
                              if (profileId !== NO_PROFILE) {
                                handleZoneProfileAssignment(zoneFans, profileId);
                              } else {
                                // Clear profile for all fans in zone
                                setSelectedProfiles(prev => {
                                  const updated = { ...prev };
                                  for (const f of zoneFans) {
                                    delete updated[f.id];
                                  }
                                  return updated;
                                });
                              }
                            }}
                            options={profileSelectGroups}
                            renderTrigger={profileRenderers.renderTrigger}
                            renderOption={profileRenderers.renderOption}
                            searchable
                            disabled={
                              loading === zoneLoadingKey ||
                              system.status !== "online" ||
                              isReadOnly ||
                              zoneFans.some(f => isFanCalibrating(f.id))
                            }
                            ariaLabel="Fan Profile"
                            className="fan-profile-select"
                          />
                          {loading === zoneLoadingKey && (
                            <Loader2 className="animate-spin" size={14} />
                          )}
                        </div>
                      </div>
                    </div>
                  );
                });
              })()}

              {/* Per-fan rendering for OS agents (existing layout, no zones) */}
              {!system.current_fan_speeds.some((f: FanReading) => f.zone) && system.current_fan_speeds
                .filter((fan: FanReading) => showHidden || (!isFanHidden(fan.id) && !fan.isHidden))
                .map((fan: FanReading) => (
                <FanItem
                  key={fan.id}
                  fan={fan}
                  hidden={isFanHidden(fan.id) || !!fan.isHidden}
                  rpmDecreasing={fanRpmStateRef.current[fan.id]?.decreasing ?? false}
                  calibrating={isFanCalibrating(fan.id)}
                  stalled={isFanStalled(fan.id)}
                  calInfo={calSnapshot?.calibrations[fan.id]}
                  protocolVersion={calSnapshot?.protocol_version ?? 0}
                  controlsLocked={system.status !== "online" || isReadOnly}
                  onSaveLabel={async (newLabel) => {
                    if (!fan.dbId) {
                      throw new Error("Fan not registered in database");
                    }
                    await updateFanLabel(system.id, fan.dbId, newLabel);
                    onUpdate();
                  }}
                  onToggleVisibility={() => handleToggleFanVisibility(fan.id, fan.dbId)}
                  onCalibrate={() => void handleCalibrateFan(fan)}
                  onInfo={() => handleOpenFanInfo(fan.id)}
                >
                  <div className="fan-controls">
                    {/* Sensor Selection Dropdown */}
                    <div className="fan-control-row">
                      <label className="control-label">Control Sensor:</label>
                      {/* Control Sensor (Design1 <Select>) - mirror of the
                        * zone-level dropdown above; same shared options,
                        * search, and renderers. */}
                      <Select
                        value={selectedSensors[fan.id] || ""}
                        onChange={async (newSensorId) => {
                          setSelectedSensors((prev) => ({
                            ...prev,
                            [fan.id]: newSensorId,
                          }));

                          // Save sensor selection immediately (independent of profile)
                          if (fan.dbId) {
                            try {
                              // Convert sensor ID to database ID or special identifier
                              let sensorDbId: number | string | null = null;
                              if (newSensorId && newSensorId !== "") {
                                if (newSensorId.startsWith("__")) {
                                  // Special identifier
                                  sensorDbId = newSensorId;
                                } else {
                                  // Regular sensor - find dbId
                                  const sensor =
                                    system.current_temperatures?.find(
                                      (s) => s.id === newSensorId
                                    );
                                  sensorDbId = sensor?.dbId || null;
                                }
                              }
                              await setFanSensor(fan.dbId, sensorDbId);
                            } catch (error) {
                              console.error(
                                "Failed to save sensor selection:",
                                error
                              );
                            }
                          }
                        }}
                        options={sensorSelectGroups}
                        renderTrigger={renderSensorTrigger}
                        renderOption={renderSensorOption}
                        searchable
                        menuMaxHeight={320}
                        disabled={system.status !== "online" || isReadOnly || isFanCalibrating(fan.id)}
                        ariaLabel="Control Sensor"
                        className="sensor-select"
                      />
                    </div>

                    {/* Profile Selection Dropdown (Design1 <Select>) -
                     * mirror of the zone-level dropdown above; see that
                     * comment block for the design rationale. */}
                    <div className="fan-control-row">
                      <label className="control-label">Fan Profile:</label>
                      <Select
                        value={selectedProfiles[fan.id] ?? NO_PROFILE}
                        onChange={(profileId) => {
                          if (profileId !== NO_PROFILE) {
                            setSelectedProfiles((prev) => ({
                              ...prev,
                              [fan.id]: profileId,
                            }));
                            handleFanProfileAssignment(fan, profileId);
                          } else {
                            setSelectedProfiles((prev) => {
                              const updated = { ...prev };
                              delete updated[fan.id];
                              return updated;
                            });
                          }
                        }}
                        options={profileSelectGroups}
                        renderTrigger={profileRenderers.renderTrigger}
                        renderOption={profileRenderers.renderOption}
                        searchable
                        disabled={
                          loading === `fan-profile-${fan.id}` ||
                          system.status !== "online" ||
                          isReadOnly ||
                          isFanCalibrating(fan.id)
                        }
                        ariaLabel="Fan Profile"
                        className="fan-profile-select"
                      />
                      {loading === `fan-profile-${fan.id}` && (
                        <Loader2 className="animate-spin" size={14} />
                      )}
                    </div>
                  </div>
                </FanItem>
              ))}
            </div>
          )}
        </div>
      )}

      {/* BMC Section - IPMI agents only. Profile assignment lives here
          so the UI sits next to the hardware it affects, not in Fleet Maintenance. */}
      {(system.agent_type === 'ipmi_host' || system.agent_type === 'ipmi_network') && (
        <div className="system-section">
          <div
            className="section-header clickable"
            onClick={() => onToggleBmc(!expandedBmc)}
          >
            <h4>BMC</h4>
            <span className="expand-icon">
              {expandedBmc ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </span>
          </div>

          {expandedBmc && (
            <div className="bmc-section-body">
              <div
                className="bmc-header-bar"
                title={isDemoMode ? "Profile Change not allowed, it is locked in demo" : undefined}
              >
                <span className="bmc-current-label">
                  Current: <span className="bmc-current-value">{system.profile_id ?? 'Not assigned'}</span>
                </span>
                <button
                  className="btn btn-primary"
                  onClick={handleBmcApply}
                  disabled={
                    !stagedBmcProfileId ||
                    stagedBmcProfileId === (system.profile_id ?? null) ||
                    loading === 'bmc-apply' ||
                    isReadOnly
                  }
                >
                  {loading === 'bmc-apply' ? (
                    <>
                      <Loader2 className="animate-spin" size={14} /> Applying…
                    </>
                  ) : (
                    'Apply'
                  )}
                </button>
              </div>
              <BmcProfilePicker
                selectedProfileId={stagedBmcProfileId}
                onProfileSelect={setStagedBmcProfileId}
                disabled={loading === 'bmc-apply' || isReadOnly}
              />
            </div>
          )}
        </div>
      )}

      {/* No data message */}
      {(!system.current_temperatures ||
        system.current_temperatures.length === 0) &&
        (!system.current_fan_speeds ||
          system.current_fan_speeds.length === 0) && (
          <div className="no-data">
            <p>No real-time data available</p>
            <p>System may be offline or not sending data</p>
          </div>
        )}

      {/* Fan Info Card - only mounted while a fan's info is open */}
      {(() => {
        const infoFan = infoFanId
          ? system.current_fan_speeds?.find((f: FanReading) => f.id === infoFanId)
          : undefined;
        if (!infoFan) return null;
        return (
          <FanInfoCard
            fan={infoFan}
            fanDisplayName={getFanDisplayName(infoFan.id, infoFan.name, infoFan.label)}
            systemId={system.id}
            systemName={system.name}
            stalled={isFanStalled(infoFan.id)}
            isOpen
            anchorRect={anchorRect}
            onClose={() => setInfoFanId(null)}
          />
        );
      })()}

      {/* Bulk Edit Panel */}
      <BulkEditPanel
        fans={system.current_fan_speeds || []}
        onApply={handleBulkApply}
        getFanDisplayName={getFanDisplayName}
        sensorOptions={bulkSensorGroups}
        profileOptions={bulkProfileGroups}
        profileRenderers={bulkProfileRenderers}
        isOpen={isBulkEditOpen}
        anchorRect={anchorRect}
        onClose={() => setIsBulkEditOpen(false)}
      />

      {/* Virtual Sensor modals */}
      {builderOpen && (
        <SensorBuilderModal
          systemId={system.id}
          sensors={system.current_temperatures || []}
          editing={builderEditing}
          anchorRect={anchorRect}
          getChipDisplayName={getChipDisplayName}
          onClose={() => setBuilderOpen(false)}
          onSaved={reloadVirtualSensors}
        />
      )}
      {manageOpen && (
        <ManageSensorsModal
          sensors={system.current_temperatures || []}
          virtualRows={virtualRows}
          sensorOrder={sensorOrder}
          onReorderSensors={handleReorderSensors}
          onReorderGroups={handleReorderGroups}
          onReorderVirtual={handleReorderVirtual}
          anchorRect={anchorRect}
          isSensorHidden={isSensorHidden}
          onToggleSensorVisibility={handleToggleSensorVisibility}
          onRenameSensor={async (dbId, label) => {
            await updateSensorLabel(system.id, dbId, label);
            onUpdate();
          }}
          getChipDisplayName={getChipDisplayName}
          onNewVirtual={openNewVirtual}
          onEditVirtual={openEditVirtual}
          onVirtualDeleted={reloadVirtualSensors}
          onClose={() => setManageOpen(false)}
        />
      )}
    </div>
  );
};

// Memoize SystemCard to prevent unnecessary re-renders
// NOTE: last_seen changes with every agent update, effectively triggering re-renders for data changes.
// The explicit array checks below are for clarity and future-proofing - they ensure re-renders
// happen when sensor/fan data changes, even if last_seen were ever removed from this comparison.
export default React.memo(SystemCard, (prevProps, nextProps) => {
  // Only re-render if these specific properties changed
  return (
    prevProps.system.id === nextProps.system.id &&
    prevProps.system.name === nextProps.system.name &&
    prevProps.system.status === nextProps.system.status &&
    prevProps.system.real_time_status === nextProps.system.real_time_status &&
    prevProps.system.last_error === nextProps.system.last_error &&
    prevProps.system.last_seen === nextProps.system.last_seen &&
    prevProps.system.current_update_interval ===
      nextProps.system.current_update_interval &&
    // filter_duplicate_sensors comparison removed (deprecated)
    // duplicate_sensor_tolerance comparison removed (deprecated)
    prevProps.system.hysteresis_temp === nextProps.system.hysteresis_temp &&
    prevProps.system.fan_step_percent === nextProps.system.fan_step_percent &&
    prevProps.system.emergency_temp === nextProps.system.emergency_temp &&
    prevProps.system.log_level === nextProps.system.log_level &&
    prevProps.system.failsafe_speed === nextProps.system.failsafe_speed &&
    prevProps.system.enable_fan_control ===
      nextProps.system.enable_fan_control &&
    prevProps.system.read_only === nextProps.system.read_only && // License limit status
    prevProps.system.profile_id === nextProps.system.profile_id && // IPMI profile assignment
    // Explicit sensor/fan array checks (reference equality works because mergeDelta creates new arrays)
    prevProps.system.current_temperatures ===
      nextProps.system.current_temperatures &&
    prevProps.system.current_fan_speeds ===
      nextProps.system.current_fan_speeds &&
    prevProps.expandedSensors === nextProps.expandedSensors &&
    prevProps.expandedFans === nextProps.expandedFans &&
    prevProps.expandedBmc === nextProps.expandedBmc &&
    prevProps.isDemoMode === nextProps.isDemoMode &&
    // Calibration/stall maps - new object reference on every event
    prevProps.fanCalibration === nextProps.fanCalibration &&
    prevProps.stalledFans === nextProps.stalledFans
  );
});

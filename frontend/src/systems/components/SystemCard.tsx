import React, { useState, useEffect } from "react";
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
} from "../../services/api";
import { useSensorVisibility } from "../../contexts/SensorVisibilityContext";
import {
  getFanProfiles,
  assignProfileToFan,
  type FanProfile,
} from "../../services/fanProfilesApi";
import {
  setFanSensor,
  getFanConfigurations,
} from "../../services/fanConfigurationsApi";
import { getChipDisplayName } from "../../config/sensorLabels";
import { sortSensorGroups, sortSensorGroupIds, deriveSensorGroupId, groupSensorsByChip } from "../../utils/sensorUtils";
import { getSensorDisplayName, getFanDisplayName } from "../../utils/displayNames";
import { getAgentStatusColor } from "../../utils/statusColors";
import { formatTemperature, formatLastSeen } from "../../utils/formatters";
import { useDashboardSettings } from "../../contexts/DashboardSettingsContext";
import { toast } from "../../utils/toast";
import { InlineEdit } from "../../components/InlineEdit";
import { BulkEditPanel } from "./BulkEditPanel";
import SensorItem from "./SensorItem";
import { useSensorHistory } from "../hooks/useSensorHistory";
import { getOption, getValues, getLabel, getCleanLabel, interpolateTooltip, getDefault } from "../../utils/uiOptions";

interface SystemCardProps {
  system: SystemData;
  onUpdate: () => void;
  onRemove: () => void;
  expandedSensors: boolean;
  expandedFans: boolean;
  onToggleSensors: (expanded: boolean) => void;
  onToggleFans: (expanded: boolean) => void;
}

const SystemCard: React.FC<SystemCardProps> = ({
  system,
  onUpdate,
  onRemove,
  expandedSensors,
  expandedFans,
  onToggleSensors,
  onToggleFans,
}) => {
  const [loading, setLoading] = useState<string | null>(null);
  const { timezone } = useDashboardSettings();
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
  const [showHiddenSensors, setShowHiddenSensors] = useState(false);
  const [fanProfiles, setFanProfiles] = useState<FanProfile[]>([]);
  const [selectedSensors, setSelectedSensors] = useState<
    Record<string, string>
  >({});
  const [selectedProfiles, setSelectedProfiles] = useState<
    Record<string, number>
  >({});
  const [isBulkEditOpen, setIsBulkEditOpen] = useState(false);
  const {
    toggleSensorVisibility,
    isSensorHidden,
    toggleGroupVisibility,
    isGroupHidden,
  } = useSensorVisibility();

  // 24h Sensor History Hook (Lazy loaded on expansion)
  const { history, fetchHistory } = useSensorHistory(system.id);

  // Trigger history fetch when sensors section is expanded
  useEffect(() => {
    if (expandedSensors) {
      fetchHistory();
    }
  }, [expandedSensors, fetchHistory]);

  // Load fan profiles, assignments, and configurations on mount
  useEffect(() => {
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
  }, [system.id, system.current_temperatures, system.current_fan_speeds]);

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
      setEnableFanControlLocal(system.enable_fan_control);
    }
  }, [
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

  const getTemperatureClass = (
    temp: number,
    _maxTemp?: number,
    critTemp?: number
  ) => {
    if (critTemp && temp >= critTemp) return "critical";
    if (temp >= 70) return "warning";
    if (temp >= 60) return "caution";
    return "normal";
  };

  const getFanRPMClass = (rpm: number, allFans: FanReading[]) => {
    // Calculate min/max from current fan data
    const rpms = allFans.map((f) => f.rpm).filter((r) => r > 0);
    if (rpms.length === 0) return "normal";

    const minRPM = Math.min(...rpms);
    const maxRPM = Math.max(...rpms);
    const range = maxRPM - minRPM;

    // Green to red gradient: lowest RPM = green, highest RPM = red
    if (range === 0) return "normal";

    const percentile = (rpm - minRPM) / range;

    if (percentile >= 0.85) return "critical"; // Highest RPM (red)
    if (percentile >= 0.7) return "warning"; // High RPM (orange)
    if (percentile >= 0.4) return "caution"; // Medium RPM (yellow)
    return "normal"; // Low RPM (green)
  };

  const getSensorIcon = (type: string) => {
    switch (type.toLowerCase()) {
      case "cpu":
        return "🖥️";
      case "gpu":
        return "📟";
      case "motherboard":
        return "🔌";
      case "nvme":
      case "storage":
        return "💾";
      case "acpi":
        return "🌡️";
      default:
        return "🔍";
    }
  };

  // Removed manual fan speed control - profiles handle speed now
  // Original handleFanSpeedChange function removed as fans are now controlled via profiles

  const handleDeleteSystem = async () => {
    if (
      !confirm(
        `Are you sure you want to delete "${system.name}"? This action cannot be undone.`
      )
    ) {
      return;
    }

    try {
      setLoading("delete");
      await deleteSystem(system.id);
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
    try {
      setLoading("enable-fan-control");
      await setEnableFanControl(system.id, enabled);
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

    for (const fan of fans) {
      if (!fan.dbId) continue;

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
            sensorDbId = sensor?.dbId;
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
    }

    onUpdate();
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

  // Helper to check if agent is read-only (over license limit)
  const isReadOnly = system.read_only === true;
  const readOnlyTooltip =
    "This system exceeds your license limit. Upgrade to control this agent. You can still view data.";

  return (
    <div className={`system-card${isReadOnly ? " read-only" : ""}`}>
      <div className="system-header">
        <div className="system-title">
          <div className="title-left">
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
            <span
              className="status-badge"
              style={{ backgroundColor: getAgentStatusColor(system.status) }}
            >
              {system.status}
            </span>
            {isReadOnly && (
              <span className="read-only-badge" title={readOnlyTooltip}>
                🔒
              </span>
            )}
          </div>
          <button
            className="delete-button"
            onClick={handleDeleteSystem}
            disabled={loading === "delete"}
            title="Delete system"
          >
            {loading === "delete" ? "..." : "×"}
          </button>
        </div>

        <div className="system-info">
          <div className="info-row">
            <div className="info-item">
              <span className="label">IP:</span>
              <span className="value">{system.ip_address || "Unknown"}</span>
            </div>
            <div className="info-item">
              <span className="label">Last seen:</span>
              <span className="value">{formatLastSeen(system.last_seen, timezone)}</span>
            </div>
          </div>
          <div className="info-row">
            <div className="info-item">
              <span className="label">Agent Version:</span>
              <span className="value">
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
            <div className="info-row">
              {averageTemperature && (
                <div className="info-item info-item-vertical">
                  <span className="label">Avg °C:</span>
                  <span
                    className={`value temperature temperature-${getTemperatureClass(
                      averageTemperature
                    )}`}
                  >
                    {formatTemperature(averageTemperature, '0.0')}
                  </span>
                </div>
              )}
              {highestTemperature && (
                <div className="info-item info-item-vertical">
                  <span className="label">Peak °C:</span>
                  <span
                    className={`value temperature temperature-${getTemperatureClass(
                      highestTemperature
                    )}`}
                  >
                    {formatTemperature(highestTemperature, '0.0')}
                  </span>
                </div>
              )}
              {averageFanRPM !== null && system.current_fan_speeds && (
                <div className="info-item info-item-vertical">
                  <span className="label">Avg RPM:</span>
                  <span
                    className={`value temperature temperature-${getFanRPMClass(
                      averageFanRPM,
                      system.current_fan_speeds
                    )}`}
                  >
                    {Math.round(averageFanRPM)} <span className="unit-small">RPM</span>
                  </span>
                </div>
              )}
              {highestFanRPM !== null && system.current_fan_speeds && (
                <div className="info-item info-item-vertical">
                  <span className="label">Peak RPM:</span>
                  <span
                    className={`value temperature temperature-${getFanRPMClass(
                      highestFanRPM,
                      system.current_fan_speeds
                    )}`}
                  >
                    {highestFanRPM} <span className="unit-small">RPM</span>
                  </span>
                </div>
              )}
            </div>
          )}
          {system.status === "online" && (
            <>
              {/* Row 1: Fan Control, Log Level */}
              <div className="info-row">
                <div className="info-item info-item-vertical">
                  <span className="label" title={isReadOnly ? readOnlyTooltip : getOption('fanControl').tooltip}>{getLabel('fanControl')}:</span>
                  <label
                    className="checkbox-container"
                    title={
                      isReadOnly
                        ? readOnlyTooltip
                        : getOption('fanControl').tooltip
                    }
                  >
                    <input
                      type="checkbox"
                      checked={enableFanControl}
                      onChange={(e) =>
                        handleEnableFanControlChange(e.target.checked)
                      }
                      disabled={loading === "enable-fan-control" || isReadOnly}
                    />
                    <span className="checkbox-label">
                      {enableFanControl ? "Enabled" : "Disabled"}
                    </span>
                    {loading === "enable-fan-control" && (
                      <span className="loading-spinner">⏳</span>
                    )}
                  </label>
                </div>
                <div className="info-item info-item-vertical">
                  <span className="label" title={isReadOnly ? readOnlyTooltip : interpolateTooltip(getOption('logLevel').tooltip, { logLevel })}>{getLabel('logLevel')}:</span>
                  {/*
                    Stealth-Overlay Pattern:
                    .select-display renders the "Clean Label" for the closed state.
                    .select-engine is the invisible native picker that shows "Full Labels" when clicked.
                  */}
                  <div className="stealth-select-wrapper">
                    <div className="agent-interval-select select-display">
                      {getCleanLabel('logLevel', logLevel)}
                    </div>
                    <select
                      className="agent-interval-select select-engine"
                      value={logLevel}
                      onChange={(e) => handleLogLevelChange(e.target.value)}
                      disabled={loading === "log-level" || isReadOnly}
                      title={
                        isReadOnly
                          ? readOnlyTooltip
                          : interpolateTooltip(getOption('logLevel').tooltip, { logLevel })
                      }
                    >
                      {(getValues('logLevel') as { value: string; label: string }[]).map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                  {loading === "log-level" && (
                    <span className="loading-spinner">⏳</span>
                  )}
                </div>
              </div>

              {/* Row 2: Emergency Temp, Failsafe Speed */}
              <div className="info-row">
                <div className="info-item info-item-vertical">
                  <span className="label" title={isReadOnly ? readOnlyTooltip : interpolateTooltip(getOption('emergencyTemp').tooltip, { emergencyTemp })}>{getLabel('emergencyTemp')}:</span>
                  <div className="stealth-select-wrapper">
                    <div className="agent-interval-select select-display">
                      {getCleanLabel('emergencyTemp', emergencyTemp)}
                    </div>
                    <select
                      className="agent-interval-select select-engine"
                      value={emergencyTemp}
                      onChange={(e) =>
                        handleEmergencyTempChange(parseFloat(e.target.value))
                      }
                      disabled={loading === "emergency-temp" || isReadOnly}
                      title={
                        isReadOnly
                          ? readOnlyTooltip
                          : interpolateTooltip(getOption('emergencyTemp').tooltip, { emergencyTemp })
                      }
                    >
                      {(getValues('emergencyTemp') as { value: number; label: string }[]).map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                  {loading === "emergency-temp" && (
                    <span className="loading-spinner">⏳</span>
                  )}
                </div>
                <div className="info-item info-item-vertical">
                  <span className="label" title={isReadOnly ? readOnlyTooltip : interpolateTooltip(getOption('failsafeSpeed').tooltip, { failsafeSpeed })}>{getLabel('failsafeSpeed')}:</span>
                  <div className="stealth-select-wrapper">
                    <div className="agent-interval-select select-display">
                      {getCleanLabel('failsafeSpeed', failsafeSpeed)}
                    </div>
                    <select
                      className="agent-interval-select select-engine"
                      value={failsafeSpeed}
                      onChange={(e) =>
                        handleFailsafeSpeedChange(parseInt(e.target.value))
                      }
                      disabled={loading === "failsafe-speed" || isReadOnly}
                      title={
                        isReadOnly
                          ? readOnlyTooltip
                          : interpolateTooltip(getOption('failsafeSpeed').tooltip, { failsafeSpeed })
                      }
                    >
                      {(getValues('failsafeSpeed') as { value: number; label: string }[]).map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                  {loading === "failsafe-speed" && (
                    <span className="loading-spinner">⏳</span>
                  )}
                </div>
              </div>

              {/* Row 3: Agent rate, Fan Step, Hysteresis */}
              <div className="info-row">
                <div className="info-item info-item-vertical">
                  <span className="label" title={isReadOnly ? readOnlyTooltip : interpolateTooltip(getOption('updateInterval').tooltip, { agentInterval })}>{getLabel('updateInterval')}:</span>
                  <div className="stealth-select-wrapper">
                    <div className="agent-interval-select select-display">
                      {getCleanLabel('updateInterval', agentInterval)}
                    </div>
                    <select
                      className="agent-interval-select select-engine"
                      value={agentInterval}
                      onChange={(e) =>
                        handleAgentIntervalChange(parseFloat(e.target.value))
                      }
                      disabled={loading === "agent-interval" || isReadOnly}
                      title={
                        isReadOnly
                          ? readOnlyTooltip
                          : interpolateTooltip(getOption('updateInterval').tooltip, { agentInterval })
                      }
                    >
                      {(getValues('updateInterval') as { value: number; label: string }[]).map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                  {loading === "agent-interval" && (
                    <span className="loading-spinner">⏳</span>
                  )}
                </div>
                <div className="info-item info-item-vertical">
                  <span className="label" title={isReadOnly ? readOnlyTooltip : interpolateTooltip(getOption('fanStep').tooltip, { fanStep, agentInterval })}>{getLabel('fanStep')}:</span>
                  <div className="stealth-select-wrapper">
                    <div className="agent-interval-select select-display">
                      {getCleanLabel('fanStep', fanStep)}
                    </div>
                    <select
                      className="agent-interval-select select-engine"
                      value={fanStep}
                      onChange={(e) =>
                        handleFanStepChange(parseInt(e.target.value))
                      }
                      disabled={loading === "fan-step" || isReadOnly}
                      title={
                        isReadOnly
                          ? readOnlyTooltip
                          : interpolateTooltip(getOption('fanStep').tooltip, { fanStep, agentInterval })
                      }
                    >
                      {(getValues('fanStep') as { value: number; label: string }[]).map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                  {loading === "fan-step" && (
                    <span className="loading-spinner">⏳</span>
                  )}
                </div>
                <div className="info-item info-item-vertical">
                  <span className="label" title={isReadOnly ? readOnlyTooltip : interpolateTooltip(getOption('hysteresis').tooltip, { hysteresis })}>{getLabel('hysteresis')}:</span>
                  <div className="stealth-select-wrapper">
                    <div className="agent-interval-select select-display">
                      {getCleanLabel('hysteresis', hysteresis)}
                    </div>
                    <select
                      className="agent-interval-select select-engine"
                      value={hysteresis}
                      onChange={(e) =>
                        handleHysteresisChange(parseFloat(e.target.value))
                      }
                      disabled={loading === "hysteresis" || isReadOnly}
                      title={
                        isReadOnly
                          ? readOnlyTooltip
                          : interpolateTooltip(getOption('hysteresis').tooltip, { hysteresis })
                      }
                    >
                      {(getValues('hysteresis') as { value: number; label: string }[]).map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                  {loading === "hysteresis" && (
                    <span className="loading-spinner">⏳</span>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="system-stats">
        <div className="stat">
          <span className="stat-number">
            {system.current_temperatures?.length || 0}
          </span>
          <span className="stat-label">Sensors</span>
        </div>
        <div className="stat">
          <span className="stat-number">
            {system.current_fan_speeds?.length || 0}
          </span>
          <span className="stat-label">Fans</span>
        </div>
        {system.current_temperatures &&
          system.current_temperatures.length > 0 && (
            <button
              className="system-stats-button"
              onClick={() => setShowHiddenSensors(!showHiddenSensors)}
              title={
                showHiddenSensors
                  ? "Hide hidden sensors"
                  : "Show hidden sensors"
              }
            >
              {showHiddenSensors ? "👁️ Hide" : "👁️‍🗨️ Show"}
            </button>
          )}

        {/* Bulk Edit Button */}
        {system.current_fan_speeds &&
          system.current_fan_speeds.length > 0 &&
          system.status === "online" && (
            <button
              className="system-stats-button"
              onClick={() => setIsBulkEditOpen(true)}
              title="Bulk edit fan settings"
            >
              Bulk edit
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
              <span className="expand-icon">{expandedSensors ? "▼" : "▶"}</span>
            </div>

            {expandedSensors && (
              <>
                <div className="sensors-list">
                  {(() => {
                    const filteredSensors = system.current_temperatures.filter(
                      (sensor: SensorReading) =>
                        showHiddenSensors ||
                        (!isSensorHidden(sensor.id) && !sensor.isHidden)
                    );

                    const sensorGroups = groupSensorsByChip(filteredSensors);

                    // Sort groups for consistent display order
                    const sortedGroups = sortSensorGroups(sensorGroups);

                    // Filter out hidden groups unless showHiddenSensors is true
                    const visibleGroups = sortedGroups.filter(
                      ([chipId]) => showHiddenSensors || !isGroupHidden(chipId)
                    );

                    return visibleGroups.map(([chipId, chipSensors]) => {
                      const isGroupHiddenState = isGroupHidden(chipId);
                      return (
                        <div
                          key={chipId}
                          className={`sensor-group ${
                            isGroupHiddenState ? "group-hidden" : ""
                          }`}
                        >
                          <div className="sensor-group-header">
                            <h5>{getChipDisplayName(chipId, chipSensors)}</h5>
                            <div className="group-header-right">
                              <button
                                className="visibility-toggle"
                                onClick={() =>
                                  handleToggleGroupVisibility(chipId)
                                }
                                title={
                                  isGroupHiddenState
                                    ? "Show group"
                                    : "Hide group"
                                }
                              >
                                {isGroupHiddenState ? "👁️‍🗨️" : "👁️"}
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
                                  getTemperatureClass={getTemperatureClass}
                                  getSensorIcon={getSensorIcon}
                                  history={history[sensor.id]}
                                />
                              );
                            })}
                          </div>
                        </div>
                      );
                    });
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
            <h4>Fans</h4>
            <span className="expand-icon">{expandedFans ? "▼" : "▶"}</span>
          </div>

          {expandedFans && (
            <div className="fans-list">
              {system.current_fan_speeds.map((fan: FanReading) => (
                <div key={fan.id} className="fan-item">
                  <div className="fan-header">
                    <div className="fan-info">
                      <div className="fan-title">
                        <span className="fan-icon">🌀</span>
                        <div className="fan-name">
                          <InlineEdit
                            value={getFanDisplayName(
                              fan.id,
                              fan.name,
                              fan.label
                            )}
                            hardwareId={fan.id}
                            onSave={async (newLabel) => {
                              if (!fan.dbId) {
                                throw new Error(
                                  "Fan not registered in database"
                                );
                              }
                              await updateFanLabel(
                                system.id,
                                fan.dbId,
                                newLabel
                              );
                              onUpdate();
                            }}
                            className="fan-name-edit"
                          />
                        </div>
                      </div>
                      <div className="fan-metrics">
                        <span className="fan-rpm">{fan.rpm} RPM</span>
                        <span className={`status-indicator ${fan.status}`}>
                          {fan.status}
                        </span>
                      </div>
                    </div>

                    <div className="speed-display">
                      <div className="speed-circle">
                        <svg width="60" height="60" className="speed-gauge">
                          <circle
                            cx="30"
                            cy="30"
                            r="25"
                            fill="none"
                            stroke="#e0e0e0"
                            strokeWidth="5"
                          />
                          <circle
                            cx="30"
                            cy="30"
                            r="25"
                            fill="none"
                            stroke="#2196F3"
                            strokeWidth="5"
                            strokeDasharray={`${2 * Math.PI * 25}`}
                            strokeDashoffset={`${
                              2 * Math.PI * 25 * (1 - fan.speed / 100)
                            }`}
                            transform="rotate(-90 30 30)"
                          />
                        </svg>
                        <span className="speed-value">{fan.speed}%</span>
                      </div>
                    </div>
                  </div>

                  <div className="fan-controls">
                    {/* Sensor Selection Dropdown */}
                    <div className="fan-control-row">
                      <label className="control-label">Control Sensor:</label>
                      <select
                        className="fan-dropdown"
                        value={selectedSensors[fan.id] || ""}
                        onChange={async (e) => {
                          const newSensorId = e.target.value;
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
                        disabled={system.status !== "online" || isReadOnly}
                      >
                        <option value="">Select Sensor...</option>

                        {/* Highest Temperature Option */}
                        <option
                          value="__highest__"
                          title="Use the Highest Temperature on the system"
                        >
                          🔥 Highest ({formatTemperature(highestTemperature, '0.0°C')})
                        </option>

                        {/* Separator */}
                        <option disabled>────────────────────</option>

                        {/* Sensor Groups Header and Options */}
                        {(() => {
                          const visibleSensors =
                            system.current_temperatures?.filter(
                              (sensor: SensorReading) =>
                                !isSensorOrGroupHidden(sensor)
                            ) || [];

                          const sensorGroups =
                            groupSensorsByChip(visibleSensors);
                          const sortedGroupIds = sortSensorGroupIds(Object.keys(sensorGroups));

                          const groupsWithMultipleSensors =
                            sortedGroupIds.filter(
                              (groupId) => sensorGroups[groupId].length > 1
                            );

                          if (groupsWithMultipleSensors.length === 0)
                            return null;

                          return (
                            <>
                              <option disabled>(Groups)</option>
                              {groupsWithMultipleSensors.map((groupId) => {
                                const groupSensors = sensorGroups[groupId];
                                const highestTemp = Math.max(
                                  ...groupSensors.map((s) => s.temperature)
                                );
                                return (
                                  <option
                                    key={`group-${groupId}`}
                                    value={`__group__${groupId}`}
                                    title="Selecting a group uses the Highest Temperature of that group"
                                  >
                                    📊{" "}
                                    {getChipDisplayName(groupId, groupSensors)}{" "}
                                    ({formatTemperature(highestTemp)})
                                  </option>
                                );
                              })}
                              <option disabled>────────────────────</option>
                            </>
                          );
                        })()}

                        {/* Individual Sensors Header */}
                        <option disabled>(Sensors)</option>

                        {/* Individual Sensors */}
                        {system.current_temperatures
                          ?.filter(
                            (sensor: SensorReading) =>
                              !isSensorOrGroupHidden(sensor)
                          )
                          .map((sensor: SensorReading) => (
                            <option key={sensor.id} value={sensor.id}>
                              {getSensorDisplayName(
                                sensor.id,
                                sensor.name,
                                sensor.label
                              )}{" "}
                              ({formatTemperature(sensor.temperature)})
                            </option>
                          ))}
                      </select>
                    </div>

                    {/* Profile Selection Dropdown */}
                    <div className="fan-control-row">
                      <label className="control-label">Fan Profile:</label>
                      <select
                        className="fan-dropdown"
                        value={selectedProfiles[fan.id] || ""}
                        onChange={(e) => {
                          const profileId = e.target.value;
                          if (profileId) {
                            setSelectedProfiles((prev) => ({
                              ...prev,
                              [fan.id]: parseInt(profileId),
                            }));
                            handleFanProfileAssignment(
                              fan,
                              parseInt(profileId)
                            );
                          } else {
                            setSelectedProfiles((prev) => {
                              const updated = { ...prev };
                              delete updated[fan.id];
                              return updated;
                            });
                          }
                        }}
                        disabled={
                          loading === `fan-profile-${fan.id}` ||
                          system.status !== "online" ||
                          isReadOnly
                        }
                      >
                        <option value="">No Profile (Manual)</option>
                        {fanProfiles.map((profile: FanProfile) => (
                          <option
                            key={profile.id}
                            value={profile.id}
                            title={profile.description || profile.profile_name}
                          >
                            {profile.profile_name} ({profile.profile_type})
                          </option>
                        ))}
                      </select>
                      {loading === `fan-profile-${fan.id}` && (
                        <span className="loading-spinner">⏳</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
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

      {/* Bulk Edit Panel */}
      <BulkEditPanel
        fans={system.current_fan_speeds || []}
        sensors={system.current_temperatures || []}
        profiles={fanProfiles}
        onApply={handleBulkApply}
        getSensorDisplayName={getSensorDisplayName}
        getFanDisplayName={getFanDisplayName}
        getChipDisplayName={getChipDisplayName}
        groupSensorsByChip={groupSensorsByChip}
        highestTemperature={highestTemperature}
        isOpen={isBulkEditOpen}
        onClose={() => setIsBulkEditOpen(false)}
      />
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
    // Explicit sensor/fan array checks (reference equality works because mergeDelta creates new arrays)
    prevProps.system.current_temperatures ===
      nextProps.system.current_temperatures &&
    prevProps.system.current_fan_speeds ===
      nextProps.system.current_fan_speeds &&
    prevProps.expandedSensors === nextProps.expandedSensors &&
    prevProps.expandedFans === nextProps.expandedFans
  );
});

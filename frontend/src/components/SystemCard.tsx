import React, { useState, useEffect } from 'react';
import type { SystemData, SensorReading, FanReading } from '../types/api';
import { deleteSystem, setAgentUpdateInterval, setSensorDeduplication, setSensorTolerance, getFanAssignments } from '../services/api';
import { useSensorVisibility } from '../contexts/SensorVisibilityContext';
import { getFanProfiles, assignProfileToFan, type FanProfile } from '../services/fanProfilesApi';
import { setFanSensor, getFanConfigurations } from '../services/fanConfigurationsApi';
import { getSensorLabel } from '../config/sensorLabels';

interface SystemCardProps {
  system: SystemData;
  onUpdate: () => void;
  expandedSensors: boolean;
  expandedFans: boolean;
  onToggleSensors: (expanded: boolean) => void;
  onToggleFans: (expanded: boolean) => void;
}

const SystemCard: React.FC<SystemCardProps> = ({
  system,
  onUpdate,
  expandedSensors,
  expandedFans,
  onToggleSensors,
  onToggleFans
}) => {
  const [loading, setLoading] = useState<string | null>(null);
  const [agentInterval, setAgentInterval] = useState<number>(system.current_update_interval || 3);
  const [filterDuplicates, setFilterDuplicates] = useState<boolean>(system.filter_duplicate_sensors ?? true);
  const [sensorTolerance, setSensorToleranceLocal] = useState<number>(system.duplicate_sensor_tolerance || 0.5);
  const [showHiddenSensors, setShowHiddenSensors] = useState(false);
  const [fanProfiles, setFanProfiles] = useState<FanProfile[]>([]);
  const [selectedSensors, setSelectedSensors] = useState<Record<string, string>>({});
  const [selectedProfiles, setSelectedProfiles] = useState<Record<string, number>>({});
  const { toggleSensorVisibility, isSensorHidden, toggleGroupVisibility, isGroupHidden } = useSensorVisibility();

  // Load fan profiles, assignments, and configurations on mount
  useEffect(() => {
    const loadProfilesAndAssignments = async () => {
      try {
        // Load profiles
        console.log('Loading fan profiles...');
        const profiles = await getFanProfiles(system.id, true);
        console.log('Fan profiles loaded:', profiles.length);
        setFanProfiles(profiles);

        // Load fan configurations (independent sensor assignments)
        console.log('Loading fan configurations...');
        const configs = await getFanConfigurations(system.id);
        console.log('Fan configurations loaded:', configs.length);

        // Load profile assignments
        console.log('Loading fan assignments...');
        const assignments = await getFanAssignments(system.id);
        console.log('Fan assignments loaded:', assignments.length);

        // Map assignments to dropdown states
        const sensorMap: Record<string, string> = {};
        const profileMap: Record<string, number> = {};

        // First, load from fan configurations (independent sensor assignments)
        configs.forEach((config: any) => {
          const fan = system.current_fan_speeds?.find(f => f.dbId === config.fan_id);
          if (fan && config.sensor_id) {
            if (typeof config.sensor_id === 'string') {
              sensorMap[fan.id] = config.sensor_id;
            } else {
              const sensor = system.current_temperatures?.find(s => s.dbId === config.sensor_id);
              if (sensor) {
                sensorMap[fan.id] = sensor.id;
              }
            }
          }
        });

        // Then load profile assignments
        assignments.forEach((assignment: any) => {
          const fan = system.current_fan_speeds?.find(f => f.dbId === assignment.fan_id);
          if (fan) {
            profileMap[fan.id] = assignment.profile_id;

            // If no sensor from config, use sensor from assignment (fallback)
            if (!sensorMap[fan.id] && assignment.sensor_id) {
              if (typeof assignment.sensor_id === 'string') {
                console.log(`Setting sensor for fan ${fan.id} to special identifier:`, assignment.sensor_id);
                sensorMap[fan.id] = assignment.sensor_id;
              } else {
                const sensor = system.current_temperatures?.find(s => s.dbId === assignment.sensor_id);
                console.log(`Looking for sensor with dbId ${assignment.sensor_id} for fan ${fan.id}, found:`, sensor?.id);
                if (sensor) {
                  sensorMap[fan.id] = sensor.id;
                }
              }
            }
          }
        });

        console.log('Final sensorMap:', sensorMap);
        console.log('Final profileMap:', profileMap);

        setSelectedSensors(sensorMap);
        setSelectedProfiles(profileMap);
      } catch (error) {
        console.error('Failed to load fan profiles and assignments:', error);
      }
    };
    loadProfilesAndAssignments();
  }, [system.id, system.current_temperatures, system.current_fan_speeds]);

  // Sync local state with system prop changes (e.g., when dashboard refreshes)
  useEffect(() => {
    if (system.current_update_interval !== undefined) {
      setAgentInterval(system.current_update_interval);
    }
    if (system.filter_duplicate_sensors !== undefined) {
      setFilterDuplicates(system.filter_duplicate_sensors);
    }
    if (system.duplicate_sensor_tolerance !== undefined) {
      setSensorToleranceLocal(system.duplicate_sensor_tolerance);
    }
  }, [system.current_update_interval, system.filter_duplicate_sensors, system.duplicate_sensor_tolerance]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online': return '#4CAF50';
      case 'offline': return '#9E9E9E';
      case 'error': return '#F44336';
      default: return '#FF9800';
    }
  };

  const getTemperatureClass = (temp: number, _maxTemp?: number, critTemp?: number) => {
    if (critTemp && temp >= critTemp) return 'critical';
    if (temp >= 70) return 'warning';
    if (temp >= 60) return 'caution';
    return 'normal';
  };

  const getFanRPMClass = (rpm: number, allFans: FanReading[]) => {
    // Calculate min/max from current fan data
    const rpms = allFans.map(f => f.rpm).filter(r => r > 0);
    if (rpms.length === 0) return 'normal';

    const minRPM = Math.min(...rpms);
    const maxRPM = Math.max(...rpms);
    const range = maxRPM - minRPM;

    // Green to red gradient: lowest RPM = green, highest RPM = red
    if (range === 0) return 'normal';

    const percentile = (rpm - minRPM) / range;

    if (percentile >= 0.85) return 'critical'; // Highest RPM (red)
    if (percentile >= 0.70) return 'warning';  // High RPM (orange)
    if (percentile >= 0.40) return 'caution';  // Medium RPM (yellow)
    return 'normal';                            // Low RPM (green)
  };

  const deriveSensorGroupId = (sensor: SensorReading): string => {
    // Hardware-agnostic pattern extraction for sensor grouping
    // Pattern 1: Standard format ending with _<number> (e.g., k10temp_1, acpitz_2, nvme_3)
    const standardMatch = sensor.id.match(/^([a-z0-9_]+?)_\d+$/i);
    if (standardMatch?.[1]) {
      const result = standardMatch[1];
      console.log('deriveSensorGroupId (standard):', sensor.id, '->', result);
      return result;
    }

    // Pattern 2: Complex IDs without trailing number - extract primary prefix
    // (e.g., thermal_thermal_zone0_acpitz -> thermal, gigabyte_wmi_sensor -> gigabyte)
    // Use the first meaningful segment before underscore+number or multiple underscores
    const prefixMatch = sensor.id.match(/^([a-z]+)/i);
    if (prefixMatch?.[1]) {
      const result = prefixMatch[1];
      console.log('deriveSensorGroupId (prefix):', sensor.id, '->', result);
      return result;
    }

    // Fallback to sensor type
    console.log('deriveSensorGroupId fallback:', sensor.id, '-> type:', sensor.type);
    return sensor.type || 'other';
  };

  const getSensorIcon = (type: string) => {
    switch (type.toLowerCase()) {
      case 'cpu': return '🖥️';
      case 'gpu': return '📟';
      case 'motherboard': return '🔌';
      case 'nvme': case 'storage': return '💾';
      case 'acpi': return '🌡️';
      default: return '🔍';
      }
  };

  const getSensorDisplayName = (id: string, name: string, label: string) => {
    // Priority: 1. Actual label from backend, 2. Name from backend, 3. ID as last resort
    if (label && label !== id) {
      return label;
    }
    
    if (name && name !== id) {
      return name;
    }
    
    // No fallback mappings - just use the ID as provided by the hardware
    return id;
  };

  const getFanDisplayName = (id: string, name: string, label: string) => {
    // Priority: 1. Actual label from backend, 2. Name from backend, 3. ID as last resort
    if (label && label !== id) {
      return label;
    }
    
    if (name && name !== id) {
      return name;
    }
    
    // No fallback mappings - just use the ID as provided by the hardware
    return id;
  };

  // Removed manual fan speed control - profiles handle speed now
  // Original handleFanSpeedChange function removed as fans are now controlled via profiles

  const handleDeleteSystem = async () => {
    if (!confirm(`Are you sure you want to delete "${system.name}"? This action cannot be undone.`)) {
      return;
    }
    
    try {
      setLoading('delete');
      await deleteSystem(system.id);
      onUpdate();
    } catch (error) {
      alert('Failed to delete system: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setLoading(null);
    }
  };

  const handleAgentIntervalChange = async (newInterval: number) => {
    try {
      setLoading('agent-interval');
      await setAgentUpdateInterval(system.id, newInterval);
      setAgentInterval(newInterval);
      // No need to call onUpdate() since this doesn't affect displayed data
    } catch (error) {
      alert('Failed to set agent refresh rate: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setLoading(null);
    }
  };

  const handleFilterDuplicatesChange = async (newValue: boolean) => {
    try {
      setLoading('filter-duplicates');
      await setSensorDeduplication(system.id, newValue);
      setFilterDuplicates(newValue);
      // Trigger dashboard refresh to show new sensor count
      onUpdate();
    } catch (error) {
      alert('Failed to set sensor deduplication: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setLoading(null);
    }
  };

  const handleSensorToleranceChange = async (newTolerance: number) => {
    try {
      setLoading('sensor-tolerance');
      await setSensorTolerance(system.id, newTolerance);
      setSensorToleranceLocal(newTolerance);
      // Trigger dashboard refresh to show new sensor count
      onUpdate();
    } catch (error) {
      alert('Failed to set sensor tolerance: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setLoading(null);
    }
  };

  const handleFanProfileAssignment = async (fan: FanReading, profileId: number) => {
    try {
      setLoading(`fan-profile-${fan.id}`);

      if (!fan.dbId) {
        alert('Fan database ID not available. Please refresh the page.');
        setLoading(null);
        return;
      }

      // Get the selected sensor for this fan (if any)
      const selectedSensorId = selectedSensors[fan.id];

      // Find the sensor's database ID or special identifier
      let sensorDbId: number | string | undefined = undefined;
      if (selectedSensorId) {
        // Check if it's a special identifier
        if (selectedSensorId.startsWith('__')) {
          // It's a special identifier like "__highest__" or "__group__<name>"
          sensorDbId = selectedSensorId;
        } else {
          // It's a regular sensor - find its database ID
          const sensor = system.current_temperatures?.find(s => s.id === selectedSensorId);
          if (sensor?.dbId) {
            sensorDbId = sensor.dbId;
          } else {
            alert('Please select a sensor first or refresh the page to get updated sensor data.');
            setLoading(null);
            return;
          }
        }
      }

      await assignProfileToFan({
        fan_id: fan.dbId,
        profile_id: profileId,
        sensor_id: sensorDbId
      });
      onUpdate();
    } catch (error) {
      alert('Failed to assign fan profile: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setLoading(null);
    }
  };

  const formatLastSeen = (lastSeen?: string) => {
    if (!lastSeen) return 'Never';
    const date = new Date(lastSeen);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
    return date.toLocaleDateString();
  };

  const averageTemperature = system.current_temperatures?.length
    ? system.current_temperatures.reduce((sum, sensor) => sum + sensor.temperature, 0) / system.current_temperatures.length
    : null;

  const highestTemperature = system.current_temperatures?.length
    ? Math.max(...system.current_temperatures.map(sensor => sensor.temperature))
    : null;

  const averageFanRPM = system.current_fan_speeds?.length
    ? system.current_fan_speeds.reduce((sum, fan) => sum + fan.rpm, 0) / system.current_fan_speeds.length
    : null;

  const highestFanRPM = system.current_fan_speeds?.length
    ? Math.max(...system.current_fan_speeds.map(fan => fan.rpm))
    : null;

  // Group sensors by chip type for better organization
  const groupSensorsByChip = (sensors: SensorReading[]) => {
    const groups: Record<string, SensorReading[]> = {};

    sensors.forEach(sensor => {
      // Extract chip name from sensor ID (e.g., "k10temp_1" -> "k10temp")
      const chipName = deriveSensorGroupId(sensor);

      if (!groups[chipName]) {
        groups[chipName] = [];
      }
      groups[chipName].push(sensor);
    });

    return groups;
  };

  // Get friendly chip display names
  const getChipDisplayName = (chipId: string): string => getSensorLabel(chipId);

  // Check if a sensor is hidden (either individually or via group)
  const isSensorOrGroupHidden = (sensor: SensorReading): boolean => {
    // Check if sensor itself is hidden
    if (isSensorHidden(sensor.id)) {
      return true;
    }

    // Extract chip name from sensor ID using the same pattern as groupSensorsByChip
    const chipName = deriveSensorGroupId(sensor);
    return isGroupHidden(chipName);
  };

  return (
    <div className="system-card">
      <div className="system-header">
        <div className="system-title">
          <div className="title-left">
            <h3>{system.name}</h3>
            <span 
              className="status-badge"
              style={{ backgroundColor: getStatusColor(system.status) }}
            >
              {system.status}
            </span>
          </div>
          <button 
            className="delete-button"
            onClick={handleDeleteSystem}
            disabled={loading === 'delete'}
            title="Delete system"
          >
            {loading === 'delete' ? '...' : '×'}
          </button>
        </div>
        
        <div className="system-info">
          <div className="info-row">
            <div className="info-item">
              <span className="label">IP:</span>
              <span className="value">{system.ip_address || 'Unknown'}</span>
            </div>
            <div className="info-item">
              <span className="label">Last seen:</span>
              <span className="value">{formatLastSeen(system.last_seen)}</span>
            </div>
          </div>
          {(averageTemperature || highestTemperature || averageFanRPM || highestFanRPM) && (
            <div className="info-row">
              {averageTemperature && (
                <div className="info-item info-item-vertical">
                  <span className="label">
                    Average<br />temp:
                  </span>
                  <span
                    className={`value temperature temperature-${getTemperatureClass(averageTemperature)}`}
                  >
                    {averageTemperature.toFixed(1)} °C
                  </span>
                </div>
              )}
              {highestTemperature && (
                <div className="info-item info-item-vertical">
                  <span className="label">
                    Highest<br />temp:
                  </span>
                  <span
                    className={`value temperature temperature-${getTemperatureClass(highestTemperature)}`}
                  >
                    {highestTemperature.toFixed(1)} °C
                  </span>
                </div>
              )}
              {averageFanRPM !== null && system.current_fan_speeds && (
                <div className="info-item info-item-vertical">
                  <span className="label">
                    Average<br />fan speed:
                  </span>
                  <span className={`value temperature temperature-${getFanRPMClass(averageFanRPM, system.current_fan_speeds)}`}>
                    {Math.round(averageFanRPM)} RPM
                  </span>
                </div>
              )}
              {highestFanRPM !== null && system.current_fan_speeds && (
                <div className="info-item info-item-vertical">
                  <span className="label">
                    Highest<br />fan speed:
                  </span>
                  <span className={`value temperature temperature-${getFanRPMClass(highestFanRPM, system.current_fan_speeds)}`}>
                    {highestFanRPM} RPM
                  </span>
                </div>
              )}
            </div>
          )}
          {system.status === 'online' && (
            <div className="info-row">
              <div className="info-item info-item-vertical">
                <span className="label">Agent rate:</span>
                <select
                  className="agent-interval-select"
                  value={agentInterval}
                  onChange={(e) => handleAgentIntervalChange(parseFloat(e.target.value))}
                  disabled={loading === 'agent-interval'}
                  title="Agent data collection interval"
                >
                  <option value={0.5}>0.5s</option>
                  <option value={1}>1s</option>
                  <option value={2}>2s</option>
                  <option value={3}>3s</option>
                  <option value={5}>5s</option>
                  <option value={10}>10s</option>
                  <option value={15}>15s</option>
                  <option value={30}>30s</option>
                </select>
                {loading === 'agent-interval' && <span className="loading-spinner">⏳</span>}
              </div>
              <div className="info-item info-item-horizontal">
                <span className="label">Filter duplicates:</span>
                <input
                  type="checkbox"
                  checked={filterDuplicates}
                  onChange={(e) => handleFilterDuplicatesChange(e.target.checked)}
                  disabled={loading === 'filter-duplicates'}
                  title="Filter duplicate temperature sensors"
                />
                {loading === 'filter-duplicates' && <span className="loading-spinner">⏳</span>}
              </div>
              <div className="info-item info-item-vertical">
                <span className="label">Sensor tolerance:</span>
                <select
                  className="agent-interval-select"
                  value={sensorTolerance}
                  onChange={(e) => handleSensorToleranceChange(parseFloat(e.target.value))}
                  disabled={loading === 'sensor-tolerance'}
                  title="Temperature tolerance for sensor deduplication (°C)"
                >
                  <option value={0.25}>0.25°C</option>
                  <option value={0.5}>0.5°C</option>
                  <option value={1.0}>1.0°C</option>
                  <option value={1.5}>1.5°C</option>
                  <option value={2.0}>2.0°C</option>
                  <option value={2.5}>2.5°C</option>
                  <option value={3.0}>3.0°C</option>
                  <option value={3.5}>3.5°C</option>
                  <option value={4.0}>4.0°C</option>
                  <option value={4.5}>4.5°C</option>
                  <option value={5.0}>5.0°C</option>
                </select>
                {loading === 'sensor-tolerance' && <span className="loading-spinner">⏳</span>}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="system-stats">
        <div className="stat">
          <span className="stat-number">{system.current_temperatures?.length || 0}</span>
          <span className="stat-label">Sensors</span>
        </div>
        <div className="stat">
          <span className="stat-number">{system.current_fan_speeds?.length || 0}</span>
          <span className="stat-label">Fans</span>
        </div>
        {system.current_temperatures && system.current_temperatures.length > 0 && (
          <button
            className="toggle-hidden-button"
            onClick={() => setShowHiddenSensors(!showHiddenSensors)}
            title={showHiddenSensors ? "Hide hidden sensors" : "Show hidden sensors"}
          >
            {showHiddenSensors ? '👁️ Hide' : '👁️‍🗨️ Show'}
          </button>
        )}
      </div>

      {/* Sensors Section */}
      {system.current_temperatures && system.current_temperatures.length > 0 && (
        <div className="system-section">
          <div
            className="section-header clickable"
            onClick={() => onToggleSensors(!expandedSensors)}
          >
            <h4>Temperature Sensors</h4>
            <span className="expand-icon">{expandedSensors ? '▼' : '▶'}</span>
          </div>

          {expandedSensors && (
            <>
              <div className="sensors-list">
                {(() => {
                  const filteredSensors = system.current_temperatures
                    .filter((sensor: SensorReading) => showHiddenSensors || !isSensorHidden(sensor.id));

                  const sensorGroups = groupSensorsByChip(filteredSensors);

                  // Sort groups for consistent display order
                  const sortedGroups = Object.entries(sensorGroups).sort((a, b) => {
                    const order = ['k10temp', 'coretemp', 'it8628', 'it87', 'nvme', 'gigabyte_wmi', 'asus_wmi', 'acpitz', 'thermal'];
                    const aIndex = order.indexOf(a[0]);
                    const bIndex = order.indexOf(b[0]);

                    // If both found in order array, sort by that
                    if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
                    // If only a is in order, a comes first
                    if (aIndex !== -1) return -1;
                    // If only b is in order, b comes first
                    if (bIndex !== -1) return 1;
                    // Otherwise alphabetical
                    return a[0].localeCompare(b[0]);
                  });

                  // Filter out hidden groups unless showHiddenSensors is true
                  const visibleGroups = sortedGroups.filter(([chipId]) => showHiddenSensors || !isGroupHidden(chipId));

                  return visibleGroups.map(([chipId, chipSensors]) => {
                    const isGroupHiddenState = isGroupHidden(chipId);
                    return (
                      <div key={chipId} className={`sensor-group ${isGroupHiddenState ? 'group-hidden' : ''}`}>
                        <div className="sensor-group-header">
                          <h5>{getChipDisplayName(chipId)}</h5>
                          <div className="group-header-right">
                            <button
                              className="visibility-toggle"
                              onClick={() => toggleGroupVisibility(chipId)}
                              title={isGroupHiddenState ? "Show group" : "Hide group"}
                            >
                              {isGroupHiddenState ? '👁️‍🗨️' : '👁️'}
                            </button>
                            <span className="sensor-count">{chipSensors.length} sensor{chipSensors.length > 1 ? 's' : ''}</span>
                          </div>
                        </div>
                        <div className="sensor-group-items">
                        {chipSensors.map((sensor: SensorReading) => {
                          const isHidden = isSensorHidden(sensor.id);
                          return (
                            <div
                              key={sensor.id}
                              className={`sensor-item temperature-${getTemperatureClass(sensor.temperature, sensor.maxTemp, sensor.critTemp)} ${isHidden ? 'sensor-hidden' : ''}`}
                            >
                              <div className="sensor-info">
                                <div className="sensor-header">
                                  <span className="sensor-name">{getSensorDisplayName(sensor.id, sensor.name, sensor.label)}</span>
                                  <div className="sensor-actions">
                                    <span className="sensor-icon">{getSensorIcon(sensor.type)}</span>
                                    <button
                                      className="visibility-toggle"
                                      onClick={() => toggleSensorVisibility(sensor.id)}
                                      title={isHidden ? "Show sensor" : "Hide sensor"}
                                    >
                                      {isHidden ? '👁️‍🗨️' : '👁️'}
                                    </button>
                                  </div>
                                </div>
                                <span className="sensor-type">{getSensorLabel(deriveSensorGroupId(sensor))}</span>
                              </div>
                              <div className="sensor-reading">
                                <div className="temperature-display">
                                  <span
                                    className={`temperature temperature-${getTemperatureClass(sensor.temperature, sensor.maxTemp, sensor.critTemp)}`}
                                  >
                                    {sensor.temperature.toFixed(1)}°C
                                  </span>
                                  {sensor.maxTemp && (
                                    <span className="temp-limit">Max: {sensor.maxTemp}°C</span>
                                  )}
                                </div>
                                <span className={`status-indicator ${sensor.status}`}>
                                  {sensor.status}
                                </span>
                              </div>
                            </div>
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
            <span className="expand-icon">{expandedFans ? '▼' : '▶'}</span>
          </div>
          
          {expandedFans && (
            <div className="fans-list">
              {system.current_fan_speeds.map((fan: FanReading) => (
                <div key={fan.id} className="fan-item">
                  <div className="fan-header">
                    <div className="fan-info">
                      <div className="fan-title">
                        <span className="fan-icon">🌀</span>
                        <span className="fan-name">{getFanDisplayName(fan.id, fan.name, fan.label)}</span>
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
                            strokeDashoffset={`${2 * Math.PI * 25 * (1 - fan.speed / 100)}`}
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
                          setSelectedSensors(prev => ({
                            ...prev,
                            [fan.id]: newSensorId
                          }));

                          // Save sensor selection immediately (independent of profile)
                          if (fan.dbId) {
                            try {
                              // Convert sensor ID to database ID or special identifier
                              let sensorDbId: number | string | null = null;
                              if (newSensorId && newSensorId !== "") {
                                if (newSensorId.startsWith('__')) {
                                  // Special identifier
                                  sensorDbId = newSensorId;
                                } else {
                                  // Regular sensor - find dbId
                                  const sensor = system.current_temperatures?.find(s => s.id === newSensorId);
                                  sensorDbId = sensor?.dbId || null;
                                }
                              }
                              await setFanSensor(fan.dbId, sensorDbId);
                            } catch (error) {
                              console.error('Failed to save sensor selection:', error);
                            }
                          }
                        }}
                        disabled={system.status !== 'online'}
                      >
                        <option value="">Select Sensor...</option>

                        {/* Highest Temperature Option */}
                        <option
                          value="__highest__"
                          title="Use the Highest Temperature on the system"
                        >
                          🔥 Highest ({highestTemperature?.toFixed(1) || '0.0'}°C)
                        </option>

                        {/* Separator */}
                        <option disabled>────────────────────</option>

                        {/* Sensor Groups Header and Options */}
                        {(() => {
                          const visibleSensors = system.current_temperatures
                            ?.filter((sensor: SensorReading) => !isSensorOrGroupHidden(sensor)) || [];

                          const sensorGroups = groupSensorsByChip(visibleSensors);
                          const sortedGroupIds = Object.keys(sensorGroups).sort((a, b) => {
                            const order = ['k10temp', 'coretemp', 'it8628', 'it87', 'nvme', 'gigabyte_wmi', 'asus_wmi', 'acpitz', 'thermal'];
                            const aIndex = order.indexOf(a);
                            const bIndex = order.indexOf(b);
                            if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
                            if (aIndex !== -1) return -1;
                            if (bIndex !== -1) return 1;
                            return a.localeCompare(b);
                          });

                          const groupsWithMultipleSensors = sortedGroupIds.filter(
                            groupId => sensorGroups[groupId].length > 1
                          );

                          if (groupsWithMultipleSensors.length === 0) return null;

                          return (
                            <>
                              <option disabled>(Groups)</option>
                              {groupsWithMultipleSensors.map(groupId => {
                                const groupSensors = sensorGroups[groupId];
                                const highestTemp = Math.max(...groupSensors.map(s => s.temperature));
                                return (
                                  <option
                                    key={`group-${groupId}`}
                                    value={`__group__${groupId}`}
                                    title="Selecting a group uses the Highest Temperature of that group"
                                  >
                                    📊 {getChipDisplayName(groupId)} ({highestTemp.toFixed(1)}°C)
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
                          ?.filter((sensor: SensorReading) => !isSensorOrGroupHidden(sensor))
                          .map((sensor: SensorReading) => (
                            <option key={sensor.id} value={sensor.id}>
                              {getSensorDisplayName(sensor.id, sensor.name, sensor.label)} ({sensor.temperature.toFixed(1)}°C)
                            </option>
                          ))
                        }
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
                            setSelectedProfiles(prev => ({ ...prev, [fan.id]: parseInt(profileId) }));
                            handleFanProfileAssignment(fan, parseInt(profileId));
                          } else {
                            setSelectedProfiles(prev => {
                              const updated = { ...prev };
                              delete updated[fan.id];
                              return updated;
                            });
                          }
                        }}
                        disabled={loading === `fan-profile-${fan.id}` || system.status !== 'online'}
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
      {(!system.current_temperatures || system.current_temperatures.length === 0) &&
       (!system.current_fan_speeds || system.current_fan_speeds.length === 0) && (
        <div className="no-data">
          <p>No real-time data available</p>
          <p>System may be offline or not sending data</p>
        </div>
      )}
    </div>
  );
};

export default SystemCard;

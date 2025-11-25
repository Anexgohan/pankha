using LibreHardwareMonitor.Hardware;
using Pankha.WindowsAgent.Models;
using Pankha.WindowsAgent.Models.Configuration;
using Serilog;

namespace Pankha.WindowsAgent.Hardware;

/// <summary>
/// Adapter for LibreHardwareMonitor library
/// </summary>
public class LibreHardwareAdapter : IHardwareMonitor
{
    private readonly HardwareSettings _settings;
    private readonly MonitoringSettings _monitoringSettings;
    private readonly Computer _computer;
    private readonly DateTime _startTime;
    private readonly ILogger _logger;
    private readonly NvidiaGpuController? _nvidiaController;

    // Cache for discovered hardware
    private readonly Dictionary<string, Fan> _fanCache = new();
    private readonly Dictionary<string, Sensor> _sensorCache = new();

    public LibreHardwareAdapter(HardwareSettings settings, MonitoringSettings monitoringSettings, ILogger logger)
    {
        _settings = settings;
        _monitoringSettings = monitoringSettings;
        _logger = logger;
        _startTime = DateTime.UtcNow;

        // Initialize LibreHardwareMonitor Computer
        _computer = new Computer
        {
            IsCpuEnabled = true,
            IsGpuEnabled = true,
            IsMemoryEnabled = true,
            IsMotherboardEnabled = true,
            IsControllerEnabled = true,
            IsNetworkEnabled = false,
            IsStorageEnabled = true
        };

        try
        {
            _computer.Open();
            _logger.Information("LibreHardwareMonitor initialized successfully");
        }
        catch (Exception ex)
        {
            _logger.Error(ex, "Failed to initialize LibreHardwareMonitor");
            throw;
        }

        // Initialize NVIDIA GPU controller
        try
        {
            _nvidiaController = new NvidiaGpuController(logger);
            if (_nvidiaController.IsAvailable)
            {
                _logger.Information("✅ NVIDIA GPU controller initialized");
            }
            else
            {
                _nvidiaController = null;
                _logger.Information("ℹ️ NVIDIA GPU controller not available (no NVIDIA GPU detected)");
            }
        }
        catch (Exception ex)
        {
            _logger.Warning(ex, "Failed to initialize NVIDIA GPU controller");
            _nvidiaController = null;
        }
    }

    public async Task UpdateAsync()
    {
        await Task.Run(() =>
        {
            try
            {
                foreach (var hardware in _computer.Hardware)
                {
                    hardware.Update();

                    // Update sub-hardware recursively
                    foreach (var subHardware in hardware.SubHardware)
                    {
                        subHardware.Update();
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.Error(ex, "Error updating hardware");
            }
        });
    }

    public async Task<List<Sensor>> DiscoverSensorsAsync()
    {
        var sensors = new List<Sensor>();

        await UpdateAsync();

        foreach (var hardware in _computer.Hardware)
        {
            AddSensorsFromHardware(hardware, sensors);

            // Process sub-hardware (e.g., GPU, NVMe drives)
            foreach (var subHardware in hardware.SubHardware)
            {
                AddSensorsFromHardware(subHardware, sensors);
            }
        }

        // Apply sensor deduplication if enabled
        if (_monitoringSettings.FilterDuplicateSensors)
        {
            sensors = DeduplicateSensors(sensors, _monitoringSettings.DuplicateSensorTolerance);
        }

        _logger.Information("Discovered {Count} sensors", sensors.Count);
        return sensors;
    }

    private void AddSensorsFromHardware(IHardware hardware, List<Sensor> sensors)
    {
        foreach (var sensor in hardware.Sensors)
        {
            // Only interested in temperature sensors
            if (sensor.SensorType != SensorType.Temperature)
                continue;

            if (!sensor.Value.HasValue)
                continue;

            var sensorModel = new Sensor
            {
                Id = GenerateSensorId(hardware, sensor),
                Name = sensor.Name,
                Label = sensor.Name,
                Type = DetermineSensorType(hardware.HardwareType),
                Temperature = sensor.Value.Value,
                Chip = hardware.Name,
                Source = $"{hardware.HardwareType}/{sensor.Name}",
                Priority = Sensor.GetChipPriority(hardware.Name)
            };

            // Try to get max and critical temps
            // LibreHardwareMonitor doesn't expose these directly, so we use defaults
            sensorModel.MaxTemp = 70.0;
            sensorModel.CritTemp = GetCriticalTemp(hardware.HardwareType);

            sensorModel.UpdateStatus();
            sensors.Add(sensorModel);
        }
    }

    private string GenerateSensorId(IHardware hardware, ISensor sensor)
    {
        // Create consistent ID format similar to Rust agent
        var hardwareType = hardware.HardwareType.ToString().ToLowerInvariant();
        var sensorName = sensor.Name.Replace(" ", "_").Replace("/", "_").ToLowerInvariant();
        // Use stable Identifier string instead of GetHashCode() which changes per restart
        var idSuffix = sensor.Identifier.ToString().Replace("/", "_").Replace("\\", "_");
        return $"{hardwareType}_{sensorName}_{idSuffix}";
    }

    private string DetermineSensorType(HardwareType hardwareType)
    {
        return hardwareType switch
        {
            HardwareType.Cpu => "cpu",
            HardwareType.GpuNvidia or HardwareType.GpuAmd or HardwareType.GpuIntel => "gpu",
            HardwareType.Motherboard => "motherboard",
            HardwareType.Storage => "storage",
            HardwareType.Memory => "memory",
            _ => "other"
        };
    }

    private double GetCriticalTemp(HardwareType hardwareType)
    {
        return hardwareType switch
        {
            HardwareType.Cpu => 95.0,
            HardwareType.GpuNvidia or HardwareType.GpuAmd => 90.0,
            HardwareType.Storage => 80.0,
            _ => 85.0
        };
    }

    /// <summary>
    /// Deduplicate sensors based on temperature tolerance
    /// </summary>
    private List<Sensor> DeduplicateSensors(List<Sensor> sensors, double tolerance)
    {
        var groups = sensors
            .GroupBy(s => Math.Round(s.Temperature / tolerance) * tolerance)
            .Where(g => g.Count() > 1);

        var toRemove = new HashSet<Sensor>();

        foreach (var group in groups)
        {
            // Keep the sensor with highest priority
            var best = group.OrderByDescending(s => s.Priority).First();
            foreach (var sensor in group.Where(s => s != best))
            {
                toRemove.Add(sensor);
            }
        }

        var result = sensors.Where(s => !toRemove.Contains(s)).ToList();

        if (toRemove.Count > 0)
        {
            _logger.Debug("Removed {Count} duplicate sensors", toRemove.Count);
        }

        return result;
    }

    public async Task<List<Fan>> DiscoverFansAsync()
    {
        var fans = new List<Fan>();

        await UpdateAsync();

        foreach (var hardware in _computer.Hardware)
        {
            AddFansFromHardware(hardware, fans);

            foreach (var subHardware in hardware.SubHardware)
            {
                AddFansFromHardware(subHardware, fans);
            }
        }

        _logger.Information("Discovered {Count} fans", fans.Count);
        return fans;
    }

    private void AddFansFromHardware(IHardware hardware, List<Fan> fans)
    {
        // Find RPM sensors
        var fanRpmSensors = hardware.Sensors
            .Where(s => s.SensorType == SensorType.Fan)
            .ToList();

        // Find control sensors (PWM)
        var fanControlSensors = hardware.Sensors
            .Where(s => s.SensorType == SensorType.Control)
            .ToList();

        foreach (var rpmSensor in fanRpmSensors)
        {
            if (!rpmSensor.Value.HasValue)
                continue;

            var fanId = GenerateFanId(hardware, rpmSensor);

            // Try to find matching control sensor
            var controlSensor = fanControlSensors.FirstOrDefault(c =>
                c.Name.Contains(rpmSensor.Name.Split(' ')[0]));

            var fan = new Fan
            {
                Id = fanId,
                Name = rpmSensor.Name,
                Label = rpmSensor.Name,
                Rpm = (int)rpmSensor.Value.Value,
                Speed = controlSensor?.Value.HasValue == true ? (int)controlSensor.Value.Value : 0,
                TargetSpeed = 0,
                HasPwmControl = controlSensor != null,
                HardwareReference = controlSensor
            };

            fan.UpdateStatus();
            fans.Add(fan);

            // Cache the fan for later control operations
            _fanCache[fanId] = fan;
        }
    }

    private string GenerateFanId(IHardware hardware, ISensor sensor)
    {
        var hardwareType = hardware.HardwareType.ToString().ToLowerInvariant();
        var fanName = sensor.Name.Replace(" ", "_").ToLowerInvariant();
        // Use stable Identifier string instead of GetHashCode() which changes per restart
        var idSuffix = sensor.Identifier.ToString().Replace("/", "_").Replace("\\", "_");
        return $"{hardwareType}_fan_{fanName}_{idSuffix}";
    }

    public async Task<SystemHealth> GetSystemHealthAsync()
    {
        await UpdateAsync();

        double cpuUsage = 0;
        double memoryUsage = 0;
        int cpuCount = 0;

        foreach (var hardware in _computer.Hardware)
        {
            if (hardware.HardwareType == HardwareType.Cpu)
            {
                var loadSensor = hardware.Sensors.FirstOrDefault(s =>
                    s.SensorType == SensorType.Load && s.Name.Contains("Total"));

                if (loadSensor?.Value.HasValue == true)
                {
                    cpuUsage += loadSensor.Value.Value;
                    cpuCount++;
                }
            }
            else if (hardware.HardwareType == HardwareType.Memory)
            {
                var usedSensor = hardware.Sensors.FirstOrDefault(s =>
                    s.SensorType == SensorType.Data && s.Name.Contains("Used"));

                var totalSensor = hardware.Sensors.FirstOrDefault(s =>
                    s.SensorType == SensorType.Data && s.Name.Contains("Available"));

                if (usedSensor?.Value.HasValue == true && totalSensor?.Value.HasValue == true)
                {
                    var used = usedSensor.Value.Value;
                    var total = used + totalSensor.Value.Value;
                    memoryUsage = (used / total) * 100.0;
                }
            }
        }

        if (cpuCount > 0)
        {
            cpuUsage /= cpuCount;
        }

        var uptime = (DateTime.UtcNow - _startTime).TotalSeconds;

        return new SystemHealth(cpuUsage, memoryUsage, uptime);
    }

    public async Task SetFanSpeedAsync(string fanId, int speed)
    {
        if (!_settings.EnableFanControl)
        {
            throw new InvalidOperationException("Fan control is disabled in configuration");
        }

        // Validate speed (0-100%, no minimum for testing NVIDIA GPU control)
        speed = Math.Clamp(speed, 0, 100);

        if (!_fanCache.TryGetValue(fanId, out var fan))
        {
            throw new ArgumentException($"Fan not found: {fanId}");
        }

        if (!fan.HasPwmControl)
        {
            throw new InvalidOperationException($"Fan does not support PWM control: {fanId}");
        }

        // Rate limiting: max 1 write per 100ms per fan
        var timeSinceLastWrite = DateTime.UtcNow - fan.LastWriteTime;
        if (timeSinceLastWrite.TotalMilliseconds < 100)
        {
            _logger.Debug("Rate limiting fan {FanId} (last write {Ms}ms ago)", fanId, timeSinceLastWrite.TotalMilliseconds);
            return;
        }

        // Deduplication: skip if same value
        if (fan.LastPwmValue == speed)
        {
            _logger.Debug("Skipping duplicate fan speed for {FanId} (already {Speed}%)", fanId, speed);
            return;
        }

        // Check if this is an NVIDIA GPU fan - use NvAPIWrapper
        if (_nvidiaController?.CanControlFan(fanId) == true)
        {
            _logger.Debug("Using NVIDIA GPU controller for {FanId}", fanId);
            var success = await _nvidiaController.SetFanSpeedAsync(fanId, speed);
            if (success)
            {
                fan.LastPwmValue = speed;
                fan.LastWriteTime = DateTime.UtcNow;
            }
            else
            {
                _logger.Warning("❌ NVIDIA GPU fan control failed for {FanId}", fanId);
            }
            return;
        }

        // Fallback to LibreHardwareMonitor for non-NVIDIA fans
        await Task.Run(() =>
        {
            try
            {
                var controlSensor = fan.HardwareReference as ISensor;
                if (controlSensor != null)
                {
                    controlSensor.Control?.SetSoftware(speed);
                    fan.LastPwmValue = speed;
                    fan.LastWriteTime = DateTime.UtcNow;
                    _logger.Information("Set fan {FanId} to {Speed}%", fanId, speed);
                }
            }
            catch (Exception ex)
            {
                _logger.Error(ex, "Failed to set fan speed for {FanId}", fanId);
                throw;
            }
        });
    }

    public async Task EmergencyStopAsync()
    {
        _logger.Warning("Emergency stop activated - setting all fans to 100%");

        var tasks = _fanCache.Values
            .Where(f => f.HasPwmControl)
            .Select(f => SetFanSpeedAsync(f.Id, 100));

        await Task.WhenAll(tasks);
    }

    public void Dispose()
    {
        try
        {
            _nvidiaController?.Dispose();
            _computer.Close();
            _logger.Information("LibreHardwareMonitor closed");
        }
        catch (Exception ex)
        {
            _logger.Error(ex, "Error closing LibreHardwareMonitor");
        }
    }
}

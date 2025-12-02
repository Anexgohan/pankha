using LibreHardwareMonitor.Hardware;
using Pankha.WindowsAgent.Models;
using Pankha.WindowsAgent.Models.Configuration;
using Pankha.WindowsAgent.Utilities;
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

    // Thread safety lock for hardware access
    private readonly object _hardwareLock = new();

    // Cache for discovered hardware
    private readonly Dictionary<string, Fan> _fanCache = new();
    private readonly Dictionary<string, Sensor> _sensorCache = new();

    // System health cache (1-second TTL like Rust agent)
    private SystemHealth? _cachedSystemHealth;
    private DateTime _systemHealthCacheTime = DateTime.MinValue;

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
                _logger.Information("NVIDIA GPU controller initialized");
            }
            else
            {
                _nvidiaController = null;
                _logger.Information("NVIDIA GPU controller not available (no NVIDIA GPU detected)");
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
                lock (_hardwareLock) // Thread safety for LibreHardwareMonitor access
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

        lock (_hardwareLock) // Thread safety for hardware enumeration
        {
            foreach (var hardware in _computer.Hardware)
            {
                AddSensorsFromHardware(hardware, sensors);

                // Process sub-hardware (e.g., GPU, NVMe drives)
                foreach (var subHardware in hardware.SubHardware)
                {
                    AddSensorsFromHardware(subHardware, sensors);
                }
            }
        }

        // Apply sensor deduplication if enabled
        if (_monitoringSettings.FilterDuplicateSensors && sensors.Count > 1)
        {
            _logger.Debug("Applying sensor deduplication with {Tolerance}°C tolerance",
                _monitoringSettings.DuplicateSensorTolerance);
            sensors = SensorDeduplicator.Deduplicate(
                sensors,
                _monitoringSettings.DuplicateSensorTolerance,
                _logger);
        }
        else
        {
            _logger.Debug("Discovered {Count} sensors (deduplication disabled)", sensors.Count);
        }

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
                Name = $"{GetFriendlyChipName(hardware)} {sensor.Name}",  // e.g., "NVIDIA GPU Core", "AMD CPU Tctl/Tdie"
                Label = sensor.Name,  // Short label: "GPU Core", "Tctl/Tdie"
                Type = DetermineSensorType(hardware.HardwareType),
                Temperature = sensor.Value.Value,
                Chip = GetStandardizedChipId(hardware),  // Standardized ID for frontend lookup (k10temp, nvme, gpu, etc.)
                Source = $"{hardware.HardwareType}/{sensor.Name}",
                Priority = Sensor.GetChipPriority(hardware.Name),
                HardwareName = hardware.Name  // Full hardware name: "AMD Ryzen 9 3900X", "NVIDIA GeForce RTX 2070 SUPER"
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
        // Create descriptive, stable IDs
        // Old format: /nvidiagpu/0/temperature/0 -> nvidiagpu_0_temperature_0
        // New format: nvidiagpu_0_gpu_core
        
        // 1. Get standardized chip ID (e.g., nvidiagpu_0)
        var chipId = hardware.Identifier.ToString()
            .Replace("/", "_")
            .TrimStart('_')
            .ToLowerInvariant();

        // 2. Sanitize sensor name
        var sensorName = sensor.Name
            .Replace(" ", "_")
            .Replace("-", "_")
            .Replace("/", "_")
            .Replace("(", "")
            .Replace(")", "")
            .Replace("#", "")
            .ToLowerInvariant();

        // 3. Combine
        return $"{chipId}_{sensorName}";
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

    private string GetStandardizedChipId(IHardware hardware)
    {
        // Return raw chip type for frontend mapping
        // Examples: "nvidiagpu", "amdcpu", "intelcpu", "genericmemory", "nvme"
        
        var id = hardware.Identifier.ToString();
        
        // Identifier format: /{type}/{index}
        // Extract type (e.g., "nvidiagpu" from "/nvidiagpu/0")
        var parts = id.Split(new[] { '/' }, StringSplitOptions.RemoveEmptyEntries);
        
        if (parts.Length > 0)
        {
            return parts[0].ToLowerInvariant();
        }

        return hardware.HardwareType.ToString().ToLowerInvariant();
    }

    /// <summary>
    /// Extract hardware brand from the full hardware name
    /// Generic pattern matching for common brands across all device types
    /// </summary>
    private string ExtractBrand(string hardwareName)
    {
        var name = hardwareName.ToLowerInvariant();

        // CPU brands
        if (name.Contains("amd") || name.Contains("ryzen") || name.Contains("epyc") || name.Contains("threadripper"))
            return "AMD";
        if (name.Contains("intel") || name.Contains("core") || name.Contains("xeon") || name.Contains("pentium"))
            return "Intel";
        if (name.Contains("qualcomm") || name.Contains("snapdragon"))
            return "Qualcomm";
        if (name.Contains("arm") || name.Contains("cortex"))
            return "ARM";

        // GPU brands
        if (name.Contains("nvidia") || name.Contains("geforce") || name.Contains("quadro") || name.Contains("rtx") || name.Contains("gtx"))
            return "NVIDIA";
        if (name.Contains("radeon") || name.Contains("rx "))
            return "AMD";
        if (name.Contains("arc") || name.Contains("iris") || name.Contains("uhd"))
            return "Intel";
        if (name.Contains("mali"))
            return "ARM";
        if (name.Contains("adreno"))
            return "Qualcomm";

        // Storage brands
        if (name.Contains("samsung"))
            return "Samsung";
        if (name.Contains("western digital") || name.Contains("wd ") || name.Contains("wd_"))
            return "WD";
        if (name.Contains("seagate"))
            return "Seagate";
        if (name.Contains("crucial"))
            return "Crucial";
        if (name.Contains("kingston"))
            return "Kingston";
        if (name.Contains("corsair"))
            return "Corsair";
        if (name.Contains("sandisk"))
            return "SanDisk";
        if (name.Contains("micron"))
            return "Micron";
        if (name.Contains("sk hynix") || name.Contains("hynix"))
            return "SK Hynix";
        if (name.Contains("toshiba"))
            return "Toshiba";
        if (name.Contains("adata") || name.Contains("xpg"))
            return "ADATA";
        if (name.Contains("sabrent"))
            return "Sabrent";
        if (name.Contains("plextor"))
            return "Plextor";
        if (name.Contains("transcend"))
            return "Transcend";

        // Motherboard/chipset brands
        if (name.Contains("asus"))
            return "ASUS";
        if (name.Contains("gigabyte"))
            return "Gigabyte";
        if (name.Contains("msi"))
            return "MSI";
        if (name.Contains("asrock"))
            return "ASRock";
        if (name.Contains("evga"))
            return "EVGA";
        if (name.Contains("nuvoton") || name.Contains("nct"))
            return "Nuvoton";
        if (name.Contains("ite") || name.Contains("it87") || name.Contains("it86"))
            return "ITE";
        if (name.Contains("asmedia"))
            return "ASMedia";

        return string.Empty;
    }

    private string GetFriendlyChipName(IHardware hardware)
    {
        var brand = ExtractBrand(hardware.Name);

        // TYPE-first ordering for better grouping in UI (CPU AMD, GPU NVIDIA, Storage Samsung, etc.)
        return hardware.HardwareType switch
        {
            HardwareType.GpuNvidia => !string.IsNullOrEmpty(brand) ? $"GPU {brand}" : "GPU NVIDIA",
            HardwareType.GpuAmd => !string.IsNullOrEmpty(brand) ? $"GPU {brand}" : "GPU AMD",
            HardwareType.GpuIntel => !string.IsNullOrEmpty(brand) ? $"GPU {brand}" : "GPU Intel",

            HardwareType.Cpu => !string.IsNullOrEmpty(brand) ? $"CPU {brand}" : "CPU",

            HardwareType.Storage => !string.IsNullOrEmpty(brand) ? $"Storage {brand}" : "Storage",

            HardwareType.Memory => !string.IsNullOrEmpty(brand) ? $"Memory {brand}" : "Memory",

            HardwareType.Motherboard => !string.IsNullOrEmpty(brand) ? $"Motherboard {brand}" : "Motherboard",

            HardwareType.EmbeddedController => "Controller",

            _ => hardware.HardwareType.ToString()
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

    public async Task<List<Fan>> DiscoverFansAsync()
    {
        var fans = new List<Fan>();

        await UpdateAsync();

        lock (_hardwareLock) // Thread safety for hardware enumeration
        {
            foreach (var hardware in _computer.Hardware)
            {
                AddFansFromHardware(hardware, fans);

                foreach (var subHardware in hardware.SubHardware)
                {
                    AddFansFromHardware(subHardware, fans);
                }
            }
        }

        _logger.Debug("Discovered {Count} fans", fans.Count);
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

            // Preserve existing fan control state if already cached
            Fan fan;
            if (_fanCache.TryGetValue(fanId, out var existingFan))
            {
                // Update current readings but preserve control state
                existingFan.Rpm = (int)rpmSensor.Value.Value;
                existingFan.Speed = controlSensor?.Value.HasValue == true ? (int)controlSensor.Value.Value : 0;
                existingFan.HardwareReference = controlSensor;
                // Preserve: LastWriteTime, LastPwmValue (critical for rate limiting/deduplication)
                existingFan.UpdateStatus();
                fan = existingFan;
            }
            else
            {
                // First discovery - create new fan
                fan = new Fan
                {
                    Id = fanId,
                    Name = $"{GetFriendlyChipName(hardware)} {rpmSensor.Name}",  // e.g., "NVIDIA GPU Fan"
                    Label = rpmSensor.Name,  // Short label: "Fan"
                    Rpm = (int)rpmSensor.Value.Value,
                    Speed = controlSensor?.Value.HasValue == true ? (int)controlSensor.Value.Value : 0,
                    TargetSpeed = 0,
                    HasPwmControl = controlSensor != null,
                    HardwareReference = controlSensor
                };
                fan.UpdateStatus();

                // Add to cache
                _fanCache[fanId] = fan;
            }

            fans.Add(fan);
        }
    }

    private string GenerateFanId(IHardware hardware, ISensor sensor)
    {
        // Create simple, stable IDs like Rust agent
        var chipName = hardware.Name
            .Replace(" ", "")
            .Replace("-", "")
            .Replace("_", "")
            .ToLowerInvariant();

        // Extract numeric index from identifier
        var identifier = sensor.Identifier.ToString();
        var lastSlashIndex = identifier.LastIndexOf('/');
        var fanIndex = lastSlashIndex >= 0 ? identifier.Substring(lastSlashIndex + 1) : "0";

        // Simple fan ID: "nvidiagefortertx2070super_fan1"
        return $"{chipName}_fan{fanIndex}";
    }

    public async Task<SystemHealth> GetSystemHealthAsync()
    {
        // Check cache first (1-second TTL, matching Rust agent)
        var cacheAge = DateTime.UtcNow - _systemHealthCacheTime;
        if (_cachedSystemHealth != null && cacheAge.TotalSeconds < 1.0)
        {
            _logger.Verbose("System health cache hit ({Age:F2}s old)", cacheAge.TotalSeconds);
            return _cachedSystemHealth;
        }

        await UpdateAsync();

        double cpuUsage = 0;
        double memoryUsage = 0;
        int cpuCount = 0;

        lock (_hardwareLock) // Thread safety for hardware access
        {
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
        }

        if (cpuCount > 0)
        {
            cpuUsage /= cpuCount;
        }

        var uptime = (DateTime.UtcNow - _startTime).TotalSeconds;

        var health = new SystemHealth(cpuUsage, memoryUsage, uptime);

        // Update cache
        _cachedSystemHealth = health;
        _systemHealthCacheTime = DateTime.UtcNow;

        return health;
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

    public async Task ResetAllToAutoAsync()
    {
        _logger.Information("Restoring all fans to auto/default control");

        var tasks = new List<Task>();

        foreach (var fan in _fanCache.Values.Where(f => f.HasPwmControl))
        {
            tasks.Add(Task.Run(async () =>
            {
                try
                {
                    // 1. Handle NVIDIA GPUs
                    if (_nvidiaController != null && _nvidiaController.CanControlFan(fan.Id))
                    {
                        await _nvidiaController.ResetToAutoAsync(fan.Id);
                        return;
                    }

                    // 2. Handle Generic Fans (LibreHardwareMonitor)
                    // Find the control sensor for this fan
                    var controlSensor = fan.HardwareReference as ISensor;

                    if (controlSensor?.Control != null)
                    {
                        controlSensor.Control.SetDefault();
                        _logger.Information("Reset fan {FanId} to default", fan.Id);
                    }
                }
                catch (Exception ex)
                {
                    _logger.Error(ex, "Failed to reset fan {FanId} to auto", fan.Id);
                }
            }));
        }

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

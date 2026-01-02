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

    // Hardware update deduplication - single UpdateAsync() per data cycle
    private DateTime _lastHardwareUpdateTime = DateTime.MinValue;
    private const double HARDWARE_UPDATE_TTL_SECONDS = 0.5; // 500ms TTL for hardware updates

    // Periodic hardware rediscovery (5 minutes)
    private DateTime _lastFullDiscoveryTime = DateTime.MinValue;
    private const double FULL_DISCOVERY_INTERVAL_MINUTES = 5.0;
    private bool _forceRediscovery = true; // Force rediscovery on startup/reconnection

    public LibreHardwareAdapter(HardwareSettings settings, ILogger logger)
    {
        _settings = settings;
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
            IsNetworkEnabled = true,
            IsStorageEnabled = true
        };

        _logger.Information("Initializing LibreHardwareMonitor with all hardware enabled");

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
        // Deduplication: Skip if updated recently (within TTL)
        var timeSinceLastUpdate = (DateTime.UtcNow - _lastHardwareUpdateTime).TotalSeconds;
        if (timeSinceLastUpdate < HARDWARE_UPDATE_TTL_SECONDS)
        {
            _logger.Verbose("Hardware update skipped (last update {Ms:F0}ms ago)", timeSinceLastUpdate * 1000);
            return;
        }

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
                _lastHardwareUpdateTime = DateTime.UtcNow;
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
                CollectSensorsRecursive(hardware, sensors);
            }
        }

        // Sensor deduplication removed (deprecated feature)
        _logger.Debug("Discovered {Count} sensors", sensors.Count);

        return sensors;
    }

    private void CollectSensorsRecursive(IHardware hardware, List<Sensor> sensors)
    {
        AddSensorsFromHardware(hardware, sensors);

        foreach (var subHardware in hardware.SubHardware)
        {
            CollectSensorsRecursive(subHardware, sensors);
        }
    }

    private void AddSensorsFromHardware(IHardware hardware, List<Sensor> sensors)
    {
        foreach (var sensor in hardware.Sensors)
        {
            // Allow Temperature and other useful types (throughput, etc. if needed later)
            // For now, let's keep it to Temperature but log if we skip something interesting
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
            HardwareType.Motherboard or HardwareType.SuperIO => "motherboard",
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
        // Recursive fan discovery
        CollectFansRecursive(hardware, fans);
    }

    private void CollectFansRecursive(IHardware hardware, List<Fan> fans)
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
            // Match "Fan #1" with "Fan Control #1" by simpler name parsing
            // This is heuristic but works for most mobos (Nuvoton/ITE)
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

        foreach (var sub in hardware.SubHardware)
        {
            CollectFansRecursive(sub, fans);
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

    /// <summary>
    /// Enter failsafe mode: GPU fans → auto, other fans → configured failsafe speed
    /// </summary>
    public async Task EnterFailsafeModeAsync()
    {
        var failsafeSpeed = _settings.FailsafeSpeed;
        _logger.Information("Entering failsafe mode: GPU→auto, others→{Speed}%", failsafeSpeed);

        var tasks = new List<Task>();

        foreach (var fan in _fanCache.Values.Where(f => f.HasPwmControl))
        {
            tasks.Add(Task.Run(async () =>
            {
                try
                {
                    // NVIDIA GPUs: Reset to auto (works reliably)
                    if (_nvidiaController != null && _nvidiaController.CanControlFan(fan.Id))
                    {
                        await _nvidiaController.ResetToAutoAsync(fan.Id);
                        _logger.Information("GPU fan {FanId} reset to auto", fan.Id);
                        return;
                    }

                    // All other fans: Set to configurable failsafe speed
                    await SetFanSpeedAsync(fan.Id, failsafeSpeed);
                    _logger.Information("Fan {FanId} set to {Speed}% (failsafe)", fan.Id, failsafeSpeed);
                }
                catch (Exception ex)
                {
                    _logger.Error(ex, "Failed to set failsafe for fan {FanId}", fan.Id);
                }
            }));
        }

        await Task.WhenAll(tasks);
        _logger.Warning("FAILSAFE MODE ACTIVE: GPU fans on auto, others at {Speed}%", failsafeSpeed);
    }

    /// <summary>
    /// Set all fans to a specific speed percentage
    /// </summary>
    public async Task SetAllFansToSpeedAsync(int speed)
    {
        _logger.Information("Setting all fans to {Speed}%", speed);

        var tasks = _fanCache.Values
            .Where(f => f.HasPwmControl)
            .Select(f => SetFanSpeedAsync(f.Id, speed));

        await Task.WhenAll(tasks);
    }

    /// <summary>
    /// Get the maximum temperature across all sensors
    /// Used by ConnectionWatchdog for emergency temperature detection during failsafe mode
    /// </summary>
    public async Task<double> GetMaxTemperatureAsync()
    {
        // FIX: Use DiscoverSensorsAsync() to get actual sensor data
        // Previous bug: _sensorCache was never populated, so this always returned 0.0
        var sensors = await DiscoverSensorsAsync();
        
        if (!sensors.Any())
            return 0.0;
        
        return sensors.Max(s => s.Temperature);
    }

    /// <summary>
    /// Invalidate hardware cache (call on startup/reconnection to force rediscovery)
    /// </summary>
    public void InvalidateCache()
    {
        _forceRediscovery = true;
        _lastHardwareUpdateTime = DateTime.MinValue;
        _lastFullDiscoveryTime = DateTime.MinValue;
        _logger.Debug("Hardware cache invalidated - next discovery will be full rediscovery");
    }

    /// <summary>
    /// Check if full hardware rediscovery is needed (periodic or forced)
    /// </summary>
    public bool NeedsFullRediscovery()
    {
        if (_forceRediscovery)
        {
            _forceRediscovery = false;
            _lastFullDiscoveryTime = DateTime.UtcNow;
            _logger.Information("Full hardware rediscovery triggered (forced/reconnection)");
            return true;
        }

        var timeSinceLastDiscovery = (DateTime.UtcNow - _lastFullDiscoveryTime).TotalMinutes;
        if (timeSinceLastDiscovery >= FULL_DISCOVERY_INTERVAL_MINUTES)
        {
            _lastFullDiscoveryTime = DateTime.UtcNow;
            _logger.Information("Full hardware rediscovery triggered (periodic, {Minutes:F1} min elapsed)", timeSinceLastDiscovery);
            return true;
        }

        return false;
    }

    public async Task<List<HardwareDumpItem>> DumpFullHardwareInfoAsync()
    {
        await UpdateAsync();

        var result = new List<HardwareDumpItem>();

        lock (_hardwareLock)
        {
            foreach (var hardware in _computer.Hardware)
            {
                result.Add(MapToDumpItem(hardware));
            }
        }

        return result;
    }

    private HardwareDumpItem MapToDumpItem(IHardware hardware, string? parentId = null)
    {
        // Build sensor list with control info
        var sensors = new List<HardwareDumpSensor>();
        
        // First pass: collect all sensors
        foreach (var s in hardware.Sensors)
        {
            var dumpSensor = new HardwareDumpSensor
            {
                Name = s.Name,
                Identifier = s.Identifier.ToString(),
                Type = s.SensorType.ToString(),
                Value = s.Value,
                Min = s.Min?.ToString() ?? "null",
                Max = s.Max?.ToString() ?? "null",
                IsMonitored = s.SensorType == SensorType.Temperature || 
                              s.SensorType == SensorType.Fan || 
                              s.SensorType == SensorType.Control
            };
            
            // Extract control info for Fan and Control type sensors
            if (s.SensorType == SensorType.Control || s.SensorType == SensorType.Fan)
            {
                dumpSensor.Control = BuildControlInfo(s, hardware);
            }
            
            sensors.Add(dumpSensor);
        }
        
        // Second pass: link Fan and Control sensors
        LinkFanControlSensors(sensors);
        
        var item = new HardwareDumpItem
        {
            Name = hardware.Name,
            Identifier = hardware.Identifier.ToString(),
            Type = hardware.HardwareType.ToString(),
            Parent = parentId,
            Sensors = sensors
        };

        foreach (var sub in hardware.SubHardware)
        {
            item.SubHardware.Add(MapToDumpItem(sub, hardware.Identifier.ToString()));
        }

        return item;
    }
    
    private ControlInfo BuildControlInfo(ISensor sensor, IHardware hardware)
    {
        var controlInfo = new ControlInfo
        {
            CurrentPercent = sensor.SensorType == SensorType.Control ? sensor.Value : null,
            CanWrite = sensor.Control != null,
            Range = [0, 100]
        };
        
        // Detect control method based on hardware type
        controlInfo.Method = hardware.HardwareType switch
        {
            HardwareType.GpuNvidia => "NvAPI",
            HardwareType.GpuAmd => "ADL",
            HardwareType.GpuIntel => "IntelGPU",
            HardwareType.SuperIO => "SuperIO",
            HardwareType.EmbeddedController => "EC",
            _ => "Unknown"
        };
        
        // NVIDIA GPUs can restore to auto (driver control)
        // SuperIO and other fans typically cannot
        controlInfo.CanRestoreDefault = hardware.HardwareType == HardwareType.GpuNvidia ||
                                        hardware.HardwareType == HardwareType.GpuAmd;
        
        return controlInfo;
    }
    
    private void LinkFanControlSensors(List<HardwareDumpSensor> sensors)
    {
        // Link Fan sensors to corresponding Control sensors by matching identifier patterns
        // Pattern: /gpu-nvidia/0/fan/1 <-> /gpu-nvidia/0/control/1
        //          /lpc/.../fan/0 <-> /lpc/.../control/0
        
        var fanSensors = sensors.Where(s => s.Type == "Fan" && s.Control != null).ToList();
        var controlSensors = sensors.Where(s => s.Type == "Control" && s.Control != null).ToList();
        
        foreach (var fan in fanSensors)
        {
            // Extract base path and index: "/gpu-nvidia/0/fan/1" -> "/gpu-nvidia/0/" and "1"
            var fanId = fan.Identifier;
            var lastSlash = fanId.LastIndexOf('/');
            if (lastSlash <= 0) continue;
            
            var fanIndex = fanId.Substring(lastSlash + 1);
            var basePath = fanId.Substring(0, fanId.LastIndexOf("/fan/"));
            
            // Look for matching control: same base + "/control/" + same index
            var matchingControl = controlSensors.FirstOrDefault(c => 
                c.Identifier == $"{basePath}/control/{fanIndex}");
            
            if (matchingControl != null)
            {
                fan.Control!.LinkedSensorId = matchingControl.Identifier;
                matchingControl.Control!.LinkedSensorId = fan.Identifier;
            }
        }
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

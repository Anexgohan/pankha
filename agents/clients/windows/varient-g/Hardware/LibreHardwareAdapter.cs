using LibreHardwareMonitor.Hardware;
using Pankha.WindowsAgent.Models;
using Pankha.WindowsAgent.Models.Configuration;
using Microsoft.Extensions.Logging;

namespace Pankha.WindowsAgent.Hardware;

public class LibreHardwareAdapter : IHardwareMonitor
{
    private readonly AgentConfig _config;
    private readonly ILogger<LibreHardwareAdapter> _logger;
    private readonly Computer _computer;
    private readonly NvidiaGpuController? _nvidiaController;
    private readonly object _lock = new();

    // Cache
    private readonly Dictionary<string, Fan> _fanCache = new();

    public LibreHardwareAdapter(AgentConfig config, ILogger<LibreHardwareAdapter> logger, ILoggerFactory loggerFactory)
    {
        _config = config;
        _logger = logger;

        _computer = new Computer
        {
            IsCpuEnabled = true,
            IsGpuEnabled = true,
            IsMemoryEnabled = true,
            IsMotherboardEnabled = true,
            IsControllerEnabled = true,
            IsStorageEnabled = true,
            IsNetworkEnabled = false
        };

        try
        {
            _computer.Open();
            _logger.LogInformation("LibreHardwareMonitor opened successfully");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to open LibreHardwareMonitor");
        }

        // Initialize NVIDIA Controller
        try
        {
            _nvidiaController = new NvidiaGpuController(loggerFactory.CreateLogger<NvidiaGpuController>());
            if (_nvidiaController.IsAvailable)
            {
                _logger.LogInformation("NVIDIA GPU Controller initialized");
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to initialize NVIDIA GPU Controller");
        }
    }

    public Task UpdateAsync()
    {
        return Task.Run(() =>
        {
            lock (_lock)
            {
                foreach (var hardware in _computer.Hardware)
                {
                    hardware.Update();
                    foreach (var sub in hardware.SubHardware) sub.Update();
                }
            }
        });
    }

    public Task<List<Sensor>> DiscoverSensorsAsync()
    {
        return Task.Run(() =>
        {
            var sensors = new List<Sensor>();
            lock (_lock)
            {
                foreach (var hardware in _computer.Hardware)
                {
                    AddSensors(hardware, sensors);
                    foreach (var sub in hardware.SubHardware) AddSensors(sub, sensors);
                }
            }
            return sensors;
        });
    }

    private void AddSensors(IHardware hardware, List<Sensor> sensors)
    {
        foreach (var sensor in hardware.Sensors)
        {
            if (sensor.SensorType != SensorType.Temperature || !sensor.Value.HasValue) continue;

            var model = new Sensor
            {
                Id = GenerateId(hardware, sensor),
                Name = $"{hardware.Name} {sensor.Name}",
                Label = sensor.Name,
                Type = MapSensorType(hardware.HardwareType),
                Temperature = sensor.Value.Value,
                Chip = hardware.Name,
                Source = "LHM",
                Priority = Sensor.GetChipPriority(hardware.Name)
            };
            model.UpdateStatus();
            sensors.Add(model);
        }
    }

    public Task<List<Fan>> DiscoverFansAsync()
    {
        return Task.Run(() =>
        {
            var fans = new List<Fan>();
            lock (_lock)
            {
                foreach (var hardware in _computer.Hardware)
                {
                    AddFans(hardware, fans);
                    foreach (var sub in hardware.SubHardware) AddFans(sub, fans);
                }
            }
            return fans;
        });
    }

    private void AddFans(IHardware hardware, List<Fan> fans)
    {
        var fanSensors = hardware.Sensors.Where(s => s.SensorType == SensorType.Fan).ToList();
        var controlSensors = hardware.Sensors.Where(s => s.SensorType == SensorType.Control).ToList();

        for (int i = 0; i < fanSensors.Count; i++)
        {
            var sensor = fanSensors[i];
            
            // Try to match control sensor
            var controlSensor = controlSensors.FirstOrDefault(c => c.Name.Contains(sensor.Name.Replace("Fan", "").Trim()));
            if (controlSensor == null && i < controlSensors.Count) controlSensor = controlSensors[i];

            var fanId = GenerateId(hardware, sensor);
            var fan = new Fan
            {
                Id = fanId,
                Name = $"{hardware.Name} {sensor.Name}",
                Label = sensor.Name,
                Rpm = (int)(sensor.Value ?? 0),
                Speed = controlSensor != null ? (int)(controlSensor.Value ?? 0) : 0,
                // CRITICAL FIX: Force HasPwmControl for NVIDIA GPUs
                HasPwmControl = controlSensor != null || hardware.HardwareType == HardwareType.GpuNvidia,
                HardwareReference = controlSensor
            };
            fan.UpdateStatus();
            fans.Add(fan);
            _fanCache[fanId] = fan;
        }
    }

    public Task<SystemHealth> GetSystemHealthAsync()
    {
        // Simplified health check
        return Task.FromResult(new SystemHealth(0, 0, 0)); 
    }

    public async Task SetFanSpeedAsync(string fanId, int speed)
    {
        if (!_config.Hardware.EnableFanControl) return;

        // 1. Check NVIDIA
        if (_nvidiaController != null && _nvidiaController.CanControlFan(fanId))
        {
            await _nvidiaController.SetFanSpeedAsync(fanId, speed);
            return;
        }

        // 2. Check LHM
        if (_fanCache.TryGetValue(fanId, out var fan) && fan.HardwareReference is ISensor controlSensor)
        {
            controlSensor.Control.SetSoftware(speed);
            _logger.LogInformation("Set LHM fan {Id} to {Speed}%", fanId, speed);
        }
        else
        {
            _logger.LogWarning("Cannot control fan {Id}: No control sensor or NVIDIA controller found", fanId);
        }
    }

    public async Task EmergencyStopAsync()
    {
        _logger.LogWarning("EMERGENCY STOP!");
        var fans = await DiscoverFansAsync();
        foreach (var fan in fans)
        {
            await SetFanSpeedAsync(fan.Id, 100);
        }
    }

    private string GenerateId(IHardware hardware, ISensor sensor)
    {
        return $"{hardware.HardwareType}-{hardware.Name}-{sensor.Name}-{sensor.Index}".Replace(" ", "_");
    }

    private string MapSensorType(HardwareType type)
    {
        return type switch
        {
            HardwareType.Cpu => "cpu",
            HardwareType.GpuNvidia => "gpu",
            HardwareType.GpuAmd => "gpu",
            HardwareType.Motherboard => "motherboard",
            _ => "other"
        };
    }

    public void Dispose()
    {
        _computer.Close();
        _nvidiaController?.Dispose();
    }
}

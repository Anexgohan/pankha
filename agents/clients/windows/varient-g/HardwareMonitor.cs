using System;
using System.Collections.Generic;
using System.Linq;
using LibreHardwareMonitor.Hardware;
using Microsoft.Extensions.Logging;

namespace PankhaAgent
{
    public class HardwareMonitor : IDisposable
    {
        private readonly Computer _computer;
        private readonly ILogger<HardwareMonitor> _logger;
        private readonly object _lock = new object();
        private readonly List<SensorData> _sensors = new List<SensorData>();

        public HardwareMonitor(ILogger<HardwareMonitor> logger)
        {
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
                _logger.LogInformation("Hardware Monitor opened successfully");
                
                // Initialize NvAPI for NVIDIA GPU control
                try 
                {
                    NvAPIWrapper.NVIDIA.Initialize();
                    _logger.LogInformation("NvAPI Initialized successfully");
                    
                    // Log detected GPUs and Coolers
                    try 
                    {
                        var physicalGpus = NvAPIWrapper.GPU.PhysicalGPU.GetPhysicalGPUs();
                        _logger.LogInformation($"NvAPI detected {physicalGpus.Length} physical GPUs.");
                        foreach (var gpu in physicalGpus)
                        {
                            _logger.LogInformation($"GPU: {gpu.FullName} (ID: {gpu.GPUId})");
                            var coolers = gpu.CoolerInformation.Coolers;
                            if (coolers != null)
                            {
                                _logger.LogInformation($"  - Found {coolers.Count()} coolers.");
                                foreach (var cooler in coolers)
                                {
                                    _logger.LogInformation($"    - Cooler ID: {cooler.CoolerId}, Current Level: {cooler.CurrentLevel}%");
                                }
                            }
                            else
                            {
                                _logger.LogWarning($"  - No coolers found for {gpu.FullName}");
                            }
                        }
                    }
                    catch (Exception ex)
                    {
                         _logger.LogError(ex, "Error listing NvAPI devices");
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Failed to initialize NvAPI. NVIDIA GPU fan control may not work.");
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to open Hardware Monitor");
            }
        }

        public void Update()
        {
            lock (_lock)
            {
                foreach (var hardware in _computer.Hardware)
                {
                    hardware.Update();
                }
            }
        }

        public List<SensorData> GetSensors()
        {
            var sensors = new List<SensorData>();
            lock (_lock)
            {
                foreach (var hardware in _computer.Hardware)
                {
                    foreach (var sensor in hardware.Sensors)
                    {
                        if (sensor.SensorType == SensorType.Temperature)
                        {
                            sensors.Add(new SensorData
                            {
                                Id = GenerateId(hardware, sensor),
                                Name = $"{hardware.Name} {sensor.Name}",
                                Temperature = sensor.Value ?? 0,
                                Type = MapSensorType(hardware.HardwareType),
                                Chip = hardware.Name,
                                Source = "LHM"
                            });
                        }
                    }
                }
            }
            // Update internal cache for SetFanSpeed lookup
            _sensors.Clear();
            _sensors.AddRange(sensors);
            
            return sensors;
        }

        public List<FanData> GetFans()
        {
            var fans = new List<FanData>();
            lock (_lock)
            {
                foreach (var hardware in _computer.Hardware)
                {
                    var fanSensors = hardware.Sensors.Where(s => s.SensorType == SensorType.Fan).ToList();
                    var controlSensors = hardware.Sensors.Where(s => s.SensorType == SensorType.Control).ToList();

                    for (int i = 0; i < fanSensors.Count; i++)
                    {
                        var sensor = fanSensors[i];
                        
                        // Try to find corresponding control sensor
                        var controlSensor = controlSensors.FirstOrDefault(s => 
                            s.Name.Contains(sensor.Name.Replace("Fan", "").Trim()));

                        if (controlSensor == null && i < controlSensors.Count)
                        {
                            controlSensor = controlSensors[i];
                        }

                        if (controlSensor == null && controlSensors.Count == 1)
                        {
                            controlSensor = controlSensors[0];
                        }

                        fans.Add(new FanData
                        {
                            Id = GenerateId(hardware, sensor),
                            Name = $"{hardware.Name} {sensor.Name}",
                            Rpm = (int)(sensor.Value ?? 0),
                            Speed = controlSensor != null ? (int)(controlSensor.Value ?? 0) : 0,
                            TargetSpeed = controlSensor != null ? (int)(controlSensor.Value ?? 0) : 0,
                            Status = (sensor.Value ?? 0) > 0 ? "ok" : "stopped",
                            HasPwmControl = controlSensor != null || hardware.HardwareType == HardwareType.GpuNvidia
                        });
                    }
                }
            }
            return fans;
        }

        public SystemHealth GetSystemHealth()
        {
            double cpuLoad = 0;
            double memoryLoad = 0;

            lock (_lock)
            {
                foreach (var hardware in _computer.Hardware)
                {
                    if (hardware.HardwareType == HardwareType.Cpu)
                    {
                        var loadSensor = hardware.Sensors.FirstOrDefault(s => s.SensorType == SensorType.Load && s.Name == "CPU Total");
                        if (loadSensor != null) cpuLoad = loadSensor.Value ?? 0;
                    }
                    if (hardware.HardwareType == HardwareType.Memory)
                    {
                        var loadSensor = hardware.Sensors.FirstOrDefault(s => s.SensorType == SensorType.Load && s.Name == "Memory");
                        if (loadSensor != null) memoryLoad = loadSensor.Value ?? 0;
                    }
                }
            }

            return new SystemHealth
            {
                CpuUsage = cpuLoad,
                MemoryUsage = memoryLoad,
                AgentUptime = (DateTime.Now - System.Diagnostics.Process.GetCurrentProcess().StartTime).TotalSeconds
            };
        }

        public bool SetFanSpeed(string fanId, int speed)
        {
            if (speed < 0) speed = 0;
            if (speed > 100) speed = 100;

            lock (_lock)
            {
                foreach (var hardware in _computer.Hardware)
                {
                    bool isNvidiaGpu = hardware.HardwareType == HardwareType.GpuNvidia;

                    foreach (var sensor in hardware.Sensors)
                    {
                        if (sensor.SensorType == SensorType.Fan && GenerateId(hardware, sensor) == fanId)
                        {
                            // HYBRID CONTROL LOGIC
                            if (isNvidiaGpu)
                            {
                                try 
                                {
                                    // Use NvAPI for NVIDIA GPUs
                                    var physicalGpus = NvAPIWrapper.GPU.PhysicalGPU.GetPhysicalGPUs();
                                    if (physicalGpus.Any())
                                    {
                                        foreach (var gpu in physicalGpus)
                                        {
                                            // Simple matching: if hardware name contains GPU name or vice versa
                                            if (hardware.Name.Contains(gpu.FullName) || gpu.FullName.Contains(hardware.Name) || physicalGpus.Count() == 1)
                                            {
                                                var coolerInfo = gpu.CoolerInformation;
                                                if (coolerInfo.Coolers != null)
                                                {
                                                    foreach (var cooler in coolerInfo.Coolers)
                                                    {
                                                        // Set speed on all coolers for this GPU
                                                        gpu.CoolerInformation.SetCoolerSettings(cooler.CoolerId, speed);
                                                    }
                                                    _logger.LogInformation($"Set GPU fan speed via NvAPI: {speed}%");
                                                    return true;
                                                }
                                            }
                                        }
                                    }
                                }
                                catch (Exception ex)
                                {
                                    _logger.LogError(ex, "Failed to set GPU fan speed via NvAPI");
                                }
                            }

                            // Fallback to LHM Control
                            var controlSensors = hardware.Sensors.Where(s => s.SensorType == SensorType.Control).ToList();
                            foreach (var control in controlSensors)
                            {
                                try 
                                {
                                    control.Control.SetSoftware(speed);
                                    hardware.Update();
                                    _logger.LogInformation($"Set fan {fanId} to {speed}% via LHM {control.Name}");
                                    return true;
                                }
                                catch (Exception ex)
                                {
                                    _logger.LogError(ex, $"Failed to set fan speed for {fanId}");
                                }
                            }
                        }
                    }
                }
            }
            return false;
        }

        private string GenerateId(IHardware hardware, ISensor sensor)
        {
            return $"{hardware.Identifier}_{sensor.Identifier}".Replace("/", "_").Replace("\\", "_").Replace(":", "");
        }

        private string MapSensorType(HardwareType type)
        {
            return type switch
            {
                HardwareType.Cpu => "cpu",
                HardwareType.GpuNvidia => "gpu",
                HardwareType.GpuAmd => "gpu",
                HardwareType.GpuIntel => "gpu",
                HardwareType.Memory => "memory",
                HardwareType.Storage => "storage",
                HardwareType.Motherboard => "motherboard",
                _ => "other"
            };
        }

        public void Dispose()
        {
            _computer.Close();
        }
    }

    public class SensorData
    {
        public string Id { get; set; } = "";
        public string Name { get; set; } = "";
        public float Temperature { get; set; }
        public string Type { get; set; } = "";
        public string Chip { get; set; } = "";
        public string Source { get; set; } = "";
    }

    public class FanData
    {
        public string Id { get; set; } = "";
        public string Name { get; set; } = "";
        public int Rpm { get; set; }
        public int Speed { get; set; }
        public int TargetSpeed { get; set; }
        public string Status { get; set; } = "";
        public bool HasPwmControl { get; set; }
    }

    public class SystemHealth
    {
        public double CpuUsage { get; set; }
        public double MemoryUsage { get; set; }
        public double AgentUptime { get; set; }
    }
}

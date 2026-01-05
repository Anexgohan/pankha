using NvAPIWrapper;
using NvAPIWrapper.GPU;
using Serilog;

namespace Pankha.WindowsAgent.Hardware;

/// <summary>
/// NVIDIA GPU fan control using NvAPIWrapper High-Level API
/// </summary>
public class NvidiaGpuController : IDisposable
{
    private readonly ILogger _logger;
    private readonly Dictionary<string, PhysicalGPU> _gpuCache = new();
    private bool _initialized = false;

    public NvidiaGpuController(ILogger logger)
    {
        _logger = logger;
        InitializeNvAPI();
    }

    private void InitializeNvAPI()
    {
        try
        {
            NVIDIA.Initialize();
            _logger.Information("NvAPI initialized successfully");
            _initialized = true;

            // Cache all NVIDIA GPUs
            var gpus = PhysicalGPU.GetPhysicalGPUs();
            _logger.Information("Found {Count} NVIDIA GPU(s)", gpus.Length);

            for (int i = 0; i < gpus.Length; i++)
            {
                var gpu = gpus[i];
                var gpuId = $"nvidia_gpu_{i}";
                _gpuCache[gpuId] = gpu;
                _logger.Information("NVIDIA GPU {Index}: {Name} (Bus ID: {BusId})",
                    i, gpu.FullName, gpu.BusInformation.BusId);
            }
        }
        catch (Exception ex)
        {
            _logger.Warning(ex, "Failed to initialize NvAPI (no NVIDIA GPU or driver not available)");
            _initialized = false;
        }
    }

    public bool IsAvailable => _initialized && _gpuCache.Count > 0;

    public bool CanControlFan(string fanId)
    {
        if (!IsAvailable) return false;

        // Check if this is an NVIDIA GPU fan
        return fanId.Contains("nvidia", StringComparison.OrdinalIgnoreCase) ||
               fanId.Contains("gpunvidia", StringComparison.OrdinalIgnoreCase);
    }

    public async Task<bool> SetFanSpeedAsync(string fanId, int speedPercent)
    {
        if (!IsAvailable) return false;

        return await Task.Run(() =>
        {
            try
            {
                // Find the GPU for this fan
                var gpu = FindGpuForFan(fanId);
                if (gpu == null)
                {
                    _logger.Warning("GPU not found for fan: {FanId}", fanId);
                    return false;
                }

                // Get cooler information
                var coolerInfo = gpu.CoolerInformation;
                if (coolerInfo == null)
                {
                    _logger.Warning("No cooler information available for GPU: {GPU}", gpu.FullName);
                    return false;
                }

                var coolers = coolerInfo.Coolers?.ToArray();
                if (coolers == null || coolers.Length == 0)
                {
                    _logger.Warning("No coolers found for GPU: {GPU}", gpu.FullName);
                    return false;
                }

                _logger.Debug("GPU has {Count} cooler(s)", coolers.Length);

                // Direct call to SetCoolerSettings - method is public in NvAPIWrapper.Net 0.8.1.101
                bool success = false;
                foreach (var cooler in coolers)
                {
                    try
                    {
                        // Direct call - no reflection needed!
                        coolerInfo.SetCoolerSettings(
                            cooler.CoolerId,
                            NvAPIWrapper.Native.GPU.CoolerPolicy.Manual,
                            speedPercent
                        );

                        _logger.Debug("Set cooler {Id} to {Speed}% with Manual policy",
                            cooler.CoolerId, speedPercent);
                        success = true;
                    }
                    catch (Exception ex)
                    {
                        _logger.Warning(ex, "Failed to set cooler {Id}", cooler.CoolerId);
                    }
                }

                if (success)
                {
                    _logger.Debug("Set NVIDIA GPU fan to {Speed}% for {GPU}", speedPercent, gpu.FullName);
                    return true;
                }

                _logger.Error("Failed to set any GPU fan speeds");
                return false;
            }
            catch (Exception ex)
            {
                _logger.Error(ex, "Failed to set NVIDIA GPU fan speed for {FanId}", fanId);
                return false;
            }
        });
    }

    public async Task<bool> ResetToAutoAsync(string fanId)
    {
        if (!IsAvailable) return false;

        return await Task.Run(() =>
        {
            try
            {
                var gpu = FindGpuForFan(fanId);
                if (gpu == null) return false;

                var coolerInfo = gpu.CoolerInformation;
                if (coolerInfo == null ||  coolerInfo.Coolers == null || !coolerInfo.Coolers.Any())
                    return false;

                // Restore default control with direct call
                bool success = false;
                foreach (var cooler in coolerInfo.Coolers)
                {
                    try
                    {
                        // Direct call - reset to automatic fan control
                        // Note: CoolerPolicy.None (value 0) = automatic control mode
                        coolerInfo.SetCoolerSettings(
                            cooler.CoolerId,
                            NvAPIWrapper.Native.GPU.CoolerPolicy.None,
                            0
                        );

                        _logger.Debug("Reset cooler {Id} to auto policy", cooler.CoolerId);
                        success = true;
                    }
                    catch (Exception ex)
                    {
                        _logger.Warning(ex, "Failed to reset cooler {Id}", cooler.CoolerId);
                    }
                }

                if (success)
                {
                    _logger.Debug("Reset NVIDIA GPU fan to auto for {GPU}", gpu.FullName);
                    return true;
                }

                return false;
            }
            catch (Exception ex)
            {
                _logger.Error(ex, "Failed to reset NVIDIA GPU fan to auto");
                return false;
            }
        });
    }

    private PhysicalGPU? FindGpuForFan(string fanId)
    {
        // Try direct lookup first
        if (_gpuCache.TryGetValue(fanId, out var gpu))
        {
            return gpu;
        }

        // Parse GPU index from fan ID for multi-GPU systems
        // Expected format: "gpunvidia_fan_gpu_fan__gpu-nvidia_0_fan_1"
        // Extract the GPU index (e.g., "0" from "_gpu-nvidia_0_")
        var match = System.Text.RegularExpressions.Regex.Match(fanId, @"nvidia[_-](\d+)");
        if (match.Success && int.TryParse(match.Groups[1].Value, out var gpuIndex))
        {
            var gpuKey = $"nvidia_gpu_{gpuIndex}";
            if (_gpuCache.TryGetValue(gpuKey, out var matchedGpu))
            {
                _logger.Debug("Matched GPU index {Index} for fan {FanId}", gpuIndex, fanId);
                return matchedGpu;
            }
        }

        // Fallback: return first GPU (most systems have one NVIDIA GPU)
        _logger.Debug("Could not determine specific GPU for {FanId}, using first GPU", fanId);
        return _gpuCache.Values.FirstOrDefault();
    }

    public void Dispose()
    {
        if (!IsAvailable) return;

        try
        {
            // Reset all GPUs to auto before disposing
            foreach (var (gpuId, gpu) in _gpuCache)
            {
                try
                {
                    ResetToAutoAsync(gpuId).Wait();
                    _logger.Debug("Reset GPU {Id} to auto on dispose", gpuId);
                }
                catch (Exception ex)
                {
                    _logger.Warning(ex, "Error resetting GPU {Id} on dispose", gpuId);
                }
            }

            _gpuCache.Clear();
            _logger.Information("NvidiaGpuController disposed");
        }
        catch (Exception ex)
        {
            _logger.Error(ex, "Error disposing NvidiaGpuController");
        }
    }
}

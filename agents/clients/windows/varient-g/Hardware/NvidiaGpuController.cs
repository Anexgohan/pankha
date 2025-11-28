using NvAPIWrapper;
using NvAPIWrapper.GPU;
using Microsoft.Extensions.Logging;

namespace Pankha.WindowsAgent.Hardware;

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
            _logger.LogInformation("NvAPI initialized successfully");
            _initialized = true;

            var gpus = PhysicalGPU.GetPhysicalGPUs();
            _logger.LogInformation("Found {Count} NVIDIA GPU(s)", gpus.Length);

            for (int i = 0; i < gpus.Length; i++)
            {
                var gpu = gpus[i];
                var gpuId = $"nvidia_gpu_{i}";
                _gpuCache[gpuId] = gpu;
                _logger.LogInformation("NVIDIA GPU {Index}: {Name} (Bus ID: {BusId})",
                    i, gpu.FullName, gpu.BusInformation.BusId);
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to initialize NvAPI (no NVIDIA GPU or driver not available)");
            _initialized = false;
        }
    }

    public bool IsAvailable => _initialized && _gpuCache.Count > 0;

    public bool CanControlFan(string fanId)
    {
        if (!IsAvailable) return false;
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
                var gpu = FindGpuForFan(fanId);
                if (gpu == null)
                {
                    _logger.LogWarning("GPU not found for fan: {FanId}", fanId);
                    return false;
                }

                var coolerInfo = gpu.CoolerInformation;
                if (coolerInfo == null || coolerInfo.Coolers == null || !coolerInfo.Coolers.Any())
                {
                    _logger.LogWarning("No cooler information available for GPU: {GPU}", gpu.FullName);
                    return false;
                }

                bool success = false;
                foreach (var cooler in coolerInfo.Coolers)
                {
                    try
                    {
                        // Direct call using the Manager object (CoolerInformation)
                        coolerInfo.SetCoolerSettings(
                            cooler.CoolerId,
                            NvAPIWrapper.Native.GPU.CoolerPolicy.Manual,
                            speedPercent
                        );
                        _logger.LogDebug("Set cooler {Id} to {Speed}%", cooler.CoolerId, speedPercent);
                        success = true;
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex, "Failed to set cooler {Id}", cooler.CoolerId);
                    }
                }

                if (success)
                {
                    _logger.LogInformation("Set NVIDIA GPU fan to {Speed}% for {GPU}", speedPercent, gpu.FullName);
                    return true;
                }
                return false;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to set NVIDIA GPU fan speed for {FanId}", fanId);
                return false;
            }
        });
    }

    private PhysicalGPU? FindGpuForFan(string fanId)
    {
        // Simple heuristic: return first GPU. 
        // In a multi-GPU setup, we'd need to parse the ID more carefully.
        return _gpuCache.Values.FirstOrDefault();
    }

    public void Dispose()
    {
        // Optional: Reset fans to auto on exit?
        // For now, we leave them as is to avoid sudden noise changes on service restart.
    }
}

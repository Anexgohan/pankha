# Next Steps: NVIDIA GPU Fan Control Implementation

**Date**: 2025-11-24
**Current Status**: Commands working, LibreHardwareMonitor upgraded to 0.9.4 (PawnIO)
**Blocking Issue**: LibreHardwareMonitor cannot control NVIDIA GPU fans

---

## ✅ What's Working Now

1. **Build**: Successful with LibreHardwareMonitor 0.9.4 (PawnIO driver)
2. **Hardware Discovery**: 7 sensors + 1 NVIDIA GPU fan detected
3. **WebSocket**: Connected and streaming data every 1-3 seconds
4. **Commands**: Received and executed successfully
5. **Safety**: Minimum 30% speed enforcement working
6. **Motherboard Support**: PawnIO driver ready for production systems

---

## ❌ Current Limitation

**NVIDIA GPU Fan Control**: LibreHardwareMonitor's `Control.SetSoftware()` is called successfully, but NVIDIA driver **silently ignores** the control attempts. Commands complete without errors, but GPU fan speed doesn't change.

**Log Evidence**:
```
[INF] Executing command: setFanSpeed (ID: 337bc2c3-eddb-479f-bf6b-e48581117cad)
[INF] Setting fan gpunvidia_fan_gpu_fan_81F42781 to 40%
[INF] Set fan gpunvidia_fan_gpu_fan_81F42781 to 40%
[INF] Command 337bc2c3-eddb-479f-bf6b-e48581117cad completed: True
# Fan RPM stays at ~3046, doesn't change
```

---

## 🔧 Solution: NvAPIWrapper Integration

### Overview

[NvAPIWrapper](https://github.com/falahati/NvAPIWrapper) is an open-source (MIT license) C# wrapper for NVIDIA's official GPU API. It provides direct access to NVIDIA GPU fan control that bypasses the driver restrictions.

### Implementation Plan

#### Step 1: Add NvAPIWrapper NuGet Package

```xml
<!-- In Pankha.WindowsAgent.csproj -->
<PackageReference Include="NvAPIWrapper.Net" Version="0.8.1" />
```

#### Step 2: Create NvidiaGpuController.cs

Create a new file: `Hardware/NvidiaGpuController.cs`

```csharp
using NvAPIWrapper;
using NvAPIWrapper.GPU;
using NvAPIWrapper.Native.GPU;
using Serilog;

namespace Pankha.WindowsAgent.Hardware;

/// <summary>
/// NVIDIA GPU fan control using NvAPIWrapper
/// </summary>
public class NvidiaGpuController
{
    private readonly ILogger _logger;
    private readonly Dictionary<string, PhysicalGPU> _gpuCache = new();

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

            // Cache all NVIDIA GPUs
            var gpus = PhysicalGPU.GetPhysicalGPUs();
            foreach (var gpu in gpus)
            {
                var gpuId = $"nvidia_gpu_{gpu.BusId}";
                _gpuCache[gpuId] = gpu;
                _logger.Information("NVIDIA GPU found: {Name} (Bus ID: {BusId})",
                    gpu.FullName, gpu.BusId);
            }
        }
        catch (Exception ex)
        {
            _logger.Error(ex, "Failed to initialize NvAPI");
            throw;
        }
    }

    public bool CanControlFan(string fanId)
    {
        // Check if this is an NVIDIA GPU fan
        return fanId.Contains("nvidia", StringComparison.OrdinalIgnoreIgnoreCase) ||
               fanId.Contains("gpunvidia", StringComparison.OrdinalIgnoreCase);
    }

    public async Task<bool> SetFanSpeedAsync(string fanId, int speedPercent)
    {
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

                // Get cooler settings
                var coolerSettings = gpu.CoolerInformation;
                if (coolerSettings.Coolers.Length == 0)
                {
                    _logger.Warning("No coolers found for GPU: {GPU}", gpu.FullName);
                    return false;
                }

                // Set fan speed for all coolers
                var newLevels = new PrivateCoolerLevelsV1[coolerSettings.Coolers.Length];
                for (int i = 0; i < coolerSettings.Coolers.Length; i++)
                {
                    newLevels[i] = new PrivateCoolerLevelsV1
                    {
                        Level = speedPercent,
                        Policy = (int)CoolerPolicy.Manual
                    };
                }

                gpu.SetCoolerLevels(newLevels);
                _logger.Information("Set NVIDIA GPU fan to {Speed}% for {GPU}",
                    speedPercent, gpu.FullName);

                return true;
            }
            catch (Exception ex)
            {
                _logger.Error(ex, "Failed to set NVIDIA GPU fan speed");
                return false;
            }
        });
    }

    public async Task<bool> ResetToAutoAsync(string fanId)
    {
        return await Task.Run(() =>
        {
            try
            {
                var gpu = FindGpuForFan(fanId);
                if (gpu == null) return false;

                // Reset to automatic control
                var coolerSettings = gpu.CoolerInformation;
                var newLevels = new PrivateCoolerLevelsV1[coolerSettings.Coolers.Length];
                for (int i = 0; i < coolerSettings.Coolers.Length; i++)
                {
                    newLevels[i] = new PrivateCoolerLevelsV1
                    {
                        Level = 0,
                        Policy = (int)CoolerPolicy.Auto
                    };
                }

                gpu.SetCoolerLevels(newLevels);
                _logger.Information("Reset NVIDIA GPU fan to auto for {GPU}", gpu.FullName);

                return true;
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

        // Fallback: return first GPU (most systems have one NVIDIA GPU)
        return _gpuCache.Values.FirstOrDefault();
    }

    public void Dispose()
    {
        try
        {
            // Reset all GPUs to auto before disposing
            foreach (var gpu in _gpuCache.Values)
            {
                try
                {
                    var coolerSettings = gpu.CoolerInformation;
                    var newLevels = new PrivateCoolerLevelsV1[coolerSettings.Coolers.Length];
                    for (int i = 0; i < coolerSettings.Coolers.Length; i++)
                    {
                        newLevels[i] = new PrivateCoolerLevelsV1
                        {
                            Level = 0,
                            Policy = (int)CoolerPolicy.Auto
                        };
                    }
                    gpu.SetCoolerLevels(newLevels);
                }
                catch { /* Ignore errors during cleanup */ }
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

public enum CoolerPolicy
{
    None = 0,
    Manual = 1,
    Auto = 2
}
```

#### Step 3: Update LibreHardwareAdapter.cs

Modify `SetFanSpeedAsync` to use NvidiaGpuController for NVIDIA fans:

```csharp
private readonly NvidiaGpuController? _nvidiaController;

public LibreHardwareAdapter(HardwareSettings settings, MonitoringSettings monitoringSettings, ILogger logger)
{
    _settings = settings;
    _monitoringSettings = monitoringSettings;
    _logger = logger;
    _startTime = DateTime.UtcNow;

    // Initialize LibreHardwareMonitor
    _computer = new Computer { /* ... */ };
    _computer.Open();
    _logger.Information("LibreHardwareMonitor initialized successfully");

    // Initialize NVIDIA GPU controller if NVIDIA GPUs present
    try
    {
        _nvidiaController = new NvidiaGpuController(logger);
    }
    catch (Exception ex)
    {
        _logger.Warning(ex, "NvidiaGpuController initialization failed (no NVIDIA GPUs or NvAPI not available)");
        _nvidiaController = null;
    }
}

public async Task SetFanSpeedAsync(string fanId, int speed)
{
    // ... existing validation code ...

    // Check if this is an NVIDIA GPU fan
    if (_nvidiaController?.CanControlFan(fanId) == true)
    {
        _logger.Debug("Using NvidiaGpuController for fan {FanId}", fanId);
        var success = await _nvidiaController.SetFanSpeedAsync(fanId, speed);
        if (success)
        {
            fan.LastPwmValue = speed;
            fan.LastWriteTime = DateTime.UtcNow;
            _logger.Information("Set NVIDIA GPU fan {FanId} to {Speed}%", fanId, speed);
        }
        else
        {
            _logger.Warning("Failed to set NVIDIA GPU fan {FanId}", fanId);
        }
        return;
    }

    // Fallback to LibreHardwareMonitor for non-NVIDIA fans
    await Task.Run(() =>
    {
        // ... existing LibreHardwareMonitor control code ...
    });
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
        _logger.Error(ex, "Error disposing LibreHardwareAdapter");
    }
}
```

---

## 📋 Testing Checklist

After implementation:

### Test 1: Build & Initialize
- [ ] Project builds successfully with NvAPIWrapper
- [ ] NvAPI initializes without errors
- [ ] NVIDIA GPU detected and cached
- [ ] Logs show "NvAPI initialized successfully"

### Test 2: Fan Control
- [ ] Set fan to 30% (minimum) - should work
- [ ] Set fan to 50% - should work
- [ ] Set fan to 75% - should work
- [ ] Set fan to 100% - should work
- [ ] Verify fan RPM changes in response
- [ ] Check GPU temperature doesn't spike

### Test 3: Safety Features
- [ ] Try to set below 30% - should clamp to 30%
- [ ] Emergency stop - should go to 100%
- [ ] Agent shutdown - should reset to auto
- [ ] Verify fan doesn't stop completely

### Test 4: Motherboard Fans (when available)
- [ ] Verify LibreHardwareMonitor still works for non-NVIDIA fans
- [ ] Test IT8628/NCT6xxx motherboard fans
- [ ] Verify PawnIO driver loaded correctly
- [ ] Check mixed control (NVIDIA + motherboard fans)

---

## 🚨 Known Limitations (NVIDIA Hardware)

According to [FanControl Wiki](https://github.com/Rem0o/FanControl.Releases/wiki/Nvidia-30%25-and-0-RPM):

1. **30% Minimum**: Newer NVIDIA GPUs won't allow manual fan speed below 30%
2. **0 RPM Mode**: Only available when GPU is in automatic control mode
3. **Workaround**: Release control (set to auto) when user requests 0%

### Implementation Notes

- **Minimum Speed**: Already enforced by our safety code (30%)
- **0 RPM**: Could implement by calling `ResetToAutoAsync()` when speed = 0
- **Multiple Fans**: Some GPUs have 2+ fans, NvAPI controls them together

---

## 📚 References

- **NvAPIWrapper GitHub**: https://github.com/falahati/NvAPIWrapper
- **NvAPIWrapper NuGet**: https://www.nuget.org/packages/NvAPIWrapper.Net/
- **FanControl Source**: Uses NvAPIWrapper for NVIDIA control
- **NVIDIA GPU Limitations**: https://github.com/Rem0o/FanControl.Releases/wiki/Nvidia-30%25-and-0-RPM

---

## 🎯 Expected Outcome

After implementation:
- ✅ NVIDIA GPU fans controllable (30-100%)
- ✅ Motherboard fans controllable (PawnIO driver)
- ✅ Mixed hardware fully supported
- ✅ Production-ready Windows agent

---

## 💡 Alternative: Document Limitation

If NvAPIWrapper integration is delayed, we should:

1. **Update documentation**: Clearly state NVIDIA GPU fans not yet supported
2. **Add detection**: Log warning when NVIDIA GPU fan detected
3. **Frontend note**: Display message that NVIDIA control requires NvAPIWrapper
4. **Focus testing**: Test on systems with motherboard fans (main use case)

This is acceptable because:
- Most users will have **motherboard/chassis fans** (primary use case)
- NVIDIA users can use MSI Afterburner/EVGA Precision as temporary workaround
- GPU automatic fan control usually works well anyway
- We can add NvAPIWrapper in a future update

---

**Recommendation**: Implement NvAPIWrapper now (estimated 2-4 hours) since:
1. Library is open-source and well-maintained
2. Implementation is straightforward (shown above)
3. Provides complete NVIDIA GPU support
4. Makes Windows agent feature-complete for all hardware

---

**Status**: Ready for implementation
**Priority**: High (blocks NVIDIA GPU fan control)
**Effort**: Medium (2-4 hours)
**Risk**: Low (NvAPIWrapper is battle-tested in FanControl)

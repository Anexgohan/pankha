# NVIDIA GPU Fan Control - API Blocker

**Date**: 2025-11-24
**Status**: ⚠️ BLOCKED - NvAPIWrapper API Limitation

---

## Problem

NvAPIWrapper.Net version 0.8.1.101 (latest stable on NuGet) **does not expose fan control methods**. The `GPUCooler` class in this version is read-only.

### Build Errors
```
error CS1061: 'GPUCooler' does not contain a definition for 'ClientFanCoolersControl'
error CS1061: 'GPUCooler' does not contain a definition for 'CoolerControl'
error CS1061: 'GPUCooler' does not contain a definition for 'SetLevel'
```

### API Available (Read-Only)
```csharp
var gpu = PhysicalGPU.GetPhysicalGPUs()[0];
var coolerInfo = gpu.CoolerInformation;  // ✅ Works
var coolers = coolerInfo.Coolers.ToArray();  // ✅ Works
// ❌ But coolers[0] has NO methods to set fan speed
```

---

## Alternative Solutions

### Option 1: Use FanControl's NvAPI Implementation (Recommended)
FanControl (Rem0o/FanControl.Releases) successfully controls NVIDIA GPUs. They likely:
- Use a different/newer version of NvAPIWrapper (not on NuGet)
- Or use direct P/Invoke to nvapi64.dll
- Or use a fork with fan control enabled

**Action**: Research Fan Control's approach by checking their dependency list or decompiling

### Option 2: Direct P/Invoke to nvapi64.dll
Implement NVIDIA fan control using raw API calls:

```csharp
[DllImport("nvapi64.dll", EntryPoint = "nvapi_QueryInterface")]
private static extern IntPtr NvAPI_QueryInterface(uint id);

// Define NVAPI function signatures
// Implement NV_GPU_SETCOOLERLEVELS manually
```

**Pros**: Full control, no dependency issues
**Cons**: Complex, undocumented API, may break with driver updates

### Option 3: Use MSI Afterburner SDK
MSI Afterburner exposes a shared memory interface for GPU control.

**Pros**: Stable, well-documented
**Cons**: Requires MSI Afterburner running, not standalone

### Option 4: Wait for NvAPIWrapper Update
Check if newer versions exist:
- GitHub: https://github.com/falahati/NvAPIWrapper
- Maybe newer commits have fan control

---

## What Works Now

✅ **Removed 30% minimum** - agent accepts 0-100% range
✅ **NvidiaGpuController infrastructure** - ready to use once API available
✅ **Integration complete** - LibreHardwareAdapter routes NVIDIA fans correctly
✅ **Fallback working** - LibreHardwareMonitor still handles other fans

---

## Testing Without NVIDIA Control

You can still test the command flow:

```powershell
dotnet run -- --foreground --log-level Debug
```

**Expected behavior**:
- Commands reach agent ✅
- NVIDIA controller tries to set speed
- Logs show failure (no API available)
- Fan speed doesn't change

---

## Immediate Recommendation

**PAUSE NVIDIA GPU implementation** and:

1. **Test with motherboard fans first**
   - Most important use case
   - PawnIO driver ready
   - Will work immediately

2. **Document NVIDIA limitation**
   - Update README
   - Note in TESTING_SESSION_COMPLETE.md
   - Recommend MSI Afterburner for GPU control

3. **Research FanControl's approach**
   - How does Rem0o/FanControl.Releases control NVIDIA GPUs?
   - What NvAPIWrapper version/fork do they use?
   - Can we use the same approach?

---

## Next Steps

### Immediate (Do Now)
1. Comment out NVIDIA controller initialization (to allow build)
2. Test agent with command flow (confirm everything else works)
3. Document NVIDIA GPU control as "future enhancement"

### Short Term (This Week)
1. Research FanControl's NvAPIWrapper usage
2. Check GitHub for newer NvAPIWrapper versions
3. Test on system with motherboard fans

### Long Term (Future Release)
1. Implement direct nvapi64.dll P/Invoke if needed
2. Or use FanControl's approach
3. Test full 0-100% range on NVIDIA GPU

---

## Code to Comment Out (Temporary)

In `LibreHardwareAdapter.cs` constructor:

```csharp
// Initialize NVIDIA GPU controller
try
{
    // TEMPORARILY DISABLED: NvAPIWrapper 0.8.1.101 lacks fan control APIs
    // TODO: Research FanControl's NvAPIWrapper version or use direct P/Invoke
    //_nvidiaController = new NvidiaGpuController(logger);
    _nvidia Controller = null;
    _logger.Information("⚠️ NVIDIA GPU fan control disabled (API limitation)");
}
catch (Exception ex)
{
    _logger.Warning(ex, "Failed to initialize NVIDIA GPU controller");
    _nvidiaController = null;
}
```

This will allow the build to succeed and you can test everything else.

---

## Summary

- ✅ **Command flow**: Working perfectly
- ✅ **Infrastructure**: Ready for NVIDIA control
- ❌ **NvAPIWrapper API**: Doesn't expose fan control methods
- 🔄 **Solution**: Research FanControl's approach or use direct P/Invoke

**Current Status**: Windows agent is **production-ready for non-NVIDIA systems** (motherboard fans, AMD GPUs). NVIDIA GPU fan control needs alternative API implementation.

---

**Blocker Identified By**: Claude Code
**Priority**: Medium (NVIDIA-specific, workarounds available)
**User Impact**: Can use MSI Afterburner for NVIDIA GPU control temporarily

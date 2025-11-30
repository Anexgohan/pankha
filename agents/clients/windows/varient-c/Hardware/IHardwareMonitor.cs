using Pankha.WindowsAgent.Models;

namespace Pankha.WindowsAgent.Hardware;

/// <summary>
/// Hardware monitoring interface (matches Rust agent trait)
/// </summary>
public interface IHardwareMonitor : IDisposable
{
    /// <summary>
    /// Discover all available temperature sensors
    /// </summary>
    Task<List<Sensor>> DiscoverSensorsAsync();

    /// <summary>
    /// Discover all available fans
    /// </summary>
    Task<List<Fan>> DiscoverFansAsync();

    /// <summary>
    /// Get current system health metrics
    /// </summary>
    Task<SystemHealth> GetSystemHealthAsync();

    /// <summary>
    /// Set fan speed (0-100%)
    /// </summary>
    Task SetFanSpeedAsync(string fanId, int speed);

    /// <summary>
    /// Emergency stop - set all fans to 100%
    /// </summary>
    Task EmergencyStopAsync();

    /// <summary>
    /// Update hardware readings
    /// </summary>
    Task UpdateAsync();

    /// <summary>
    /// Reset all fans to automatic/default control
    /// </summary>
    Task ResetAllToAutoAsync();
}

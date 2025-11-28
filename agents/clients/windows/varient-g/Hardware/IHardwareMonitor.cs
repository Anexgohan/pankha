using Pankha.WindowsAgent.Models;

namespace Pankha.WindowsAgent.Hardware;

public interface IHardwareMonitor : IDisposable
{
    Task UpdateAsync();
    Task<List<Sensor>> DiscoverSensorsAsync();
    Task<List<Fan>> DiscoverFansAsync();
    Task<SystemHealth> GetSystemHealthAsync();
    Task SetFanSpeedAsync(string fanId, int speed);
    Task EmergencyStopAsync();
}

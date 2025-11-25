using Newtonsoft.Json;

namespace Pankha.WindowsAgent.Models;

/// <summary>
/// Represents system health metrics
/// </summary>
public class SystemHealth
{
    [JsonProperty("cpuUsage")]
    public double CpuUsage { get; set; }

    [JsonProperty("memoryUsage")]
    public double MemoryUsage { get; set; }

    [JsonProperty("agentUptime")]
    public double AgentUptime { get; set; }

    public SystemHealth()
    {
    }

    public SystemHealth(double cpuUsage, double memoryUsage, double agentUptime)
    {
        CpuUsage = cpuUsage;
        MemoryUsage = memoryUsage;
        AgentUptime = agentUptime;
    }
}

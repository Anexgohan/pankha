namespace Pankha.WindowsAgent.Models;

public class HardwareDumpRoot
{
    public HardwareDumpMetadata Metadata { get; set; } = new();
    public List<HardwareDumpItem> Hardware { get; set; } = new();
}

public class HardwareDumpMetadata
{
    public string AgentVersion { get; set; } = "";
    public string OSVersion { get; set; } = "";
    public bool IsElevated { get; set; }
    public DateTime Timestamp { get; set; } = DateTime.UtcNow;
    public string? Motherboard { get; set; }
}

public class HardwareDumpItem
{
    public string Name { get; set; } = "";
    public string Identifier { get; set; } = "";
    public string Type { get; set; } = "";
    public string? Parent { get; set; }  // Parent hardware identifier
    public string? TechnicalId { get; set; } // Raw chip ID or PCI ID (e.g. REV_01, 0x1234)
    public List<HardwareDumpSensor> Sensors { get; set; } = new();
    public List<HardwareDumpItem> SubHardware { get; set; } = new();
}

public class HardwareDumpSensor
{
    public string Name { get; set; } = "";
    public string Identifier { get; set; } = "";
    public string Type { get; set; } = "";
    public float? Value { get; set; }
    public string Min { get; set; } = "";
    public string Max { get; set; } = "";
    public bool IsMonitored { get; set; }
    
    /// <summary>
    /// Whether the sensor/header is actually plugged in or reporting (Open Circuit detection)
    /// </summary>
    public bool? IsConnected { get; set; }

    /// <summary>
    /// Control interface info. Populated for Fan and Control type sensors.
    /// null if sensor is read-only (e.g., Temperature sensors).
    /// </summary>
    public ControlInfo? Control { get; set; }
}

/// <summary>
/// Control interface details for fan/control sensors.
/// Used for diagnostics and debugging unknown hardware.
/// </summary>
public class ControlInfo
{
    /// <summary>
    /// For Fan sensors: the linked Control sensor identifier.
    /// For Control sensors: the linked Fan sensor identifier.
    /// null if no linked sensor found.
    /// </summary>
    public string? LinkedSensorId { get; set; }
    
    /// <summary>
    /// Control method: "NvAPI" (NVIDIA GPU), "SuperIO" (motherboard fans), "Unknown"
    /// </summary>
    public string Method { get; set; } = "Unknown";
    
    /// <summary>
    /// Whether this control can be written to (SetValue works)
    /// </summary>
    public bool CanWrite { get; set; }
    
    /// <summary>
    /// Whether this control supports restoring to default/auto mode.
    /// true for NVIDIA GPUs (can reset to driver control), false for SuperIO fans.
    /// </summary>
    public bool CanRestoreDefault { get; set; }
    
    /// <summary>
    /// Current control value as percentage (0-100)
    /// </summary>
    public float? CurrentPercent { get; set; }
    
    /// <summary>
    /// Valid range for control values [min, max]
    /// </summary>
    public int[] Range { get; set; } = [0, 100];

    /// <summary>
    /// Current control mode (e.g., Software, Default)
    /// </summary>
    public string? Mode { get; set; }
}

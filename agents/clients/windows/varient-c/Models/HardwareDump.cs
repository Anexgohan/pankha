namespace Pankha.WindowsAgent.Models;

public class HardwareDumpItem
{
    public string Name { get; set; } = "";
    public string Identifier { get; set; } = "";
    public string Type { get; set; } = "";
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
}

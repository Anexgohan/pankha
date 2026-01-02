using Newtonsoft.Json;

namespace Pankha.WindowsAgent.Models.Configuration;

/// <summary>
/// Logging configuration settings
/// Unified snake_case schema matching Linux agent
/// </summary>
public class LoggingSettings
{
    [JsonProperty("enable_file_logging")]
    public bool EnableFileLogging { get; set; } = true;

    [JsonProperty("log_file")]
    public string LogFile { get; set; } = "logs/agent.log";

    [JsonProperty("max_log_size_mb")]
    public int MaxLogSizeMb { get; set; } = 50;

    [JsonProperty("log_retention_days")]
    public int LogRetentionDays { get; set; } = 7;

    public void Validate()
    {
        if (MaxLogSizeMb < 1 || MaxLogSizeMb > 500)
        {
            throw new InvalidOperationException("Max log size must be between 1MB and 500MB");
        }

        if (LogRetentionDays < 1 || LogRetentionDays > 365)
        {
            throw new InvalidOperationException("Log retention days must be between 1 and 365");
        }
    }
}

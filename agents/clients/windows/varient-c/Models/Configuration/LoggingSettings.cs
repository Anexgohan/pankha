using Newtonsoft.Json;

namespace Pankha.WindowsAgent.Models.Configuration;

/// <summary>
/// Logging configuration settings
/// </summary>
public class LoggingSettings
{
    [JsonProperty("logLevel")]
    public string LogLevel { get; set; } = "INFO";

    [JsonProperty("logDirectory")]
    public string LogDirectory { get; set; } = "logs";

    [JsonProperty("maxLogFiles")]
    public int MaxLogFiles { get; set; } = 7;

    [JsonProperty("maxLogFileSizeMB")]
    public int MaxLogFileSizeMB { get; set; } = 50;

    public void Validate()
    {
        // Must match Rust agent: TRACE, DEBUG, INFO, WARN, ERROR, CRITICAL
        var validLevels = new[] { "TRACE", "DEBUG", "INFO", "WARN", "ERROR", "CRITICAL" };
        if (!validLevels.Contains(LogLevel.ToUpperInvariant()))
        {
            throw new InvalidOperationException($"Log level must be one of: {string.Join(", ", validLevels)}");
        }

        if (MaxLogFiles < 1 || MaxLogFiles > 30)
        {
            throw new InvalidOperationException("Max log files must be between 1 and 30");
        }

        if (MaxLogFileSizeMB < 1 || MaxLogFileSizeMB > 500)
        {
            throw new InvalidOperationException("Max log file size must be between 1MB and 500MB");
        }
    }
}

using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using System.IO;
using System;

namespace Pankha.WindowsAgent.Models.Configuration;

/// <summary>
/// Root configuration object for the agent
/// Unified snake_case schema matching Linux agent
/// </summary>
public class AgentConfig
{
    [JsonProperty("agent")]
    public AgentSettings Agent { get; set; } = new();

    [JsonProperty("backend")]
    public BackendSettings Backend { get; set; } = new();

    [JsonProperty("hardware")]
    public HardwareSettings Hardware { get; set; } = new();

    [JsonProperty("logging")]
    public LoggingSettings Logging { get; set; } = new();

    /// <summary>
    /// Load configuration from file
    /// </summary>
    public static AgentConfig LoadFromFile(string path)
    {
        if (!File.Exists(path))
        {
            throw new FileNotFoundException($"Configuration file not found: {path}");
        }

        // Migrate config first (handles old configs automatically)
        MigrateConfig(path);

        var json = File.ReadAllText(path);
        var config = JsonConvert.DeserializeObject<AgentConfig>(json);

        if (config == null)
        {
            throw new InvalidOperationException("Failed to deserialize configuration");
        }

        return config;
    }

    /// <summary>
    /// Migrate config to current version (removes deprecated, adds new fields, renames for unified schema)
    /// Phase 3+4: Config Migration - handles old configs automatically
    /// </summary>
    public static void MigrateConfig(string configPath)
    {
        if (!File.Exists(configPath)) return;
        
        try
        {
            var content = File.ReadAllText(configPath);
            var json = JObject.Parse(content);
            var migrated = false;
            
            // === PHASE 3: REMOVALS ===
            if (json["monitoring"] is JObject monitoring)
            {
                // Move fan_step and hysteresis to hardware before removing monitoring
                if (json["hardware"] is JObject hw)
                {
                    if (monitoring["fanStepPercent"] != null && hw["fan_step_percent"] == null)
                    {
                        hw["fan_step_percent"] = monitoring["fanStepPercent"];
                        migrated = true;
                    }
                    if (monitoring["hysteresisTemp"] != null && hw["hysteresis_temp"] == null)
                    {
                        hw["hysteresis_temp"] = monitoring["hysteresisTemp"];
                        migrated = true;
                    }
                }
                
                // Remove entire monitoring section (it's deprecated)
                json.Remove("monitoring");
                migrated = true;
            }
            
            // === PHASE 4: RENAMES (camelCase to snake_case) ===
            if (json["agent"] is JObject agent)
            {
                if (RenameField(agent, "agentId", "id")) migrated = true;
                if (RenameField(agent, "hostname", "name") && agent["name"] == null) migrated = true; // Only if name not set
            }
            
            if (json["backend"] is JObject backend)
            {
                if (RenameField(backend, "url", "server_url")) migrated = true;
                if (RenameField(backend, "reconnectInterval", "reconnect_interval")) migrated = true;
                if (RenameField(backend, "maxReconnectAttempts", "max_reconnect_attempts")) migrated = true;
                
                // Convert ms to seconds if needed (old config used ms)
                if (backend["reconnect_interval"] != null)
                {
                    var val = backend["reconnect_interval"]!.Value<double>();
                    if (val > 100) // Likely ms, convert to seconds
                    {
                        backend["reconnect_interval"] = val / 1000.0;
                        migrated = true;
                    }
                }
                
                // Add connection_timeout if missing
                if (backend["connection_timeout"] == null)
                {
                    backend["connection_timeout"] = 10.0;
                    migrated = true;
                }
            }
            
            if (json["hardware"] is JObject hardware)
            {
                // Remove old fields
                if (hardware.Remove("minFanSpeed")) { migrated = true; }
                if (hardware.Remove("updateInterval")) { migrated = true; } // Moved to agent section
                
                // Rename camelCase to snake_case
                if (RenameField(hardware, "enableFanControl", "enable_fan_control")) migrated = true;
                if (RenameField(hardware, "emergencyTemperature", "emergency_temp")) migrated = true;
                if (RenameField(hardware, "fanStepPercent", "fan_step_percent")) migrated = true;
                if (RenameField(hardware, "hysteresisTemp", "hysteresis_temp")) migrated = true;
                
                // Add new fields if missing
                if (hardware["failsafe_speed"] == null)
                {
                    hardware["failsafe_speed"] = 70;
                    migrated = true;
                }
                if (hardware["enable_sensor_monitoring"] == null)
                {
                    hardware["enable_sensor_monitoring"] = true;
                    migrated = true;
                }
            }
            
            if (json["logging"] is JObject logging)
            {
                // Rename camelCase to snake_case
                if (RenameField(logging, "logLevel", "log_level")) migrated = true;
                if (RenameField(logging, "logDirectory", "log_file")) migrated = true;
                if (RenameField(logging, "maxLogFiles", "max_log_size_mb")) migrated = true;
                if (RenameField(logging, "maxLogFileSizeMB", "log_retention_days")) migrated = true;
                
                // Add enable_file_logging if missing
                if (logging["enable_file_logging"] == null)
                {
                    logging["enable_file_logging"] = true;
                    migrated = true;
                }
            }
            
            // Move update_interval to agent section if missing
            if (json["agent"] is JObject agentSection2)
            {
                // Add update_interval if missing (default 3 seconds)
                if (agentSection2["update_interval"] == null)
                {
                    // Try to get from hardware.updateInterval first
                    var hwInterval = json["hardware"]?["updateInterval"];
                    agentSection2["update_interval"] = hwInterval ?? 3.0;
                    migrated = true;
                }
                
                // Move log_level from logging to agent section
                if (agentSection2["log_level"] == null)
                {
                    var logLevel = json["logging"]?["log_level"]?.Value<string>() ?? "INFO";
                    agentSection2["log_level"] = logLevel;
                    migrated = true;
                }
            }
            
            // Remove log_level from logging section (now in agent)
            if (json["logging"] is JObject loggingCleanup)
            {
                loggingCleanup.Remove("log_level");
            }
            
            if (migrated)
            {
                File.WriteAllText(configPath, json.ToString(Formatting.Indented));
                Serilog.Log.Information("Config migrated to unified schema (Phase 4)");
            }
        }
        catch (Exception ex)
        {
            Serilog.Log.Warning("Config migration check failed: {Error}", ex.Message);
        }
    }
    
    /// <summary>
    /// Helper to rename a field in a JObject
    /// </summary>
    private static bool RenameField(JObject obj, string oldName, string newName)
    {
        if (obj[oldName] != null && obj[newName] == null)
        {
            obj[newName] = obj[oldName];
            obj.Remove(oldName);
            return true;
        }
        return false;
    }

    /// <summary>
    /// Save configuration to file
    /// </summary>
    public void SaveToFile(string path)
    {
        var json = JsonConvert.SerializeObject(this, Formatting.Indented);
        var directory = Path.GetDirectoryName(path);

        if (!string.IsNullOrEmpty(directory) && !Directory.Exists(directory))
        {
            Directory.CreateDirectory(directory);
        }

        File.WriteAllText(path, json);
    }

    /// <summary>
    /// Create default configuration (unified snake_case schema)
    /// </summary>
    public static AgentConfig CreateDefault()
    {
        var hostname = Environment.MachineName;
        var agentId = $"windows-{hostname}-{Guid.NewGuid().ToString("N")[..8]}";

        return new AgentConfig
        {
            Agent = new AgentSettings
            {
                Id = agentId,
                Name = hostname,
                UpdateInterval = 3.0,
                LogLevel = "INFO"
            },
            Backend = new BackendSettings
            {
                ServerUrl = "ws://[YOUR_HUB_IP]:3143/websocket",
                ReconnectInterval = 5.0,
                MaxReconnectAttempts = -1,
                ConnectionTimeout = 10.0
            },
            Hardware = new HardwareSettings
            {
                EnableFanControl = true,
                EnableSensorMonitoring = true,
                FailsafeSpeed = 70,
                FanStepPercent = 5,
                HysteresisTemp = 3.0,
                EmergencyTemp = 85.0
            },
            Logging = new LoggingSettings
            {
                EnableFileLogging = true,
                LogFile = "logs/agent.log",
                MaxLogSizeMb = 50,
                LogRetentionDays = 7
            }
        };
    }
}

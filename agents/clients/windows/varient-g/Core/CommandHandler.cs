using Newtonsoft.Json.Linq;
using Pankha.WindowsAgent.Hardware;
using Pankha.WindowsAgent.Models.Configuration;
using Pankha.WindowsAgent.Models.Messages;
using Microsoft.Extensions.Logging;
using Serilog;

namespace Pankha.WindowsAgent.Core;

public class CommandHandler
{
    private readonly IHardwareMonitor _hardware;
    private readonly AgentConfig _config;
    private readonly ILogger<CommandHandler> _logger;
    private readonly string _configPath;

    public CommandHandler(IHardwareMonitor hardware, AgentConfig config, ILogger<CommandHandler> logger, string configPath)
    {
        _hardware = hardware;
        _config = config;
        _logger = logger;
        _configPath = configPath;
    }

    public async Task<CommandResponse> HandleCommandAsync(string type, string id, Dictionary<string, object> payload)
    {
        try
        {
            switch (type)
            {
                case "setFanSpeed":
                    return await HandleSetFanSpeed(id, payload);
                case "setUpdateInterval":
                    return HandleSetUpdateInterval(id, payload);
                case "setLogLevel":
                    return HandleSetLogLevel(id, payload);
                case "emergencyStop":
                    return await HandleEmergencyStop(id);
                case "setHysteresis":
                    return HandleSetHysteresis(id, payload);
                case "setFanStep":
                    return HandleSetFanStep(id, payload);
                case "setSensorDeduplication":
                    return HandleSetSensorDeduplication(id, payload);
                case "setSensorTolerance":
                    return HandleSetSensorTolerance(id, payload);
                case "setEmergencyTemp":
                    return HandleSetEmergencyTemp(id, payload);
                default:
                    return Error(id, $"Unknown command: {type}");
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error handling command {Type}", type);
            return Error(id, ex.Message);
        }
    }

    private async Task<CommandResponse> HandleSetFanSpeed(string id, Dictionary<string, object> payload)
    {
        var fanId = Get<string>(payload, "fanId");
        var speed = Get<int>(payload, "speed");
        
        await _hardware.SetFanSpeedAsync(fanId, speed);
        return Success(id, new { fanId, speed });
    }

    private CommandResponse HandleSetUpdateInterval(string id, Dictionary<string, object> payload)
    {
        var interval = Get<double>(payload, "interval");
        _config.Hardware.UpdateInterval = interval;
        _config.SaveToFile(_configPath);
        return Success(id, new { interval });
    }

    private CommandResponse HandleSetLogLevel(string id, Dictionary<string, object> payload)
    {
        var level = Get<string>(payload, "level");
        _config.Logging.LogLevel = level;
        _config.SaveToFile(_configPath);

        // Dynamic update
        var serilogLevel = level.ToUpperInvariant() switch
        {
            "TRACE" => Serilog.Events.LogEventLevel.Verbose,
            "DEBUG" => Serilog.Events.LogEventLevel.Debug,
            "INFO" => Serilog.Events.LogEventLevel.Information,
            "WARN" => Serilog.Events.LogEventLevel.Warning,
            "ERROR" => Serilog.Events.LogEventLevel.Error,
            "CRITICAL" => Serilog.Events.LogEventLevel.Fatal,
            _ => Serilog.Events.LogEventLevel.Information
        };

        // Reconfigure global logger
        Serilog.Log.Logger = new Serilog.LoggerConfiguration()
            .MinimumLevel.Is(serilogLevel)
            .WriteTo.Console()
            .WriteTo.File(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "PankhaAgent", "logs", "agent.log"), rollingInterval: RollingInterval.Day)
            .CreateLogger();

        _logger.LogInformation("Log level updated to {Level}", level);
        return Success(id, new { level });
    }

    private async Task<CommandResponse> HandleEmergencyStop(string id)
    {
        await _hardware.EmergencyStopAsync();
        return Success(id, new { message = "Emergency Stop Executed" });
    }

    private CommandResponse HandleSetHysteresis(string id, Dictionary<string, object> payload)
    {
        var hysteresis = Get<double>(payload, "hysteresis");
        _config.Monitoring.HysteresisTemp = hysteresis;
        _config.SaveToFile(_configPath);
        return Success(id, new { hysteresis });
    }

    private CommandResponse HandleSetFanStep(string id, Dictionary<string, object> payload)
    {
        var step = Get<int>(payload, "step");
        _config.Monitoring.FanStepPercent = step;
        _config.SaveToFile(_configPath);
        return Success(id, new { step });
    }

    private CommandResponse HandleSetSensorDeduplication(string id, Dictionary<string, object> payload)
    {
        var enabled = Get<bool>(payload, "enabled");
        _config.Monitoring.FilterDuplicateSensors = enabled;
        _config.SaveToFile(_configPath);
        return Success(id, new { enabled });
    }

    private CommandResponse HandleSetSensorTolerance(string id, Dictionary<string, object> payload)
    {
        var tolerance = Get<double>(payload, "tolerance");
        _config.Monitoring.DuplicateSensorTolerance = tolerance;
        _config.SaveToFile(_configPath);
        return Success(id, new { tolerance });
    }

    private CommandResponse HandleSetEmergencyTemp(string id, Dictionary<string, object> payload)
    {
        var temp = Get<double>(payload, "temperature");
        _config.Hardware.EmergencyTemperature = temp;
        _config.SaveToFile(_configPath);
        return Success(id, new { temperature = temp });
    }

    private T Get<T>(Dictionary<string, object> payload, string key)
    {
        if (!payload.TryGetValue(key, out var val)) throw new ArgumentException($"Missing {key}");
        if (val is JToken token) return token.ToObject<T>()!;
        return (T)Convert.ChangeType(val, typeof(T));
    }

    private CommandResponse Success(string id, object data) => new() { CommandId = id, Success = true, Data = JObject.FromObject(data).ToObject<Dictionary<string, object>>() };
    private CommandResponse Error(string id, string error) => new() { CommandId = id, Success = false, Error = error };
}

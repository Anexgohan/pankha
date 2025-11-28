using Newtonsoft.Json;
using Pankha.WindowsAgent.Hardware;
using Pankha.WindowsAgent.Models.Configuration;
using Pankha.WindowsAgent.Models.Messages;
using Serilog;

namespace Pankha.WindowsAgent.Core;

/// <summary>
/// Handles commands received from backend
/// </summary>
public class CommandHandler
{
    private readonly IHardwareMonitor _hardwareMonitor;
    private readonly AgentConfig _config;
    private readonly ILogger _logger;

    public CommandHandler(IHardwareMonitor hardwareMonitor, AgentConfig config, ILogger logger)
    {
        _hardwareMonitor = hardwareMonitor;
        _config = config;
        _logger = logger;
    }

    /// <summary>
    /// Handle a command and return response
    /// </summary>
    public async Task<CommandResponse> HandleCommandAsync(
        string commandType,
        string commandId,
        Dictionary<string, object> payload)
    {
        try
        {
            switch (commandType)
            {
                case "setFanSpeed":
                    return await HandleSetFanSpeedAsync(commandId, payload);

                case "emergencyStop":
                    return await HandleEmergencyStopAsync(commandId);

                case "setUpdateInterval":
                    return await HandleSetUpdateIntervalAsync(commandId, payload);

                case "setSensorDeduplication":
                    return await HandleSetSensorDeduplicationAsync(commandId, payload);

                case "setSensorTolerance":
                    return await HandleSetSensorToleranceAsync(commandId, payload);

                case "setFanStep":
                    return await HandleSetFanStepAsync(commandId, payload);

                case "setHysteresis":
                    return await HandleSetHysteresisAsync(commandId, payload);

                case "setEmergencyTemp":
                    return await HandleSetEmergencyTempAsync(commandId, payload);

                case "setLogLevel":
                    return await HandleSetLogLevelAsync(commandId, payload);

                case "ping":
                    return CreateSuccessResponse(commandId, new { pong = true });

                default:
                    return CreateErrorResponse(commandId, $"Unknown command type: {commandType}");
            }
        }
        catch (Exception ex)
        {
            _logger.Error(ex, "Error handling command {CommandType}", commandType);
            return CreateErrorResponse(commandId, ex.Message);
        }
    }

    private async Task<CommandResponse> HandleSetFanSpeedAsync(string commandId, Dictionary<string, object> payload)
    {
        var fanId = GetPayloadValue<string>(payload, "fanId");
        var speed = GetPayloadValue<int>(payload, "speed");

        _logger.Information("Setting fan {FanId} to {Speed}%", fanId, speed);

        await _hardwareMonitor.SetFanSpeedAsync(fanId, speed);

        return CreateSuccessResponse(commandId, new { fanId, speed });
    }

    private async Task<CommandResponse> HandleEmergencyStopAsync(string commandId)
    {
        _logger.Warning("EMERGENCY STOP activated");

        await _hardwareMonitor.EmergencyStopAsync();

        return CreateSuccessResponse(commandId, new { message = "Emergency stop executed" });
    }

    private Task<CommandResponse> HandleSetUpdateIntervalAsync(string commandId, Dictionary<string, object> payload)
    {
        var interval = GetPayloadValue<double>(payload, "interval");

        if (interval < 0.5 || interval > 30.0)
        {
            return Task.FromResult(CreateErrorResponse(commandId, "Update interval must be between 0.5 and 30 seconds"));
        }

        var oldInterval = _config.Hardware.UpdateInterval;
        _config.Hardware.UpdateInterval = interval;
        _config.SaveToFile(@"C:\Program Files\Pankha\config.json");

        _logger.Information("Update interval changed: {Old}s -> {New}s", oldInterval, interval);

        return Task.FromResult(CreateSuccessResponse(commandId, new { interval }));
    }

    private Task<CommandResponse> HandleSetSensorDeduplicationAsync(string commandId, Dictionary<string, object> payload)
    {
        var enabled = GetPayloadValue<bool>(payload, "enabled");

        var oldEnabled = _config.Monitoring.FilterDuplicateSensors;
        _config.Monitoring.FilterDuplicateSensors = enabled;
        _config.SaveToFile(@"C:\Program Files\Pankha\config.json");

        _logger.Information("Sensor deduplication changed: {Old} -> {New}", oldEnabled, enabled);

        return Task.FromResult(CreateSuccessResponse(commandId, new { enabled }));
    }

    private Task<CommandResponse> HandleSetSensorToleranceAsync(string commandId, Dictionary<string, object> payload)
    {
        var tolerance = GetPayloadValue<double>(payload, "tolerance");

        if (tolerance < 0.25 || tolerance > 5.0)
        {
            return Task.FromResult(CreateErrorResponse(commandId, "Tolerance must be between 0.25°C and 5.0°C"));
        }

        var oldTolerance = _config.Monitoring.DuplicateSensorTolerance;
        _config.Monitoring.DuplicateSensorTolerance = tolerance;
        _config.SaveToFile(@"C:\Program Files\Pankha\config.json");

        _logger.Information("Sensor tolerance changed: {Old}C -> {New}C", oldTolerance, tolerance);

        return Task.FromResult(CreateSuccessResponse(commandId, new { tolerance }));
    }

    private Task<CommandResponse> HandleSetFanStepAsync(string commandId, Dictionary<string, object> payload)
    {
        var step = GetPayloadValue<int>(payload, "step");

        var validSteps = new[] { 3, 5, 10, 15, 25, 50, 100 };
        if (!validSteps.Contains(step))
        {
            return Task.FromResult(CreateErrorResponse(commandId, $"Step must be one of: {string.Join(", ", validSteps)}"));
        }

        var oldStep = _config.Monitoring.FanStepPercent;
        _config.Monitoring.FanStepPercent = step;
        _config.SaveToFile(@"C:\Program Files\Pankha\config.json");

        _logger.Information("Fan step changed: {Old}% -> {New}%", oldStep, step);

        return Task.FromResult(CreateSuccessResponse(commandId, new { step }));
    }

    private Task<CommandResponse> HandleSetHysteresisAsync(string commandId, Dictionary<string, object> payload)
    {
        var hysteresis = GetPayloadValue<double>(payload, "hysteresis");

        if (hysteresis < 0.0 || hysteresis > 10.0)
        {
            return Task.FromResult(CreateErrorResponse(commandId, "Hysteresis must be between 0.0°C and 10.0°C"));
        }

        var oldHysteresis = _config.Monitoring.HysteresisTemp;
        _config.Monitoring.HysteresisTemp = hysteresis;
        _config.SaveToFile(@"C:\Program Files\Pankha\config.json");

        _logger.Information("Hysteresis changed: {Old}C -> {New}C", oldHysteresis, hysteresis);

        return Task.FromResult(CreateSuccessResponse(commandId, new { hysteresis }));
    }

    private Task<CommandResponse> HandleSetEmergencyTempAsync(string commandId, Dictionary<string, object> payload)
    {
        var temp = GetPayloadValue<double>(payload, "temperature");

        if (temp < 70.0 || temp > 100.0)
        {
            return Task.FromResult(CreateErrorResponse(commandId, "Emergency temperature must be between 70°C and 100°C"));
        }

        var oldTemp = _config.Hardware.EmergencyTemperature;
        _config.Hardware.EmergencyTemperature = temp;
        _config.SaveToFile(@"C:\Program Files\Pankha\config.json");

        _logger.Information("Emergency temperature changed: {Old}C -> {New}C", oldTemp, temp);

        return Task.FromResult(CreateSuccessResponse(commandId, new { temperature = temp }));
    }

    private Task<CommandResponse> HandleSetLogLevelAsync(string commandId, Dictionary<string, object> payload)
    {
        var level = GetPayloadValue<string>(payload, "level");

        var validLevels = new[] { "TRACE", "DEBUG", "INFO", "WARN", "ERROR", "CRITICAL" };
        var upperLevel = level.ToUpperInvariant();

        if (!validLevels.Contains(upperLevel))
        {
            return Task.FromResult(CreateErrorResponse(commandId, $"Log level must be one of: {string.Join(", ", validLevels)}"));
        }

        // Save to config file
        _config.Logging.LogLevel = upperLevel;
        _config.SaveToFile(@"C:\Program Files\Pankha\config.json");

        // Map to Serilog level
        var serilogLevel = upperLevel switch
        {
            "TRACE" => Serilog.Events.LogEventLevel.Verbose,
            "DEBUG" => Serilog.Events.LogEventLevel.Debug,
            "INFO" => Serilog.Events.LogEventLevel.Information,
            "WARN" => Serilog.Events.LogEventLevel.Warning,
            "ERROR" => Serilog.Events.LogEventLevel.Error,
            "CRITICAL" => Serilog.Events.LogEventLevel.Fatal,
            _ => Serilog.Events.LogEventLevel.Information
        };

        // Update the global LoggingLevelSwitch - this dynamically changes ALL loggers
        // This is the Serilog equivalent of Rust agent's tracing_reload_handle.reload()
        var oldLevel = _config.Logging.LogLevel;
        Pankha.WindowsAgent.Program.LogLevelSwitch.MinimumLevel = serilogLevel;

        _logger.Information("Log level changed: {Old} -> {New}", oldLevel, upperLevel);

        return Task.FromResult(CreateSuccessResponse(commandId, new { level = upperLevel }));
    }

    private T GetPayloadValue<T>(Dictionary<string, object> payload, string key)
    {
        if (!payload.TryGetValue(key, out var value))
        {
            throw new ArgumentException($"Missing required parameter: {key}");
        }

        try
        {
            // Handle JSON deserialization for complex types
            if (value is Newtonsoft.Json.Linq.JToken jToken)
            {
                return jToken.ToObject<T>() ?? throw new InvalidCastException($"Failed to convert {key} to {typeof(T).Name}");
            }

            return (T)Convert.ChangeType(value, typeof(T));
        }
        catch (Exception ex)
        {
            throw new ArgumentException($"Invalid value for parameter '{key}': {ex.Message}", ex);
        }
    }

    private CommandResponse CreateSuccessResponse(string commandId, object data)
    {
        return new CommandResponse
        {
            CommandId = commandId,
            Success = true,
            Data = data as Dictionary<string, object> ??
                   JsonConvert.DeserializeObject<Dictionary<string, object>>(JsonConvert.SerializeObject(data)),
            Timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
        };
    }

    private CommandResponse CreateErrorResponse(string commandId, string error)
    {
        return new CommandResponse
        {
            CommandId = commandId,
            Success = false,
            Error = error,
            Timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
        };
    }
}

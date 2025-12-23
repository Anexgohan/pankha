using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Pankha.WindowsAgent.Hardware;
using Pankha.WindowsAgent.Models.Configuration;

namespace Pankha.WindowsAgent.Services;

/// <summary>
/// Monitors WebSocket connection health and triggers emergency fallback
/// Based on Linux agent reconnection logic: max 15s reconnect delay for hardware safety
/// </summary>
public class ConnectionWatchdog : BackgroundService
{
    private readonly IHardwareMonitor _hardware;
    private readonly ILogger<ConnectionWatchdog> _logger;
    private readonly AgentConfig _config;
    private DateTime _lastSuccessfulConnection = DateTime.UtcNow;
    private bool _failsafeModeActive = false;

    // From Linux agent: max 15s reconnect delay, so 30s = 2x max delay before emergency
    private const int MAX_DISCONNECT_SECONDS = 30;

    // Check interval during failsafe mode (same as update interval for consistency)
    private const int FAILSAFE_CHECK_INTERVAL_SECONDS = 3;

    public ConnectionWatchdog(IHardwareMonitor hardware, ILogger<ConnectionWatchdog> logger, AgentConfig config)
    {
        _hardware = hardware;
        _logger = logger;
        _config = config;
    }

    /// <summary>
    /// Called by WebSocketClient when connection is successful
    /// </summary>
    public void ReportSuccessfulConnection()
    {
        _lastSuccessfulConnection = DateTime.UtcNow;

        if (_failsafeModeActive)
        {
            _logger.LogInformation("✅ Connection restored, exiting failsafe mode");
            _logger.LogInformation("Backend will resume fan control");
            _failsafeModeActive = false;
        }
    }

    /// <summary>
    /// Called by WebSocketClient when connection is explicitly lost
    /// </summary>
    public void ReportDisconnect()
    {
        // Force watchdog to trigger immediately by setting last connection to past
        _lastSuccessfulConnection = DateTime.UtcNow.AddSeconds(-(MAX_DISCONNECT_SECONDS + 1));
        _logger.LogWarning("Explicit disconnect reported - watchdog will trigger failsafe mode");
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("Connection watchdog started (failsafe threshold: {Seconds}s, emergency temp: {Temp}°C)",
            MAX_DISCONNECT_SECONDS, _config.Hardware.EmergencyTemperature);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var timeSinceConnection = DateTime.UtcNow - _lastSuccessfulConnection;
                var isDisconnected = timeSinceConnection.TotalSeconds > MAX_DISCONNECT_SECONDS;

                // Enter failsafe mode if disconnected too long
                if (isDisconnected && !_failsafeModeActive)
                {
                    _logger.LogWarning("⚠️ No backend connection for {Seconds}s - ENTERING FAILSAFE MODE",
                        (int)timeSinceConnection.TotalSeconds);

                    try
                    {
                        // GPU fans → auto, other fans → 70%
                        await _hardware.EnterFailsafeModeAsync();
                        _failsafeModeActive = true;

                        _logger.LogWarning("FAILSAFE MODE ACTIVE: GPU fans on auto, others at 70%");
                        _logger.LogInformation("Local temperature monitoring enabled");
                        _logger.LogInformation("Will resume backend control when connection restores");
                    }
                    catch (Exception ex)
                    {
                        _logger.LogError(ex, "CRITICAL: Failed to enter failsafe mode!");
                    }
                }

                // While in failsafe mode, monitor temperatures
                if (_failsafeModeActive)
                {
                    await CheckEmergencyTemperatureAsync();
                }

                // Check interval: faster during failsafe for temp monitoring
                var checkInterval = _failsafeModeActive
                    ? FAILSAFE_CHECK_INTERVAL_SECONDS
                    : 10;
                await Task.Delay(TimeSpan.FromSeconds(checkInterval), stoppingToken);
            }
            catch (OperationCanceledException)
            {
                // Expected on shutdown
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error in connection watchdog");
                await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);
            }
        }

        _logger.LogInformation("Connection watchdog stopped");
    }

    /// <summary>
    /// Check if any sensor exceeds emergency temperature and trigger 100% fans if needed
    /// </summary>
    private async Task CheckEmergencyTemperatureAsync()
    {
        try
        {
            var maxTemp = await _hardware.GetMaxTemperatureAsync();
            var emergencyTemp = _config.Hardware.EmergencyTemperature;

            if (maxTemp >= emergencyTemp)
            {
                _logger.LogWarning("🚨 FAILSAFE EMERGENCY: {MaxTemp:F1}°C >= {EmergencyTemp:F1}°C - ALL FANS TO 100%",
                    maxTemp, emergencyTemp);
                await _hardware.EmergencyStopAsync();
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to check emergency temperature");
        }
    }
}

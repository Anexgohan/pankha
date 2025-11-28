using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Pankha.WindowsAgent.Hardware;

namespace Pankha.WindowsAgent.Services;

/// <summary>
/// Monitors WebSocket connection health and triggers emergency fallback
/// Based on Linux agent reconnection logic: max 15s reconnect delay for hardware safety
/// </summary>
public class ConnectionWatchdog : BackgroundService
{
    private readonly IHardwareMonitor _hardware;
    private readonly ILogger<ConnectionWatchdog> _logger;
    private DateTime _lastSuccessfulConnection = DateTime.UtcNow;
    private bool _emergencyModeActive = false;

    // From Linux agent: max 15s reconnect delay, so 45s = 3x max delay before emergency
    private const int MAX_DISCONNECT_SECONDS = 45;

    public ConnectionWatchdog(IHardwareMonitor hardware, ILogger<ConnectionWatchdog> logger)
    {
        _hardware = hardware;
        _logger = logger;
    }

    /// <summary>
    /// Called by WebSocketClient when connection is successful
    /// </summary>
    public void ReportSuccessfulConnection()
    {
        _lastSuccessfulConnection = DateTime.UtcNow;

        if (_emergencyModeActive)
        {
            _logger.LogInformation("Connection restored, deactivating emergency mode");
            _emergencyModeActive = false;
        }
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("Connection watchdog started (emergency threshold: {Seconds}s)",
            MAX_DISCONNECT_SECONDS);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var timeSinceConnection = DateTime.UtcNow - _lastSuccessfulConnection;

                // Check if disconnected too long
                if (timeSinceConnection.TotalSeconds > MAX_DISCONNECT_SECONDS && !_emergencyModeActive)
                {
                    _logger.LogCritical("WARNING: No backend connection for {Seconds}s - ACTIVATING EMERGENCY MODE",
                        (int)timeSinceConnection.TotalSeconds);

                    // Set all fans to 100% for hardware safety
                    try
                    {
                        await _hardware.EmergencyStopAsync();
                        _emergencyModeActive = true;

                        _logger.LogWarning("EMERGENCY: All fans set to 100%");
                        _logger.LogInformation("Will resume normal operation when backend reconnects");
                    }
                    catch (Exception ex)
                    {
                        _logger.LogError(ex, "CRITICAL: Failed to activate emergency mode!");
                    }
                }

                // Check every 10 seconds
                await Task.Delay(TimeSpan.FromSeconds(10), stoppingToken);
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
}

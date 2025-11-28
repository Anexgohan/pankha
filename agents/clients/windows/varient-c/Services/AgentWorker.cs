using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Pankha.WindowsAgent.Core;
using Pankha.WindowsAgent.Hardware;
using Pankha.WindowsAgent.Models.Configuration;

namespace Pankha.WindowsAgent.Services;

/// <summary>
/// Main agent worker that runs as a Windows Service
/// </summary>
public class AgentWorker : BackgroundService
{
    private readonly ILogger<AgentWorker> _logger;
    private readonly AgentConfig _config;
    private IHardwareMonitor? _hardwareMonitor;
    private WebSocketClient? _webSocketClient;
    private ConnectionWatchdog? _connectionWatchdog;

    public AgentWorker(ILogger<AgentWorker> logger, AgentConfig config)
    {
        _logger = logger;
        _config = config;
    }

    public override async Task StartAsync(CancellationToken cancellationToken)
    {
        _logger.LogInformation("Pankha Agent Service starting...");
        _logger.LogInformation("Agent ID: {AgentId}", _config.Agent.AgentId);
        _logger.LogInformation("Agent Name: {Name}", _config.Agent.Name);
        _logger.LogInformation("Backend URL: {Url}", _config.Backend.Url);

        await base.StartAsync(cancellationToken);
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            _logger.LogInformation("Pankha Agent Service running");

            // Initialize hardware monitor
            _hardwareMonitor = new LibreHardwareAdapter(
                _config.Hardware,
                _config.Monitoring,
                Serilog.Log.Logger);

            // Initialize connection watchdog
            _connectionWatchdog = new ConnectionWatchdog(
                _hardwareMonitor,
                Microsoft.Extensions.Logging.Abstractions.NullLogger<ConnectionWatchdog>.Instance);

            // Start watchdog in background
            _ = _connectionWatchdog.StartAsync(stoppingToken);

            // Initialize WebSocket client
            _webSocketClient = new WebSocketClient(
                _config,
                _hardwareMonitor,
                Serilog.Log.Logger,
                _connectionWatchdog);

            // Start WebSocket communication (blocks until cancellation)
            await _webSocketClient.StartAsync(stoppingToken);
        }
        catch (OperationCanceledException)
        {
            _logger.LogInformation("Agent service is stopping");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Fatal error in agent service");
            throw; // Will trigger service restart via Windows Service recovery
        }
    }

    public override async Task StopAsync(CancellationToken cancellationToken)
    {
        _logger.LogInformation("Pankha Agent Service stopping...");

        try
        {
            // Dispose resources
            _webSocketClient?.Dispose();
            _hardwareMonitor?.Dispose();

            _logger.LogInformation("Agent service stopped gracefully");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error during service shutdown");
        }

        await base.StopAsync(cancellationToken);
    }

    public override void Dispose()
    {
        _webSocketClient?.Dispose();
        _hardwareMonitor?.Dispose();
        base.Dispose();
    }
}

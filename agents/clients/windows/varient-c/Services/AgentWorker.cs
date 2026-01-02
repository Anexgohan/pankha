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
    private NamedPipeHost? _namedPipeHost;

    public AgentWorker(ILogger<AgentWorker> logger, AgentConfig config)
    {
        _logger = logger;
        _config = config;
    }

    public override async Task StartAsync(CancellationToken cancellationToken)
    {
        _logger.LogInformation("Pankha Agent Service starting...");
        _logger.LogInformation("Agent ID: {AgentId}", _config.Agent.Id);
        _logger.LogInformation("Agent Name: {Name}", _config.Agent.Name);
        _logger.LogInformation("Backend URL: {Url}", _config.Backend.ServerUrl);

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
                Serilog.Log.Logger);

            // Initialize connection watchdog with config for emergency_temp monitoring
            _connectionWatchdog = new ConnectionWatchdog(
                _hardwareMonitor,
                Microsoft.Extensions.Logging.Abstractions.NullLogger<ConnectionWatchdog>.Instance,
                _config);

            // DUMP HARDWARE INFO (User Request)
            try 
            {
                _logger.LogInformation("Generating hardware-info.json dump...");
                var dump = await _hardwareMonitor.DumpFullHardwareInfoAsync();
                var json = Newtonsoft.Json.JsonConvert.SerializeObject(dump, Newtonsoft.Json.Formatting.Indented);
                var dumpPath = Path.Combine(Pankha.WindowsAgent.Platform.PathResolver.InstallPath, "hardware-info.json");
                await File.WriteAllTextAsync(dumpPath, json);
                _logger.LogInformation("Saved hardware dump to {Path}", dumpPath);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to generate hardware-info.json");
            }

            // Start watchdog in background
            _ = _connectionWatchdog.StartAsync(stoppingToken);

            // Initialize WebSocket client
            _webSocketClient = new WebSocketClient(
                _config,
                _hardwareMonitor,
                Serilog.Log.Logger,
                _connectionWatchdog);

            // Initialize and Start Named Pipe Host (IPC)
            _namedPipeHost = new NamedPipeHost(_config, _webSocketClient, _hardwareMonitor);
            
            // Start IPC in background
            _namedPipeHost.Start();
            
            _logger.LogInformation("IPC: Named Pipe Host started");

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
            _namedPipeHost?.Dispose();
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
        _namedPipeHost?.Dispose();
        _webSocketClient?.Dispose();
        _hardwareMonitor?.Dispose();
        base.Dispose();
    }
}

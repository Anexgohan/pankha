using System.Reflection;
using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using Newtonsoft.Json;
using Pankha.WindowsAgent.Models.Configuration;
using Pankha.WindowsAgent.Models.Ipc;
using Pankha.WindowsAgent.Platform;
using Pankha.WindowsAgent.Hardware; // Required for IHardwareMonitor
using Serilog;

namespace Pankha.WindowsAgent.Services;

/// <summary>
/// Hosts a Named Pipe server for local IPC with the UI
/// </summary>
public class NamedPipeHost : IDisposable
{
    private const string PIPE_NAME = "PankhaAgent";
    private readonly AgentConfig _config;
    private readonly Core.WebSocketClient _wsClient;
    private readonly IHardwareMonitor _hardware;
    private readonly CancellationTokenSource _cts = new();
    private Task? _serverTask;

    public NamedPipeHost(AgentConfig config, Core.WebSocketClient wsClient, IHardwareMonitor hardware)
    {
        _config = config;
        _wsClient = wsClient;
        _hardware = hardware;
    }

    public void Start()
    {
        _serverTask = Task.Run(RunServerLoopAsync);
    }

    private async Task RunServerLoopAsync()
    {
        Log.Information("IPC: Named Pipe server starting on \\\\.\\pipe\\{Name}", PIPE_NAME);

        // Security: Create the ACL once to ensure all pipe instances have IDENTICAL security descriptors.
        // Mismatched ACLs between instances causes UnauthorizedAccessException.
        var pipeSecurity = new PipeSecurity();
        
        // Essential: Allow LocalSystem (Service) Full Control
        pipeSecurity.AddAccessRule(new PipeAccessRule(
            new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null),
            PipeAccessRights.FullControl,
            AccessControlType.Allow));
            
        // Allow Admins Full Control
        pipeSecurity.AddAccessRule(new PipeAccessRule(
            new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null),
            PipeAccessRights.FullControl,
            AccessControlType.Allow));

        pipeSecurity.AddAccessRule(new PipeAccessRule(
            new SecurityIdentifier(WellKnownSidType.AuthenticatedUserSid, null),
            PipeAccessRights.ReadWrite,
            AccessControlType.Allow));
        
        // Debugging: Allow Everyone (World)
        pipeSecurity.AddAccessRule(new PipeAccessRule(
            new SecurityIdentifier(WellKnownSidType.WorldSid, null),
            PipeAccessRights.ReadWrite,
            AccessControlType.Allow));

        while (!_cts.Token.IsCancellationRequested)
        {
            try
            {
                var server = NamedPipeServerStreamAcl.Create(
                    PIPE_NAME,
                    PipeDirection.InOut,
                    NamedPipeServerStream.MaxAllowedServerInstances,
                    PipeTransmissionMode.Byte,
                    PipeOptions.Asynchronous,
                    0, 0,
                    pipeSecurity);

                // Wait for connection
                try 
                {
                    await server.WaitForConnectionAsync(_cts.Token);
                }
                catch
                {
                    // If cancellation occurred or error during wait, dispose and re-throw/break
                    await server.DisposeAsync();
                    throw;
                }

                // Log.Information("IPC: Client connected. Spawning handler...");

                // Handle client in background (Fire and Forget)
                // This allows the loop to immediately accept the NEXT connection
                // Use async lambda to properly await and log any errors
                _ = Task.Run(async () =>
                {
                    try
                    {
                        // Log.Information("IPC: Background task started for client {Handle}", server.SafePipeHandle.IsInvalid ? "Invalid" : "Valid");
                        await HandleClientAsync(server);
                    }
                    catch (Exception ex)
                    {
                        Log.Error(ex, "IPC: Unhandled error in client handler");
                        try { await server.DisposeAsync(); } catch { }
                    }
                });
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                Log.Error(ex, "IPC: Error in named pipe server loop");
                await Task.Delay(1000, _cts.Token);
            }
        }
    }

    private async Task HandleClientAsync(NamedPipeServerStream server)
    {
        // Log.Information("IPC: Handler entered for client (Thread {Id})", Environment.CurrentManagedThreadId);

        // Take ownership of the server stream - ensure it is disposed!
        await using var serverStream = server;

        try
        {
            // Log.Information("IPC: Creating StreamReader/Writer...");
            // Use UTF8 without BOM to prevent constructor blocking on Preamble detection
            var encoding = new UTF8Encoding(false);
            using var reader = new StreamReader(serverStream, encoding, leaveOpen: true);
            using var writer = new StreamWriter(serverStream, encoding, leaveOpen: true) { AutoFlush = true };

            // Log.Information("IPC: Handler ready, waiting to read...");
            
            // Add a timeout for reading the request to prevent stuck connections
            using var readCts = CancellationTokenSource.CreateLinkedTokenSource(_cts.Token);
            readCts.CancelAfter(30000); // 30s max for read

            var line = await reader.ReadLineAsync(readCts.Token);
            
            if (string.IsNullOrEmpty(line)) 
            {
                Log.Warning("IPC: Client disconnected or sent empty line.");
                return;
            }
            // Log.Information("IPC: Received {Bytes} chars. Processing...", line.Length);

            // The snippet uses IpcRequest and request.Command, assuming IpcMessage is now IpcRequest
            var request = JsonConvert.DeserializeObject<IpcMessage>(line); // Kept IpcMessage as per original code
            if (request == null) return;

            object response = new { Success = false, Error = "Unknown command" };

            switch (request.Type) // Kept request.Type as per original code
            {
                case IpcCommands.GET_STATUS:
                    // Get Hardware Info
                    var sensors = await _hardware.DiscoverSensorsAsync();
                    var fans = await _hardware.DiscoverFansAsync();
                    
                    // Get Version dynamically
                    var version = Pankha.WindowsAgent.Platform.VersionHelper.GetVersion();
                    
                    // Get top sensors for tooltip (take first 4, sorted by temp descending)
                    var topSensors = sensors
                        .OrderByDescending(s => s.Temperature)
                        .Take(4)
                        .Select(s => new SensorReading 
                        { 
                            Name = s.Name?.Replace("Temperature", "").Trim() ?? "Sensor",
                            Temperature = (float)s.Temperature 
                        })
                        .ToList();
                    
                    // Get all fans for tooltip (include all, even at 0 RPM)
                    var topFans = fans
                        .Take(6)
                        .Select(f => new FanReading 
                        { 
                            Name = f.Name ?? "Fan",
                            Rpm = f.Rpm 
                        })
                        .ToList();

                    response = new AgentStatus
                    {
                        AgentId = _config.Agent.AgentId,
                        AgentName = _config.Agent.Name,
                        Version = version, 
                        ConnectionState = _wsClient.State.ToString(),
                        SensorsDiscovered = sensors.Count,
                        FansDiscovered = fans.Count,
                        Uptime = DateTime.UtcNow - System.Diagnostics.Process.GetCurrentProcess().StartTime.ToUniversalTime(),
                        IsService = !Environment.UserInteractive, // Approximate check
                        TopSensors = topSensors,
                        TopFans = topFans
                    };
                    break;

                case IpcCommands.GET_CONFIG:
                    response = _config;
                    break;

                case IpcCommands.SET_CONFIG:
                   if (request.Payload != null)
                   {
                        try
                        {
                            var newConfig = JsonConvert.DeserializeObject<AgentConfig>(request.Payload);
                            if (newConfig != null)
                            {
                                newConfig.Agent.Validate();

                                // Check if log level changed
                                bool logLevelChanged = !string.Equals(
                                    _config.Logging.LogLevel,
                                    newConfig.Logging.LogLevel,
                                    StringComparison.OrdinalIgnoreCase);

                                // Fix: Explicitly save to disk
                                newConfig.SaveToFile(PathResolver.ConfigPath);

                                // Update in-memory config references
                                _config.Agent = newConfig.Agent;
                                _config.Backend = newConfig.Backend;
                                _config.Hardware = newConfig.Hardware;
                                _config.Monitoring = newConfig.Monitoring;
                                _config.Logging = newConfig.Logging;

                                Log.Information("IPC: Configuration saved to {Path}", PathResolver.ConfigPath);

                                // Apply log level change immediately (same logic as CommandHandler)
                                if (logLevelChanged && !string.IsNullOrEmpty(newConfig.Logging.LogLevel))
                                {
                                    var upperLevel = newConfig.Logging.LogLevel.ToUpperInvariant();
                                    var serilogLevel = upperLevel switch
                                    {
                                        "TRACE" => Serilog.Events.LogEventLevel.Verbose,
                                        "DEBUG" => Serilog.Events.LogEventLevel.Debug,
                                        "INFO" or "INFORMATION" => Serilog.Events.LogEventLevel.Information,
                                        "WARN" or "WARNING" => Serilog.Events.LogEventLevel.Warning,
                                        "ERROR" => Serilog.Events.LogEventLevel.Error,
                                        "CRITICAL" or "FATAL" => Serilog.Events.LogEventLevel.Fatal,
                                        _ => Serilog.Events.LogEventLevel.Information
                                    };

                                    // Update the global LoggingLevelSwitch (same as CommandHandler does)
                                    Program.LogLevelSwitch.MinimumLevel = serilogLevel;
                                    Log.Information("IPC: Log level changed to {Level}", newConfig.Logging.LogLevel);
                                }

                                // FORCE FRONTEND UPDATE:
                                Log.Information("IPC: Triggering backend registration update...");
                                await _wsClient.TriggerConfigurationUpdateAsync();

                                response = new { Success = true };
                            }
                        }
                        catch (Exception ex)
                        {
                            response = new { Success = false, Error = ex.Message };
                        }
                   }
                   break;
            }

            var jsonResponse = JsonConvert.SerializeObject(response);
            await writer.WriteLineAsync(jsonResponse);
        }
        catch (OperationCanceledException)
        {
             Log.Warning("IPC: Client handler timed out or cancelled.");
        }
        catch (Exception ex)
        {
             Log.Error(ex, "IPC: Error handling connection");
        }
    }

    public void Dispose()
    {
        _cts.Cancel();
        _cts.Dispose();
    }
}

using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using Newtonsoft.Json;
using Pankha.WindowsAgent.Models.Configuration;
using Pankha.WindowsAgent.Models.Ipc;
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
    private readonly CancellationTokenSource _cts = new();
    private Task? _serverTask;

    public NamedPipeHost(AgentConfig config, Core.WebSocketClient wsClient)
    {
        _config = config;
        _wsClient = wsClient;
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

                Log.Information("IPC: Client connected. Spawning handler...");

                // Handle client in background (Fire and Forget)
                // This allows the loop to immediately accept the NEXT connection
                // Use async lambda to properly await and log any errors
                _ = Task.Run(async () =>
                {
                    try
                    {
                        await HandleClientAsync(server);
                    }
                    catch (Exception ex)
                    {
                        Log.Error(ex, "IPC: Unhandled error in client handler");
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
        Log.Information("IPC: Handler entered for client");

        // Take ownership of the server stream - ensure it is disposed!
        await using var serverStream = server;

        try
        {
            Log.Debug("IPC: Creating StreamReader/Writer...");
            using var reader = new StreamReader(serverStream, Encoding.UTF8, leaveOpen: true);
            using var writer = new StreamWriter(serverStream, Encoding.UTF8, leaveOpen: true) { AutoFlush = true };

            Log.Information("IPC: Handler ready, waiting to read...");
            
            // Add a timeout for reading the request to prevent stuck connections
            using var readCts = CancellationTokenSource.CreateLinkedTokenSource(_cts.Token);
            readCts.CancelAfter(30000); // 30s max for read

            var line = await reader.ReadLineAsync(readCts.Token);
            
            if (string.IsNullOrEmpty(line)) 
            {
                Log.Warning("IPC: Client disconnected or sent empty line.");
                return;
            }
            Log.Information("IPC: Received {Bytes} chars. Processing...", line.Length);

            var request = JsonConvert.DeserializeObject<IpcMessage>(line);
            if (request == null) return;

            object response = new { Success = false, Error = "Unknown command" };

            switch (request.Type)
            {
                case IpcCommands.GET_STATUS:
                    response = new AgentStatus
                    {
                        AgentId = _config.Agent.AgentId,
                        Version = "1.2.0",
                        ConnectionState = _wsClient.State.ToString(),
                        SensorsDiscovered = 0, // Mock
                        FansDiscovered = 0,    // Mock
                        Uptime = TimeSpan.Zero,
                        IsService = true
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
                                Log.Information("IPC: Configuration updated via Named Pipe");
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

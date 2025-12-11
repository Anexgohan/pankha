using System.IO.Pipes;
using System.Text;
using Newtonsoft.Json;
using Pankha.WindowsAgent.Models.Configuration;
using Pankha.WindowsAgent.Models.Ipc;
using Serilog;

namespace Pankha.Tray.Services;

/// <summary>
/// Named Pipe client for IPC with the Pankha Agent service.
/// Designed for polling: each request is a single quick attempt.
/// The polling timer in TrayApplicationContext handles retries.
/// </summary>
public class IpcClient
{
    private const string PIPE_NAME = "PankhaAgent";
    private const int CONNECT_TIMEOUT_MS = 5000;
    private const int READ_TIMEOUT_MS = 10000;

    /// <summary>
    /// Get current agent status (quick, single attempt)
    /// </summary>
    public async Task<AgentStatus?> GetStatusAsync()
    {
        return await SendRequestAsync<AgentStatus>(IpcCommands.GET_STATUS);
    }

    /// <summary>
    /// Get current agent configuration
    /// </summary>
    public async Task<AgentConfig?> GetConfigAsync()
    {
        return await SendRequestAsync<AgentConfig>(IpcCommands.GET_CONFIG);
    }

    /// <summary>
    /// Update agent configuration
    /// </summary>
    public async Task<bool> SetConfigAsync(AgentConfig config)
    {
        var response = await SendRequestAsync<SetConfigResponse>(IpcCommands.SET_CONFIG, config);
        return response?.Success ?? false;
    }

    private async Task<T?> SendRequestAsync<T>(string commandType, object? payload = null)
    {
        try
        {
            Log.Debug("IPC: Attempting {Command}...", commandType);

            using var client = new NamedPipeClientStream(".", PIPE_NAME, PipeDirection.InOut, PipeOptions.Asynchronous);

            // Connect with timeout
            using var connectCts = new CancellationTokenSource(CONNECT_TIMEOUT_MS);
            try
            {
                await client.ConnectAsync(connectCts.Token);
                Log.Debug("IPC: Connected to pipe");
            }
            catch (OperationCanceledException)
            {
                Log.Debug("IPC: Connection timeout ({Timeout}ms)", CONNECT_TIMEOUT_MS);
                return default;
            }
            catch (Exception ex)
            {
                Log.Debug(ex, "IPC: Connection failed");
                return default;
            }

            using var reader = new StreamReader(client, Encoding.UTF8, leaveOpen: true);
            using var writer = new StreamWriter(client, Encoding.UTF8, leaveOpen: true) { AutoFlush = true };

            // Build and send request
            var request = new IpcMessage
            {
                Type = commandType,
                Payload = payload != null ? JsonConvert.SerializeObject(payload) : null
            };

            var requestJson = JsonConvert.SerializeObject(request);
            Log.Debug("IPC: Sending {Bytes} bytes", requestJson.Length);
            await writer.WriteLineAsync(requestJson);

            // Read response with timeout
            using var readCts = new CancellationTokenSource(READ_TIMEOUT_MS);
            try
            {
                var responseLine = await reader.ReadLineAsync(readCts.Token);

                if (string.IsNullOrEmpty(responseLine))
                {
                    Log.Warning("IPC: Empty response from service");
                    return default;
                }

                Log.Debug("IPC: Received {Bytes} bytes for {Command}", responseLine.Length, commandType);
                return JsonConvert.DeserializeObject<T>(responseLine);
            }
            catch (OperationCanceledException)
            {
                Log.Warning("IPC: Read timeout ({Timeout}ms)", READ_TIMEOUT_MS);
                return default;
            }
        }
        catch (IOException ex)
        {
            Log.Debug(ex, "IPC: Pipe error");
            return default;
        }
        catch (Exception ex)
        {
            Log.Error(ex, "IPC: Error sending {Type}", commandType);
            return default;
        }
    }
}

/// <summary>
/// Response from SET_CONFIG command
/// </summary>
public class SetConfigResponse
{
    public bool Success { get; set; }
    public string? Error { get; set; }
}

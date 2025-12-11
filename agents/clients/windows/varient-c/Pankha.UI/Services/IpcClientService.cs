using System.IO;
using System.IO.Pipes;
using System.Text;
using Newtonsoft.Json;
using Pankha.WindowsAgent.Models.Ipc;
using Serilog;

namespace Pankha.UI.Services;

/// <summary>
/// Client service to communicate with the Windows Service via Named Pipes
/// </summary>
public class IpcClientService
{
    private const string PIPE_NAME = "PankhaAgent";
    private const int CONNECT_TIMEOUT_MS = 5000; // Increased timeout for reliability

    /// <summary>
    /// Send a request to the agent and await a response
    /// </summary>
    public async Task<T?> SendRequestAsync<T>(string commandType, object? payload = null, bool fastFail = false)
    {
        int timeout = fastFail ? 1000 : 3000;
        int maxAttempts = fastFail ? 1 : 5;
        const int MAX_TIMEOUT = 15000;

        for (int attempt = 1; attempt <= maxAttempts; attempt++)
        {
            try
            {
                using var client = new NamedPipeClientStream(".", PIPE_NAME, PipeDirection.InOut, PipeOptions.Asynchronous);

                // Try to connect
                try
                {
                    await client.ConnectAsync(timeout);
                }
                catch (TimeoutException)
                {
                    if (!fastFail)
                    {
                        Log.Warning("IPC: Connection timeout ({Timeout}ms) to {Pipe}. Attempt {Attempt}/{Max}", timeout, PIPE_NAME, attempt, maxAttempts);
                    }
                    
                    if (attempt == maxAttempts) return default;

                    // Exponential backoff
                    timeout = Math.Min(timeout * 2, MAX_TIMEOUT);
                    continue; // Retry
                }

                using var reader = new StreamReader(client, Encoding.UTF8, leaveOpen: true);
                using var writer = new StreamWriter(client, Encoding.UTF8, leaveOpen: true) { AutoFlush = true };

                // Send Request
                var request = new IpcMessage
                {
                    Type = commandType,
                    Payload = payload != null ? JsonConvert.SerializeObject(payload) : null
                };

                await writer.WriteLineAsync(JsonConvert.SerializeObject(request));

                // Await Response
                var responseLine = await reader.ReadLineAsync();
                if (string.IsNullOrEmpty(responseLine)) return default;

                return JsonConvert.DeserializeObject<T>(responseLine);
            }
            catch (Exception ex)
            {
                // If it's not a timeout (e.g. pipe broken during write), we log and fail. 
                // Retrying partial writes is risky unless idempotent. 
                // For "Pipe is broken" during connect phase (IOException), we could also retry.
                // Let's treat IOException during Connect same as Timeout?
                // For now, only explicit Timeout per user request.
                Log.Error(ex, "IPC: Error sending request {Type}", commandType);
                return default;
            }
        }
        return default;
    }

    /// <summary>
    /// Quick check status
    /// </summary>
    public async Task<AgentStatus?> GetStatusAsync()
    {
        // Use Fast Fail (short timeout, no retry) for status checks to assume disconnection quickly
        return await SendRequestAsync<AgentStatus>(IpcCommands.GET_STATUS, null, fastFail: true);
    }
}

using System.Net.WebSockets;
using System.Text;
using Newtonsoft.Json;
using Pankha.WindowsAgent.Hardware;
using Pankha.WindowsAgent.Models.Configuration;
using Pankha.WindowsAgent.Models.Messages;
using Microsoft.Extensions.Logging;

namespace Pankha.WindowsAgent.Core;

public class WebSocketClient
{
    private readonly AgentConfig _config;
    private readonly IHardwareMonitor _hardware;
    private readonly CommandHandler _commandHandler;
    private readonly ILogger<WebSocketClient> _logger;
    private ClientWebSocket? _ws;

    public WebSocketClient(AgentConfig config, IHardwareMonitor hardware, CommandHandler commandHandler, ILogger<WebSocketClient> logger)
    {
        _config = config;
        _hardware = hardware;
        _commandHandler = commandHandler;
        _logger = logger;
    }

    private int _reconnectAttempts = 0;
    private DateTime _lastMessageReceived = DateTime.UtcNow;
    private const int CONNECTION_HEALTH_TIMEOUT_SECS = 30;

    public async Task RunAsync(CancellationToken ct)
    {
        // Create a linked token source for internal cancellation (e.g. watchdog)
        using var internalCts = CancellationTokenSource.CreateLinkedTokenSource(ct);

        while (!internalCts.Token.IsCancellationRequested)
        {
            try
            {
                _ws = new ClientWebSocket();
                _ws.Options.KeepAliveInterval = TimeSpan.FromSeconds(30);
                
                _logger.LogInformation("Connecting to {Url}", _config.Backend.Url);
                await _ws.ConnectAsync(new Uri(_config.Backend.Url), internalCts.Token);
                
                _logger.LogInformation("Connected!");
                _reconnectAttempts = 0;
                _lastMessageReceived = DateTime.UtcNow;

                await SendRegister(internalCts.Token);

                // Run receive and send loops
                var receiveTask = ReceiveLoop(internalCts.Token);
                var sendTask = SendLoop(internalCts.Token);
                
                // Wait for either to complete (or fail)
                await Task.WhenAny(receiveTask, sendTask);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "WebSocket error");
            }
            finally
            {
                try { _ws?.Dispose(); } catch { }
            }

            if (!internalCts.Token.IsCancellationRequested)
            {
                var delay = CalculateReconnectDelay();
                _logger.LogInformation("Reconnecting in {Delay}ms (attempt {Attempt})", delay, _reconnectAttempts + 1);
                await Task.Delay(delay, internalCts.Token);
                _reconnectAttempts++;
            }
        }
    }

    private int CalculateReconnectDelay()
    {
        var baseDelay = _config.Backend.ReconnectInterval;
        return _reconnectAttempts switch
        {
            0 => baseDelay,
            1 => (int)(baseDelay * 1.4),
            2 => (int)(baseDelay * 2.0),
            _ => (int)(baseDelay * 3.0)
        };
    }

    private async Task ReceiveLoop(CancellationToken ct)
    {
        var buffer = new byte[8192];
        while (!ct.IsCancellationRequested && _ws?.State == WebSocketState.Open)
        {
            // Health check
            if ((DateTime.UtcNow - _lastMessageReceived).TotalSeconds > CONNECTION_HEALTH_TIMEOUT_SECS)
            {
                _logger.LogWarning("Connection health check failed (no message for 30s). Reconnecting...");
                break;
            }

            // Use a short timeout for ReceiveAsync to allow periodic health checks
            using var timeoutCts = new CancellationTokenSource(1000);
            using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(ct, timeoutCts.Token);

            try
            {
                var result = await _ws.ReceiveAsync(buffer, linkedCts.Token);
                _lastMessageReceived = DateTime.UtcNow;

                if (result.MessageType == WebSocketMessageType.Close) break;

                var json = Encoding.UTF8.GetString(buffer, 0, result.Count);
                var baseMsg = JsonConvert.DeserializeObject<BaseMessage>(json);

                if (baseMsg?.Type == "command")
                {
                    var cmd = JsonConvert.DeserializeObject<CommandMessage>(json);
                    if (cmd != null)
                    {
                        var response = await _commandHandler.HandleCommandAsync(cmd.Data.Type, cmd.Data.CommandId, cmd.Data.Payload);
                        await SendJson(response, ct);
                    }
                }
                else if (baseMsg?.Type == "ping")
                {
                    await SendJson(new { type = "pong" }, ct);
                }
            }
            catch (OperationCanceledException) when (timeoutCts.IsCancellationRequested)
            {
                // Timeout is expected, continue loop to check health
                continue;
            }
        }
    }

    private async Task SendJson(object obj, CancellationToken ct)
    {
        if (_ws?.State != WebSocketState.Open) return;
        var json = JsonConvert.SerializeObject(obj);
        var bytes = Encoding.UTF8.GetBytes(json);
        await _ws.SendAsync(bytes, WebSocketMessageType.Text, true, ct);
    }
}

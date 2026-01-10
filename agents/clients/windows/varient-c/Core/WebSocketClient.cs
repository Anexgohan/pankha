using System.Net.WebSockets;
using System.Text;
using Newtonsoft.Json;
using Pankha.WindowsAgent.Hardware;
using Pankha.WindowsAgent.Models;
using Pankha.WindowsAgent.Models.Configuration;
using Pankha.WindowsAgent.Models.Messages;
using Pankha.WindowsAgent.Services;
using Serilog;

namespace Pankha.WindowsAgent.Core;

/// <summary>
/// WebSocket client for communication with Pankha backend
/// </summary>
public class WebSocketClient : IDisposable
{
    private readonly AgentConfig _config;
    private readonly IHardwareMonitor _hardwareMonitor;
    private readonly ILogger _logger;
    private readonly CommandHandler _commandHandler;
    private readonly ConnectionWatchdog? _watchdog;

    private ClientWebSocket? _webSocket;
    private CancellationTokenSource? _cts;
    private Task? _receiveTask;
    private Task? _dataTask;

    private ConnectionState _connectionState = ConnectionState.Disconnected;
    private int _reconnectAttempts = 0;
    private DateTime _lastReconnectAttempt = DateTime.MinValue;
    private DateTime _lastMessageReceived = DateTime.UtcNow;

    // Connection health check: if no message for 30s, assume dead connection
    private const int CONNECTION_HEALTH_TIMEOUT_SECS = 30;

    public ConnectionState State => _connectionState;
    public bool IsConnected => _connectionState == ConnectionState.Connected;

    public WebSocketClient(
        AgentConfig config,
        IHardwareMonitor hardwareMonitor,
        ILogger logger,
        ConnectionWatchdog? watchdog = null)
    {
        _config = config;
        _hardwareMonitor = hardwareMonitor;
        _logger = logger;
        _commandHandler = new CommandHandler(hardwareMonitor, config, logger);
        _watchdog = watchdog;
    }

    /// <summary>
    /// Start the WebSocket client and maintain connection
    /// </summary>
    public async Task StartAsync(CancellationToken cancellationToken)
    {
        _cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);

        while (!_cts.Token.IsCancellationRequested)
        {
            try
            {
                await ConnectAsync(_cts.Token);

                if (IsConnected)
                {
                    // Start receive loop
                    _receiveTask = ReceiveLoop(_cts.Token);

                    // Start data transmission loop
                    _dataTask = DataTransmissionLoop(_cts.Token);

                    // Wait for either task to complete (disconnect)
                    await Task.WhenAny(_receiveTask, _dataTask);

                    _logger.Warning("WebSocket disconnected");
                    _connectionState = ConnectionState.Disconnected;
                    
                    // Explicitly report disconnect to watchdog
                    _watchdog?.ReportDisconnect();
                }
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.Error(ex, "Error in WebSocket client");
                _connectionState = ConnectionState.Error;
                _watchdog?.ReportDisconnect();
            }

            // Reconnection logic with exponential backoff
            if (!_cts.Token.IsCancellationRequested)
            {
                var delay = CalculateReconnectDelay();
                _logger.Information("Reconnecting in {Delay:F1}s (attempt {Attempt})", delay / 1000.0, _reconnectAttempts + 1);
                await Task.Delay(delay, _cts.Token);
            }
        }

        _logger.Information("WebSocket client stopped");
    }

    /// <summary>
    /// Connect to backend WebSocket server
    /// </summary>
    private async Task ConnectAsync(CancellationToken cancellationToken)
    {
        try
        {
            _connectionState = ConnectionState.Connecting;
            _logger.Information("Connecting to {Url}", _config.Backend.ServerUrl);

            _webSocket?.Dispose();
            _webSocket = new ClientWebSocket();
            _webSocket.Options.KeepAliveInterval = TimeSpan.FromSeconds(30);

            var uri = new Uri(_config.Backend.ServerUrl);
            await _webSocket.ConnectAsync(uri, cancellationToken);

            _connectionState = ConnectionState.Connected;
            _reconnectAttempts = 0;
            _lastMessageReceived = DateTime.UtcNow;
            _logger.Information("✅ WebSocket connected");

            // Notify watchdog of successful connection
            _watchdog?.ReportSuccessfulConnection();

            // Invalidate hardware cache on connection/reconnection to ensure fresh discovery
            _hardwareMonitor.InvalidateCache();

            // Send registration message
            await SendRegistrationAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            _reconnectAttempts++;
            _lastReconnectAttempt = DateTime.UtcNow;
            _connectionState = ConnectionState.Error;
            _logger.Error(ex, "Failed to connect to backend");
            _watchdog?.ReportDisconnect();
            throw;
        }
    }

    /// <summary>
    /// Manually trigger a configuration update (e.g. after config change)
    /// </summary>
    public async Task TriggerConfigurationUpdateAsync()
    {
        if (IsConnected)
        {
            await SendConfigUpdateAsync(CancellationToken.None);
        }
    }

    /// <summary>
    /// Send configuration update message to backend
    /// </summary>
    private async Task SendConfigUpdateAsync(CancellationToken cancellationToken)
    {
        try
        {
            _logger.Information("Sending configuration update...");

            var updateMessage = new
            {
                type = "updateConfig",
                data = new
                {
                    agentId = _config.Agent.Id,
                    config = new
                    {
                        update_interval = _config.Agent.UpdateInterval, // seconds
                        fan_step_percent = _config.Hardware.FanStepPercent,
                        hysteresis_temp = _config.Hardware.HysteresisTemp,
                        emergency_temp = _config.Hardware.EmergencyTemp,
                        log_level = _config.Agent.LogLevel.ToUpperInvariant(),
                        failsafe_speed = _config.Hardware.FailsafeSpeed,
                        enable_fan_control = _config.Hardware.EnableFanControl,
                        name = _config.Agent.Name
                    }
                }
            };

            await SendMessageAsync(updateMessage, cancellationToken);
            _logger.Information("Configuration update sent");
        }
        catch (Exception ex)
        {
            _logger.Error(ex, "Failed to send configuration update");
            throw;
        }
    }

    /// <summary>
    /// Send registration message to backend
    /// </summary>
    private async Task SendRegistrationAsync(CancellationToken cancellationToken)
    {
        try
        {
            _logger.Information("Sending registration message...");

            // Discover hardware for capabilities
            var sensors = await _hardwareMonitor.DiscoverSensorsAsync();
            var fans = await _hardwareMonitor.DiscoverFansAsync();

            var registerMessage = new RegisterMessage
            {
                Data = new RegisterData
                {
                    AgentId = _config.Agent.Id,
                    Name = _config.Agent.Name,
                    AgentVersion = Pankha.WindowsAgent.Platform.VersionHelper.GetVersion(),
                    UpdateInterval = _config.Agent.UpdateInterval * 1000, // seconds to ms
                    FanStepPercent = _config.Hardware.FanStepPercent,
                    FailsafeSpeed = _config.Hardware.FailsafeSpeed,
                    HysteresisTemp = _config.Hardware.HysteresisTemp,
                    EmergencyTemp = _config.Hardware.EmergencyTemp,
                    LogLevel = _config.Agent.LogLevel.ToUpperInvariant(),
                    Capabilities = new Capabilities
                    {
                        Sensors = sensors,
                        Fans = fans,
                        FanControl = _config.Hardware.EnableFanControl
                    }
                }
            };

            await SendMessageAsync(registerMessage, cancellationToken);
            _logger.Information("✅ Agent registered: {AgentId}", _config.Agent.Id);
        }
        catch (Exception ex)
        {
            _logger.Error(ex, "Failed to send registration");
            throw;
        }
    }

    /// <summary>
    /// Send data message with current sensor/fan readings
    /// </summary>
    private async Task SendDataMessageAsync(CancellationToken cancellationToken)
    {
        try
        {
            _logger.Verbose("Starting hardware data collection");

            // Update hardware readings
            await _hardwareMonitor.UpdateAsync();

            // Collect current data
            var sensors = await _hardwareMonitor.DiscoverSensorsAsync();
            _logger.Verbose("Collected {Count} sensors", sensors.Count);

            var fans = await _hardwareMonitor.DiscoverFansAsync();
            _logger.Verbose("Collected {Count} fans", fans.Count);

            var health = await _hardwareMonitor.GetSystemHealthAsync();
            _logger.Verbose("Collected system health info");

            var timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var dataMessage = new DataMessage
            {
                Data = new DataPayload
                {
                    AgentId = _config.Agent.Id,
                    Timestamp = timestamp,
                    Sensors = sensors,
                    Fans = fans,
                    SystemHealth = health
                }
            };

            _logger.Verbose("Sending WebSocket message (timestamp: {Timestamp})", timestamp);
            await SendMessageAsync(dataMessage, cancellationToken);
            _logger.Debug("Sent telemetry: {Sensors} sensors, {Fans} fans", sensors.Count, fans.Count);
        }
        catch (Exception ex)
        {
            _logger.Error(ex, "Failed to send data message");
        }
    }

    /// <summary>
    /// Send JSON message via WebSocket
    /// </summary>
    private async Task SendMessageAsync(object message, CancellationToken cancellationToken)
    {
        if (_webSocket?.State != WebSocketState.Open)
        {
            throw new InvalidOperationException("WebSocket is not connected");
        }

        var json = JsonConvert.SerializeObject(message);
        var bytes = Encoding.UTF8.GetBytes(json);
        var buffer = new ArraySegment<byte>(bytes);

        await _webSocket.SendAsync(buffer, WebSocketMessageType.Text, true, cancellationToken);
    }

    /// <summary>
    /// Receive loop for incoming messages with connection health monitoring
    /// </summary>
    private async Task ReceiveLoop(CancellationToken cancellationToken)
    {
        var buffer = new byte[8192];
        var bufferSegment = new ArraySegment<byte>(buffer);
        Task<WebSocketReceiveResult>? receiveTask = null;

        try
        {
            _logger.Debug("📨 ReceiveLoop started");
            while (_webSocket?.State == WebSocketState.Open && !cancellationToken.IsCancellationRequested)
            {
                // Heartbeat Check:
                // We use Task.WhenAny to wake up periodically (every 5s) even if no message arrives.
                // This allows us to check _webSocket.State. If it's still Open, it means the internal
                // Keep-Alive (ping/pong) is working, so the connection is healthy.

                // Only start a new receive task if the previous one completed (or hasn't started)
                if (receiveTask == null)
                {
                    receiveTask = _webSocket.ReceiveAsync(bufferSegment, cancellationToken);
                }

                var heartbeatTask = Task.Delay(5000, cancellationToken);

                var completedTask = await Task.WhenAny(receiveTask, heartbeatTask);

                if (completedTask == heartbeatTask)
                {
                    // Heartbeat interval elapsed
                    if (_webSocket.State == WebSocketState.Open)
                    {
                        // Connection is still open (internal Keep-Alive passed), so report health
                        _watchdog?.ReportSuccessfulConnection();
                    }
                    // Continue loop, keeping the existing receiveTask pending
                    continue; 
                }

                // Message received (receiveTask completed)
                var result = await receiveTask;
                receiveTask = null; // Reset for next iteration

                _lastMessageReceived = DateTime.UtcNow; // Update health timestamp
                _watchdog?.ReportSuccessfulConnection(); // Notify watchdog of healthy connection

                _logger.Debug("📬 Received: Type={Type}, Count={Count}, EndOfMessage={End}",
                    result.MessageType, result.Count, result.EndOfMessage);

                if (result.MessageType == WebSocketMessageType.Close)
                {
                    _logger.Warning("Server requested close: Status={Status}, Description={Description}",
                        result.CloseStatus, result.CloseStatusDescription);
                    await _webSocket.CloseAsync(WebSocketCloseStatus.NormalClosure, "Closing", CancellationToken.None);
                    break;
                }

                if (result.MessageType == WebSocketMessageType.Text)
                {
                    var json = Encoding.UTF8.GetString(buffer, 0, result.Count);
                    await HandleMessageAsync(json, cancellationToken);
                }
            }

            _logger.Warning("🛑 ReceiveLoop exited: Cancelled={Cancelled}, State={State}",
                cancellationToken.IsCancellationRequested, _webSocket?.State);
        }
        catch (OperationCanceledException)
        {
            _logger.Debug("ReceiveLoop cancelled (expected on shutdown)");
        }
        catch (WebSocketException ex)
        {
            _logger.Error(ex, "WebSocket error in receive loop");
        }
        catch (Exception ex)
        {
            _logger.Error(ex, "Unexpected error in receive loop");
        }
    }

    /// <summary>
    /// Data transmission loop - sends data periodically
    /// </summary>
    private async Task DataTransmissionLoop(CancellationToken cancellationToken)
    {
        try
        {
            _logger.Debug("🔄 DataTransmissionLoop started");
            while (!cancellationToken.IsCancellationRequested && _webSocket?.State == WebSocketState.Open)
            {
                await SendDataMessageAsync(cancellationToken);

                // IMPORTANT: Read interval from config on EACH iteration
                // This allows dynamic updates via setUpdateInterval command without restart
                var interval = TimeSpan.FromSeconds(_config.Agent.UpdateInterval);
                await Task.Delay(interval, cancellationToken);
            }

            _logger.Warning("🛑 DataTransmissionLoop exited: Cancelled={Cancelled}, State={State}",
                cancellationToken.IsCancellationRequested, _webSocket?.State);
        }
        catch (OperationCanceledException)
        {
            _logger.Debug("DataTransmissionLoop cancelled (expected on shutdown)");
        }
        catch (Exception ex)
        {
            _logger.Error(ex, "Error in data transmission loop");
        }
    }

    /// <summary>
    /// Handle incoming WebSocket message
    /// </summary>
    private async Task HandleMessageAsync(string json, CancellationToken cancellationToken)
    {
        try
        {
            _logger.Verbose("Received message: {Length} bytes", json.Length);

            var baseMessage = JsonConvert.DeserializeObject<BaseMessage>(json);

            if (baseMessage == null)
            {
                _logger.Warning("Received null message");
                return;
            }

            _logger.Verbose("Parsed message type: {Type}", baseMessage.Type);

            switch (baseMessage.Type)
            {
                case "registered":
                    _logger.Information("Registration confirmed by backend");
                    break;

                case "command":
                    var commandMessage = JsonConvert.DeserializeObject<CommandMessage>(json);
                    if (commandMessage != null)
                    {
                        await HandleCommandAsync(commandMessage, cancellationToken);
                    }
                    break;

                case "ping":
                    await SendMessageAsync(new { type = "pong" }, cancellationToken);
                    _logger.Verbose("Received keepalive ping/pong");
                    break;

                default:
                    _logger.Debug("Unknown message type: {Type}", baseMessage.Type);
                    break;
            }
        }
        catch (Exception ex)
        {
            _logger.Error(ex, "Error handling message: {Json}", json);
        }
    }

    /// <summary>
    /// Handle command from backend
    /// </summary>
    private async Task HandleCommandAsync(CommandMessage commandMessage, CancellationToken cancellationToken)
    {
        try
        {
            _logger.Debug("Processing command: {Type} (ID: {CommandId})",
                commandMessage.Data.Type, commandMessage.Data.CommandId);

            var response = await _commandHandler.HandleCommandAsync(
                commandMessage.Data.Type,
                commandMessage.Data.CommandId,
                commandMessage.Data.Payload);

            await SendMessageAsync(response, cancellationToken);

            _logger.Debug("Sent command response: {CommandId}, success: {Success}",
                response.CommandId, response.Success);
        }
        catch (Exception ex)
        {
            _logger.Error(ex, "Error executing command {CommandId}", commandMessage.Data.CommandId);

            var errorResponse = new CommandResponse
            {
                CommandId = commandMessage.Data.CommandId,
                Success = false,
                Error = ex.Message,
                Timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
            };

            await SendMessageAsync(errorResponse, cancellationToken);
        }
    }

    /// <summary>
    /// Calculate reconnect delay with exponential backoff
    /// Matches Linux agent pattern: max 15s for hardware safety
    /// </summary>
    private int CalculateReconnectDelay()
    {
        // Hardware-safe exponential backoff from Linux agent:
        // Attempt 0: 5s, Attempt 1: 7s, Attempt 2: 10s, Attempt 3+: 15s (capped)
        var baseDelay = (int)(_config.Backend.ReconnectInterval * 1000); // seconds to ms

        var delay = _reconnectAttempts switch
        {
            0 => baseDelay,                    // 5s (first retry)
            1 => (int)(baseDelay * 1.4),       // 7s (second retry)
            2 => (int)(baseDelay * 2.0),       // 10s (third retry)
            _ => (int)(baseDelay * 3.0)        // 15s (max - hardware safety)
        };

        // Increment and cap retry count at 3 to keep delay at 15s maximum
        _reconnectAttempts++;
        _reconnectAttempts = Math.Min(_reconnectAttempts, 3);

        return delay;
    }

    public void Dispose()
    {
        try
        {
            // Cancel operations if CTS is not already disposed
            if (_cts != null && !_cts.IsCancellationRequested)
            {
                _cts.Cancel();
            }
        }
        catch (ObjectDisposedException)
        {
            // CTS already disposed, ignore
        }

        // Wait for tasks to complete (with timeout for safety)
        try
        {
            _receiveTask?.Wait(TimeSpan.FromSeconds(5));
        }
        catch (AggregateException) { }  // Expected on cancellation

        try
        {
            _dataTask?.Wait(TimeSpan.FromSeconds(5));
        }
        catch (AggregateException) { }  // Expected on cancellation

        _webSocket?.Dispose();
        _cts?.Dispose();
    }
}

/// <summary>
/// WebSocket connection state
/// </summary>
public enum ConnectionState
{
    Disconnected,
    Connecting,
    Connected,
    Error
}

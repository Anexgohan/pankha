using System.Net.WebSockets;
using System.Text;
using Newtonsoft.Json;
using Pankha.WindowsAgent.Hardware;
using Pankha.WindowsAgent.Models;
using Pankha.WindowsAgent.Models.Configuration;
using Pankha.WindowsAgent.Models.Messages;
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

    private ClientWebSocket? _webSocket;
    private CancellationTokenSource? _cts;
    private Task? _receiveTask;
    private Task? _dataTask;

    private ConnectionState _connectionState = ConnectionState.Disconnected;
    private int _reconnectAttempts = 0;
    private DateTime _lastReconnectAttempt = DateTime.MinValue;

    public ConnectionState State => _connectionState;
    public bool IsConnected => _connectionState == ConnectionState.Connected;

    public WebSocketClient(AgentConfig config, IHardwareMonitor hardwareMonitor, ILogger logger)
    {
        _config = config;
        _hardwareMonitor = hardwareMonitor;
        _logger = logger;
        _commandHandler = new CommandHandler(hardwareMonitor, config, logger);
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
            }

            // Reconnection logic with exponential backoff
            if (!_cts.Token.IsCancellationRequested)
            {
                var delay = CalculateReconnectDelay();
                _logger.Information("Reconnecting in {Delay}ms (attempt {Attempt})", delay, _reconnectAttempts + 1);
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
            _logger.Information("Connecting to {Url}", _config.Backend.Url);

            _webSocket?.Dispose();
            _webSocket = new ClientWebSocket();
            _webSocket.Options.KeepAliveInterval = TimeSpan.FromSeconds(30);

            var uri = new Uri(_config.Backend.Url);
            await _webSocket.ConnectAsync(uri, cancellationToken);

            _connectionState = ConnectionState.Connected;
            _reconnectAttempts = 0;
            _logger.Information("✅ Connected to backend");

            // Send registration message
            await SendRegistrationAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            _reconnectAttempts++;
            _lastReconnectAttempt = DateTime.UtcNow;
            _connectionState = ConnectionState.Error;
            _logger.Error(ex, "Failed to connect to backend");
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
                    AgentId = _config.Agent.AgentId,
                    Name = _config.Agent.Name,
                    AgentVersion = "1.0.0-windows",
                    UpdateInterval = (int)(_config.Hardware.UpdateInterval * 1000), // seconds to ms
                    FilterDuplicateSensors = _config.Monitoring.FilterDuplicateSensors,
                    DuplicateSensorTolerance = _config.Monitoring.DuplicateSensorTolerance,
                    FanStepPercent = _config.Monitoring.FanStepPercent,
                    HysteresisTemp = _config.Monitoring.HysteresisTemp,
                    EmergencyTemp = _config.Hardware.EmergencyTemperature,
                    LogLevel = _config.Logging.LogLevel.ToUpperInvariant(),
                    Capabilities = new Capabilities
                    {
                        Sensors = sensors,
                        Fans = fans,
                        FanControl = _config.Hardware.EnableFanControl
                    }
                }
            };

            await SendMessageAsync(registerMessage, cancellationToken);
            _logger.Information("✅ Registration sent");
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
            // Update hardware readings
            await _hardwareMonitor.UpdateAsync();

            // Collect current data
            var sensors = await _hardwareMonitor.DiscoverSensorsAsync();
            var fans = await _hardwareMonitor.DiscoverFansAsync();
            var health = await _hardwareMonitor.GetSystemHealthAsync();

            var dataMessage = new DataMessage
            {
                Data = new DataPayload
                {
                    AgentId = _config.Agent.AgentId,
                    Timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                    Sensors = sensors,
                    Fans = fans,
                    SystemHealth = health
                }
            };

            await SendMessageAsync(dataMessage, cancellationToken);

            _logger.Debug("📊 Data sent: {Sensors} sensors, {Fans} fans", sensors.Count, fans.Count);
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
    /// Receive loop for incoming messages
    /// </summary>
    private async Task ReceiveLoop(CancellationToken cancellationToken)
    {
        var buffer = new byte[8192];

        try
        {
            while (_webSocket?.State == WebSocketState.Open && !cancellationToken.IsCancellationRequested)
            {
                var result = await _webSocket.ReceiveAsync(new ArraySegment<byte>(buffer), cancellationToken);

                if (result.MessageType == WebSocketMessageType.Close)
                {
                    _logger.Warning("Server requested close");
                    await _webSocket.CloseAsync(WebSocketCloseStatus.NormalClosure, "Closing", CancellationToken.None);
                    break;
                }

                if (result.MessageType == WebSocketMessageType.Text)
                {
                    var json = Encoding.UTF8.GetString(buffer, 0, result.Count);
                    await HandleMessageAsync(json, cancellationToken);
                }
            }
        }
        catch (OperationCanceledException)
        {
            // Expected on shutdown
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
        var interval = TimeSpan.FromSeconds(_config.Hardware.UpdateInterval);

        try
        {
            while (!cancellationToken.IsCancellationRequested && _webSocket?.State == WebSocketState.Open)
            {
                await SendDataMessageAsync(cancellationToken);
                await Task.Delay(interval, cancellationToken);
            }
        }
        catch (OperationCanceledException)
        {
            // Expected on shutdown
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
            var baseMessage = JsonConvert.DeserializeObject<BaseMessage>(json);

            if (baseMessage == null)
            {
                _logger.Warning("Received null message");
                return;
            }

            _logger.Debug("Received message: {Type}", baseMessage.Type);

            switch (baseMessage.Type)
            {
                case "registered":
                    _logger.Information("✅ Registration confirmed by backend");
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
            _logger.Information("Executing command: {Type} (ID: {CommandId})",
                commandMessage.Data.Type, commandMessage.Data.CommandId);

            var response = await _commandHandler.HandleCommandAsync(
                commandMessage.Data.Type,
                commandMessage.Data.CommandId,
                commandMessage.Data.Payload);

            await SendMessageAsync(response, cancellationToken);

            _logger.Information("Command {CommandId} completed: {Success}",
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
    /// </summary>
    private int CalculateReconnectDelay()
    {
        // Exponential backoff: 5s → 7s → 10s → 15s (max)
        var baseDelay = _config.Backend.ReconnectInterval;

        return _reconnectAttempts switch
        {
            0 => baseDelay,
            1 => (int)(baseDelay * 1.4),
            2 => (int)(baseDelay * 2.0),
            _ => (int)(baseDelay * 3.0)
        };
    }

    public void Dispose()
    {
        _cts?.Cancel();
        _receiveTask?.Wait(TimeSpan.FromSeconds(5));
        _dataTask?.Wait(TimeSpan.FromSeconds(5));
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

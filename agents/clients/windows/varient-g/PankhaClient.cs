using System;
using System.Collections.Generic;
using System.Net.WebSockets;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;
using Websocket.Client;

namespace PankhaAgent
{
    public class PankhaClient
    {
        private readonly ILogger<PankhaClient> _logger;
        private readonly string _url;
        private WebsocketClient _client;
        private readonly HardwareMonitor _hardware;
        private readonly string _agentId;
        private readonly string _agentName;

        // Delta tracking
        private Dictionary<string, float> _prevSensors = new Dictionary<string, float>();
        private Dictionary<string, int> _prevFans = new Dictionary<string, int>();
        private SystemHealth _prevHealth;

        public PankhaClient(string url, HardwareMonitor hardware, ILogger<PankhaClient> logger)
        {
            _url = url;
            _hardware = hardware;
            _logger = logger;
            _agentName = Environment.MachineName;
            
            // Persist Agent ID
            string configPath = @"C:\ProgramData\PankhaAgent\config.json";
            try 
            {
                if (System.IO.File.Exists(configPath))
                {
                    var json = System.IO.File.ReadAllText(configPath);
                    using var doc = JsonDocument.Parse(json);
                    if (doc.RootElement.TryGetProperty("agentId", out var idProp))
                    {
                        _agentId = idProp.GetString();
                        _logger.LogInformation($"Loaded existing Agent ID: {_agentId}");
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to load config, generating new ID");
            }

            if (string.IsNullOrEmpty(_agentId))
            {
                _agentId = $"windows-{_agentName}-{Guid.NewGuid().ToString().Substring(0, 8)}";
                try
                {
                    var config = new { agentId = _agentId };
                    System.IO.File.WriteAllText(configPath, JsonSerializer.Serialize(config));
                    _logger.LogInformation($"Generated and saved new Agent ID: {_agentId}");
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Failed to save config");
                }
            }
        }

        public async Task StartAsync()
        {
            var factory = new Func<ClientWebSocket>(() => new ClientWebSocket());
            _client = new WebsocketClient(new Uri(_url), factory);
            _client.ReconnectTimeout = TimeSpan.FromMinutes(5); // Increased timeout to avoid frequent reconnections
            _client.ReconnectionHappened.Subscribe(info =>
            {
                _logger.LogInformation($"Reconnection happened, type: {info.Type}");
                SendRegister();
            });

            _client.MessageReceived.Subscribe(msg =>
            {
                HandleMessage(msg.Text);
            });

            await _client.Start();
        }

        private void SendRegister()
        {
            var registerPayload = new
            {
                agentId = _agentId,
                name = _agentName,
                platform = "windows",
                capabilities = new
                {
                    fanControl = true,
                    sensorMonitoring = true
                },
                config = new
                {
                    update_interval = 3.0,
                    log_level = "INFO"
                }
            };

            var msg = new
            {
                type = "register",
                data = registerPayload
            };

            var json = JsonSerializer.Serialize(msg);
            _client.Send(json);
            _logger.LogInformation("Sent registration");
        }

        public void SendUpdate()
        {
            if (!_client.IsRunning) return;

            var sensors = _hardware.GetSensors();
            var fans = _hardware.GetFans();
            var health = _hardware.GetSystemHealth();

            var updatePayload = new
            {
                agentId = _agentId,
                timestamp = DateTime.UtcNow.ToString("o"),
                sensors = sensors.Select(s => new
                {
                    id = s.Id,
                    name = s.Name,
                    temperature = s.Temperature,
                    type = s.Type,
                    chip = s.Chip,
                    source = s.Source
                }),
                fans = fans.Select(f => new
                {
                    id = f.Id,
                    name = f.Name,
                    rpm = f.Rpm,
                    speed = f.Speed,
                    targetSpeed = f.TargetSpeed,
                    status = f.Status,
                    has_pwm_control = f.HasPwmControl
                }),
                systemHealth = new
                {
                    cpuUsage = health.CpuUsage,
                    memoryUsage = health.MemoryUsage,
                    agentUptime = health.AgentUptime
                }
            };

            var msg = new
            {
                type = "data",
                data = updatePayload
            };

            var json = JsonSerializer.Serialize(msg);
            _client.Send(json);
        }

        private void HandleMessage(string message)
        {
            _logger.LogInformation($"Received WebSocket Message: {message}");
            try
            {
                using var doc = JsonDocument.Parse(message);
                var root = doc.RootElement;
                if (root.TryGetProperty("type", out var typeProp))
                {
                    var type = typeProp.GetString();
                    if (type == "command")
                    {
                        // The command details are inside the 'data' property
                        var data = root.GetProperty("data");
                        var cmd = data.GetProperty("type").GetString();
                        string commandId = data.GetProperty("commandId").GetString();
                        var payload = data.GetProperty("payload");
                        
                        bool success = true;
                        string error = null;

                        try 
                        {
                            if (cmd == "setFanSpeed")
                            {
                                var fanId = payload.GetProperty("fanId").GetString();
                                var speed = payload.GetProperty("speed").GetInt32();
                                _hardware.SetFanSpeed(fanId, speed);
                            }
                            else if (cmd == "setProfile")
                            {
                                var profileName = payload.GetProperty("profileName").GetString();
                                _logger.LogInformation($"Received setProfile command: {profileName} (Handled by backend)");
                                // Agent doesn't need to do anything, backend drives the fans.
                                // Just acknowledge success.
                            }
                            else if (cmd == "setEmergencyTemp")
                            {
                                var temp = payload.GetProperty("temp").GetDouble();
                                _logger.LogInformation($"Setting emergency temp to {temp}");
                                // TODO: Update local config
                            }
                            else if (cmd == "setUpdateInterval")
                            {
                                var interval = payload.GetProperty("interval").GetDouble();
                                _logger.LogInformation($"Setting update interval to {interval}");
                                // TODO: Update local config
                            }
                            else if (cmd == "setLogLevel")
                            {
                                var level = payload.GetProperty("level").GetString();
                                _logger.LogInformation($"Setting log level to {level}");
                                // TODO: Update local config
                            }
                            else if (cmd == "setSensorDeduplication")
                            {
                                var enabled = payload.GetProperty("enabled").GetBoolean();
                                _logger.LogInformation($"Setting sensor deduplication to {enabled}");
                                // TODO: Update local config
                            }
                            else if (cmd == "setSensorTolerance")
                            {
                                var tolerance = payload.GetProperty("tolerance").GetDouble();
                                _logger.LogInformation($"Setting sensor tolerance to {tolerance}");
                                // TODO: Update local config
                            }
                            else if (cmd == "setFanStep")
                            {
                                var step = payload.GetProperty("step").GetInt32();
                                _logger.LogInformation($"Setting fan step to {step}");
                                // TODO: Update local config
                            }
                            else if (cmd == "setHysteresis")
                            {
                                var hysteresis = payload.GetProperty("hysteresis").GetDouble();
                                _logger.LogInformation($"Setting hysteresis to {hysteresis}");
                                // TODO: Update local config
                            }
                            else 
                            {
                                _logger.LogWarning($"Unknown command: {cmd}");
                                success = false;
                                error = "Unknown command";
                            }
                        }
                        catch (Exception ex)
                        {
                            _logger.LogError(ex, $"Error executing command {cmd}");
                            success = false;
                            error = ex.Message;
                        }

                        // Send response
                        var response = new
                        {
                            type = "commandResponse",
                            commandId = commandId,
                            success = success,
                            error = error,
                            data = new { }
                        };
                        _client.Send(JsonSerializer.Serialize(response));
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error handling message");
            }
        }
    }
}

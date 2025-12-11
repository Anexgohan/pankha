using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Windows;
using System.Windows.Input;
using System.Windows.Media;
using Newtonsoft.Json;
using Pankha.UI.Services;
using Pankha.WindowsAgent.Models.Configuration;
using Pankha.WindowsAgent.Models.Ipc;

namespace Pankha.UI;

public class MainViewModel : INotifyPropertyChanged
{
    private readonly IpcClientService _ipcService;
    private AgentConfig? _currentConfig;

    // Form fields
    private string _agentName = "";
    private string _agentId = "";
    private string _backendUrl = "";
    private string _reconnectInterval = "";
    private bool _enableFanControl;
    private string _updateInterval = "";
    private string _emergencyTemp = "";
    private string _statusMessage = "";
    private Brush _statusColor = Brushes.Black;

    public string AgentName { get => _agentName; set { _agentName = value; OnPropertyChanged(); } }
    public string AgentId { get => _agentId; set { _agentId = value; OnPropertyChanged(); } }
    public string BackendUrl { get => _backendUrl; set { _backendUrl = value; OnPropertyChanged(); } }
    public string ReconnectInterval { get => _reconnectInterval; set { _reconnectInterval = value; OnPropertyChanged(); } }
    public bool EnableFanControl { get => _enableFanControl; set { _enableFanControl = value; OnPropertyChanged(); } }
    public string UpdateInterval { get => _updateInterval; set { _updateInterval = value; OnPropertyChanged(); } }
    public string EmergencyTemp { get => _emergencyTemp; set { _emergencyTemp = value; OnPropertyChanged(); } }
    public string StatusMessage { get => _statusMessage; set { _statusMessage = value; OnPropertyChanged(); } }
    public Brush StatusColor { get => _statusColor; set { _statusColor = value; OnPropertyChanged(); } }

    public ICommand SaveCommand { get; }
    public ICommand CancelCommand { get; }

    public MainViewModel()
    {
        _ipcService = new IpcClientService();
        SaveCommand = new RelayCommand(ExecuteSave);
        CancelCommand = new RelayCommand(ExecuteCancel);
        
        // Load initial config
        _ = LoadConfigAsync();
    }

    private async Task LoadConfigAsync()
    {
        StatusMessage = "Loading configuration...";
        StatusColor = Brushes.Gray;

        _currentConfig = await _ipcService.SendRequestAsync<AgentConfig>(IpcCommands.GET_CONFIG);

        if (_currentConfig != null)
        {
            // Map Config to UI
            AgentName = _currentConfig.Agent.Name;
            AgentId = _currentConfig.Agent.AgentId;
            BackendUrl = _currentConfig.Backend.Url;
            ReconnectInterval = _currentConfig.Backend.ReconnectInterval.ToString();
            EnableFanControl = _currentConfig.Hardware.EnableFanControl;
            UpdateInterval = _currentConfig.Hardware.UpdateInterval.ToString();
            EmergencyTemp = _currentConfig.Hardware.EmergencyTemperature.ToString();

            StatusMessage = "";
        }
        else
        {
            StatusMessage = "Failed to load config (Is service running?)";
            StatusColor = Brushes.Red;
        }
    }

    private async void ExecuteSave(object? obj)
    {
        if (_currentConfig == null) return;

        try
        {
            StatusMessage = "Saving...";
            StatusColor = Brushes.Blue;

            // Map UI back to Config
            _currentConfig.Agent.Name = AgentName;
            _currentConfig.Backend.Url = BackendUrl;
            if (int.TryParse(ReconnectInterval, out var reconnect)) _currentConfig.Backend.ReconnectInterval = reconnect;
            _currentConfig.Hardware.EnableFanControl = EnableFanControl;
            if (double.TryParse(UpdateInterval, out var update)) _currentConfig.Hardware.UpdateInterval = update;
            if (int.TryParse(EmergencyTemp, out var temp)) _currentConfig.Hardware.EmergencyTemperature = temp;

            // Send to Service
            // We send the FULL config object
            var payload = JsonConvert.SerializeObject(_currentConfig);
            // Wait, our generic SendRequest handles serialization of the payload object itself
            // But SET_CONFIG expects the payload to NOT be double serialized if IpcMessage handles it?
            // Re-check IpcClientService logic:
            // "Payload = payload != null ? JsonConvert.SerializeObject(payload) : null"
            // So if I pass _currentConfig, it becomes a JSON string inside Payload property.
            // On Server side: "JsonConvert.DeserializeObject<AgentConfig>(request.Payload)"
            // Yes, this matches.

            // Wait, IPC Client returns T. For SET_CONFIG, we expect a simple success/fail object?
            // Let's define a simple response type or use dynamic/object
            
            // Re-using a simple anonymous type for receive might fail with System.Text.Json or Newtonsoft if strict?
            // Let's assume server returns { Success = true }
             dynamic? response = await _ipcService.SendRequestAsync<dynamic>(IpcCommands.SET_CONFIG, _currentConfig);

             if (response != null && (bool)response.Success)
             {
                 StatusMessage = "Configuration Saved Successfully!";
                 StatusColor = Brushes.Green;
                 await Task.Delay(2000);
                 StatusMessage = "";
             }
             else
             {
                 StatusMessage = $"Save Failed: {response?.Error ?? "Unknown error"}";
                 StatusColor = Brushes.Red;
             }
        }
        catch (Exception ex)
        {
            StatusMessage = $"Error: {ex.Message}";
            StatusColor = Brushes.Red;
        }
    }
    
    private void ExecuteCancel(object? obj)
    {
        Application.Current.MainWindow?.Hide();
    }

    public event PropertyChangedEventHandler? PropertyChanged;
    protected void OnPropertyChanged([CallerMemberName] string? name = null)
        => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}

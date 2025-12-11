using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Windows;
using System.Windows.Input;
using Hardcodet.Wpf.TaskbarNotification;
using Pankha.UI.Services;
using Pankha.WindowsAgent.Models.Ipc;

namespace Pankha.UI;

public class TrayViewModel : INotifyPropertyChanged
{
    private readonly IpcClientService _ipcService;
    private string _statusText = "Initializing...";
    private string _iconSource = "/Assets/tray-disconnected.ico"; // Fallback/Default
    private bool _isConnected = false;

    public string StatusText
    {
        get => _statusText;
        set { _statusText = value; OnPropertyChanged(); }
    }
    
    // Commands
    public ICommand ShowWindowCommand { get; }
    public ICommand ExitCommand { get; }

    public TrayViewModel()
    {
        _ipcService = new IpcClientService();
        ShowWindowCommand = new RelayCommand(ExecuteShowWindow);
        ExitCommand = new RelayCommand(ExecuteExit);

        // Start Polling Loop on a Background Thread to avoid blocking UI during startup or IPC
        Task.Run(RunPollingLoopAsync);
    }

    private async Task RunPollingLoopAsync()
    {
        while (true) // TODO: Add CancellationToken if we want clean exit support
        {
            try
            {
                // Verify IPC status on background thread
                var status = await _ipcService.GetStatusAsync().ConfigureAwait(false);

                // Dispatch to UI thread only for updates
                Application.Current.Dispatcher.Invoke(() =>
                {
                    if (status != null)
                    {
                        if (!_isConnected)
                        {
                             _isConnected = true;
                             _iconSource = "/Assets/tray-connected.ico"; // Example
                        }
                        StatusText = $"Pankha Agent: Connected\nSensors: {status.SensorsDiscovered}\nFans: {status.FansDiscovered}";
                    }
                    else
                    {
                        if (_isConnected)
                        {
                            _isConnected = false;
                            _iconSource = "/Assets/tray-disconnected.ico";
                        }
                        StatusText = "Pankha Agent: Disconnected (Service not running?)";
                    }
                });
            }
            catch(Exception)
            {
                // Swallow errors in loop to keep it alive
            }

            // Wait 2 seconds before next check
            await Task.Delay(2000).ConfigureAwait(false);
        }
    }

    private void ExecuteShowWindow(object? obj)
    {
        var mainWindow = Application.Current.MainWindow;
        if (mainWindow != null)
        {
            if (mainWindow.Visibility == Visibility.Visible)
            {
                mainWindow.Hide();
            }
            else
            {
                mainWindow.Show();
                mainWindow.Activate();
            }
        }
    }

    private void ExecuteExit(object? obj)
    {
        Application.Current.Shutdown();
    }

    public event PropertyChangedEventHandler? PropertyChanged;
    protected void OnPropertyChanged([CallerMemberName] string? name = null)
        => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}

// Simple RelayCommand implementation
public class RelayCommand : ICommand
{
    private readonly Action<object?> _execute;
    public RelayCommand(Action<object?> execute) => _execute = execute;
    public bool CanExecute(object? parameter) => true;
    public void Execute(object? parameter) => _execute(parameter);
    public event EventHandler? CanExecuteChanged;
}

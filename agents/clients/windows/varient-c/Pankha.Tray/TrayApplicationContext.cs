using Pankha.Tray.Forms;
using Pankha.Tray.Services;
using Pankha.WindowsAgent.Models.Ipc;
using Serilog;
using System.Diagnostics;

namespace Pankha.Tray;

/// <summary>
/// Main application context - manages the system tray icon and forms
/// </summary>
public class TrayApplicationContext : ApplicationContext
{
    private readonly NativeNotifyIcon _nativeIcon;
    private readonly IpcClient _ipcClient;
    private readonly System.Windows.Forms.Timer _pollTimer;
    private readonly ContextMenuStrip _contextMenu;

    // Forms (created on demand)
    private StatusForm? _statusForm;
    private ConfigForm? _configForm;
    private ToolTipForm? _customTooltip;

    // State
    private bool _isConnected = false;
    private bool _hasPromptedToStartService = false;
    private AgentStatus? _lastStatus;
    private Icon _connectedIcon = null!;
    private Icon _disconnectedIcon = null!;
    private System.Windows.Forms.Timer? _tooltipShowTimer;

    // Menu items that need state updates
    private ToolStripMenuItem _statusHeaderItem = null!;

    public TrayApplicationContext()
    {
        _ipcClient = new IpcClient();
        
        // Cache icons
        _disconnectedIcon = GetDisconnectedIcon();
        _connectedIcon = GetConnectedIcon();

        // Build context menu
        _contextMenu = BuildContextMenu();

        // Create native notify icon with Shell API NOTIFYICON_VERSION_4
        _nativeIcon = new NativeNotifyIcon(_disconnectedIcon, "Pankha Agent: Initializing...");
        
        // Wire up events
        _nativeIcon.LeftClick += () => { _customTooltip?.Hide(); ShowStatusForm(); };
        _nativeIcon.DoubleClick += () => ShowConfigForm();
        _nativeIcon.RightClick += (pos) => _contextMenu.Show(pos);
        _nativeIcon.PopupOpen += OnTrayPopupOpen;
        _nativeIcon.PopupClose += OnTrayPopupClose;

        // Start polling timer (every 2 seconds)
        _pollTimer = new System.Windows.Forms.Timer { Interval = 2000 };
        _pollTimer.Tick += OnPollTimerTick;
        _pollTimer.Start();

        Log.Information("Tray application initialized, starting initial poll...");

        // Initial poll (fire and forget, but log errors)
        _ = Task.Run(async () =>
        {
            try
            {
                await PollStatusAsync();
            }
            catch (Exception ex)
            {
                Log.Error(ex, "Initial poll failed");
            }
        });
    }

    private async void OnPollTimerTick(object? sender, EventArgs e)
    {
        try
        {
            await PollStatusAsync();
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Poll timer tick failed");
        }
    }

    private ContextMenuStrip BuildContextMenu()
    {
        var menu = new ContextMenuStrip();

        // Header items (status display)
        _statusHeaderItem = new ToolStripMenuItem("Pankha Agent") { Enabled = false };
        menu.Items.Add(_statusHeaderItem);
        menu.Items.Add(new ToolStripSeparator());

        // Action items
        var statusItem = new ToolStripMenuItem("Status...", null, (s, e) => ShowStatusForm());
        var configItem = new ToolStripMenuItem("Configure...", null, (s, e) => ShowConfigForm()) { Font = new Font(menu.Font, FontStyle.Bold) };
        var logsItem = new ToolStripMenuItem("View Logs", null, (s, e) => OpenLogsFolder());

        menu.Items.Add(statusItem);
        menu.Items.Add(configItem);
        menu.Items.Add(logsItem);
        menu.Items.Add(new ToolStripSeparator());

        // Service control items
        var startItem = new ToolStripMenuItem("Start Service", null, (s, e) => RunServiceCommand("--start"));
        var stopItem = new ToolStripMenuItem("Stop Service", null, (s, e) => RunServiceCommand("--stop"));
        var restartItem = new ToolStripMenuItem("Restart Service", null, (s, e) => RunServiceCommand("--restart"));

        menu.Items.Add(startItem);
        menu.Items.Add(stopItem);
        menu.Items.Add(restartItem);
        menu.Items.Add(new ToolStripSeparator());

        // Exit
        var exitItem = new ToolStripMenuItem("Exit", null, (s, e) => ExitApplication());
        menu.Items.Add(exitItem);

        return menu;
    }

    private async Task PollStatusAsync()
    {
        try
        {
            Log.Debug("Poll: Starting status check...");
            var status = await _ipcClient.GetStatusAsync();
            Log.Debug("Poll: Got status result: {HasStatus}", status != null);

            if (status != null)
            {
                _lastStatus = status;

                if (!_isConnected)
                {
                    _isConnected = true;
                    _nativeIcon.UpdateIcon(_connectedIcon);
                    Log.Information("Connected to agent service");
                }

                // Clear default tooltip (we use custom ToolTipForm)
                _nativeIcon.UpdateTooltip("");
                _statusHeaderItem.Text = $"Pankha Agent: Connected";
                
                // Update custom tooltip
                _customTooltip?.UpdateStatus(status);
            }
            else
            {
                if (_isConnected)
                {
                    _isConnected = false;
                    _nativeIcon.UpdateIcon(_disconnectedIcon);
                    Log.Warning("Lost connection to agent service");
                }

                _nativeIcon.UpdateTooltip("Pankha: Disconnected");
                _statusHeaderItem.Text = "Pankha Agent: Disconnected";
                _lastStatus = null;
                
                // Update custom tooltip
                _customTooltip?.UpdateStatus(null);
                
                // Prompt to start service on first failure
                if (!_hasPromptedToStartService)
                {
                    _hasPromptedToStartService = true;
                    PromptToStartService();
                }
            }
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Error polling status");
        }
    }

    private void OnTrayPopupOpen()
    {
        // Start timer for delayed tooltip show (prevents flash on quick mouse pass)
        if (_tooltipShowTimer == null)
        {
            _tooltipShowTimer = new System.Windows.Forms.Timer { Interval = 150 };
            _tooltipShowTimer.Tick += OnTooltipShowTimerTick;
        }
        
        // Reset and start the timer
        _tooltipShowTimer.Stop();
        _tooltipShowTimer.Start();
    }
    
    private void OnTooltipShowTimerTick(object? sender, EventArgs e)
    {
        // Timer fired - show tooltip now (we're on UI thread)
        _tooltipShowTimer?.Stop();
        
        if (_customTooltip == null)
        {
            _customTooltip = new ToolTipForm();
        }
        
        _customTooltip.UpdateStatus(_lastStatus);
        if (!_customTooltip.Visible)
        {
            _customTooltip.ShowAt(Cursor.Position);
        }
    }
    
    private void OnTrayPopupClose()
    {
        // Cancel pending tooltip show
        _tooltipShowTimer?.Stop();
        
        // Check if mouse moved onto tooltip itself - if so, don't hide
        if (_customTooltip != null && _customTooltip.Visible)
        {
            if (!_customTooltip.Bounds.Contains(Cursor.Position))
            {
                _customTooltip.Hide();
            }
        }
    }

    private void ShowStatusForm()
    {
        if (_statusForm == null || _statusForm.IsDisposed)
        {
            _statusForm = new StatusForm(_ipcClient);
        }

        _statusForm.Show();
        _statusForm.BringToFront();
        _statusForm.Activate();
    }

    private void ShowConfigForm()
    {
        if (_configForm == null || _configForm.IsDisposed)
        {
            _configForm = new ConfigForm(_ipcClient);
        }

        _configForm.Show();
        _configForm.BringToFront();
        _configForm.Activate();
    }

    private void OpenLogsFolder()
    {
        try
        {
            // Use --logs follow command via RunServiceCommand logic
            // But we want to run it as a standalone client command, not a service command.
            // Actually, we can reuse the agent executable finding logic.
            
            string trayDir = Path.GetDirectoryName(Application.ExecutablePath) ?? "";
            string agentExe = Path.Combine(trayDir, "pankha-agent.exe");

            if (!File.Exists(agentExe))
            {
                agentExe = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
                    "Pankha", "pankha-agent.exe");
            }

            if (File.Exists(agentExe))
            {
                 var psi = new ProcessStartInfo
                 {
                     FileName = agentExe,
                     Arguments = "--logs follow",
                     UseShellExecute = true // Opens new console window
                 };
                 Process.Start(psi);
            }
            else
            {
                MessageBox.Show("Agent executable not found. Cannot view logs.", "Pankha Tray",
                    MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Failed to open logs viewer");
            MessageBox.Show($"Error: {ex.Message}", "Pankha Tray",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private void PromptToStartService()
    {
        // Show on UI thread
        if (InvokeRequired())
        {
            System.Windows.Forms.Application.OpenForms[0]?.BeginInvoke(new Action(PromptToStartService));
            return;
        }
        
        var result = MessageBox.Show(
            "Pankha Agent service is not running.\n\nWould you like to start it now?",
            "Pankha Fan Control",
            MessageBoxButtons.YesNo,
            MessageBoxIcon.Question);
            
        if (result == DialogResult.Yes)
        {
            RunServiceCommand("--start");
        }
    }
    
    private bool InvokeRequired()
    {
        return System.Windows.Forms.Application.OpenForms.Count > 0 && 
               System.Windows.Forms.Application.OpenForms[0]?.InvokeRequired == true;
    }

    private void RunServiceCommand(string command)
    {
        try
        {
            // Find agent executable (same directory as tray app, or in install location)
            string trayDir = Path.GetDirectoryName(Application.ExecutablePath) ?? "";
            string agentExe = Path.Combine(trayDir, "pankha-agent.exe");

            if (!File.Exists(agentExe))
            {
                // Try default install location
                agentExe = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
                    "Pankha", "pankha-agent.exe");
            }

            if (!File.Exists(agentExe))
            {
                MessageBox.Show("Agent executable not found.", "Pankha Tray",
                    MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            Log.Information("Running service command: {Command}", command);

            var psi = new ProcessStartInfo
            {
                FileName = agentExe,
                Arguments = command,
                Verb = "runas", // Request admin elevation
                UseShellExecute = true
            };

            Process.Start(psi);
        }
        catch (System.ComponentModel.Win32Exception)
        {
            // User cancelled UAC
            Log.Information("User cancelled UAC prompt for {Command}", command);
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Failed to run service command {Command}", command);
            MessageBox.Show($"Error: {ex.Message}", "Pankha Tray",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private void ExitApplication()
    {
        Log.Information("Exit requested by user");
        _pollTimer.Stop();
        _nativeIcon.Dispose(); // Remove tray icon
        Application.Exit();
    }

    private Icon GetConnectedIcon()
    {
        // Extract icon from executable itself (it has the correct embedded icon)
        try 
        {
             return Icon.ExtractAssociatedIcon(Application.ExecutablePath) ?? SystemIcons.Application;
        }
        catch
        {
             return SystemIcons.Application;
        }
    }

    private Icon GetDisconnectedIcon()
    {
         // For disconnected, maybe use a Warning icon, or we could grayscale the main icon?
         // For now, let's keep the main icon but maybe add a tooltip?
         // Or Stick to SystemIcons.Warning to clearly indicate "Not Running"
        return SystemIcons.Warning;
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _pollTimer?.Dispose();
            _nativeIcon?.Dispose();
            _statusForm?.Dispose();
            _configForm?.Dispose();
            _contextMenu?.Dispose();
            _customTooltip?.Dispose();
        }
        base.Dispose(disposing);
    }
}

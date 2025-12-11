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
    private readonly NotifyIcon _notifyIcon;
    private readonly IpcClient _ipcClient;
    private readonly System.Windows.Forms.Timer _pollTimer;
    private readonly ContextMenuStrip _contextMenu;

    // Forms (created on demand)
    private StatusForm? _statusForm;
    private ConfigForm? _configForm;

    // State
    private bool _isConnected = false;
    private AgentStatus? _lastStatus;

    // Menu items that need state updates
    private ToolStripMenuItem _statusHeaderItem = null!;

    public TrayApplicationContext()
    {
        _ipcClient = new IpcClient();

        // Build context menu
        _contextMenu = BuildContextMenu();

        // Create notify icon
        _notifyIcon = new NotifyIcon
        {
            Icon = GetDisconnectedIcon(),
            Text = "Pankha Agent: Initializing...",
            ContextMenuStrip = _contextMenu,
            Visible = true
        };

        // Wire up click events
        _notifyIcon.MouseClick += OnNotifyIconClick;
        _notifyIcon.DoubleClick += (s, e) => ShowConfigForm();

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
                    _notifyIcon.Icon = GetConnectedIcon();
                    Log.Information("Connected to agent service");
                }

                _notifyIcon.Text = $"Pankha: Connected\nSensors: {status.SensorsDiscovered} | Fans: {status.FansDiscovered}";
                _statusHeaderItem.Text = $"Pankha Agent: Connected";
            }
            else
            {
                if (_isConnected)
                {
                    _isConnected = false;
                    _notifyIcon.Icon = GetDisconnectedIcon();
                    Log.Warning("Lost connection to agent service");
                }

                _notifyIcon.Text = "Pankha: Disconnected (Service not running?)";
                _statusHeaderItem.Text = "Pankha Agent: Disconnected";
                _lastStatus = null;
            }
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Error polling status");
        }
    }

    private void OnNotifyIconClick(object? sender, MouseEventArgs e)
    {
        if (e.Button == MouseButtons.Left)
        {
            ShowStatusForm();
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
            // Try common app data first
            string logDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
                "Pankha Fan Control", "logs");

            if (!Directory.Exists(logDir))
            {
                // Fallback to install directory logs
                string installDir = Path.GetDirectoryName(Application.ExecutablePath) ?? "";
                logDir = Path.Combine(installDir, "logs");
            }

            if (Directory.Exists(logDir))
            {
                Process.Start("explorer.exe", logDir);
            }
            else
            {
                MessageBox.Show("Log directory not found.", "Pankha Tray",
                    MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Failed to open logs folder");
            MessageBox.Show($"Error: {ex.Message}", "Pankha Tray",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
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
        _notifyIcon.Visible = false;
        Application.Exit();
    }

    private Icon GetConnectedIcon()
    {
        // Use system icon as placeholder - in production, embed custom icon
        return SystemIcons.Application;
    }

    private Icon GetDisconnectedIcon()
    {
        // Use system icon as placeholder - in production, embed custom icon
        return SystemIcons.Warning;
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _pollTimer?.Dispose();
            _notifyIcon?.Dispose();
            _statusForm?.Dispose();
            _configForm?.Dispose();
            _contextMenu?.Dispose();
        }
        base.Dispose(disposing);
    }
}

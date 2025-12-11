using Pankha.Tray.Services;
using Pankha.WindowsAgent.Models.Ipc;
using Serilog;

namespace Pankha.Tray.Forms;

/// <summary>
/// Form displaying current agent status
/// </summary>
public class StatusForm : Form
{
    private readonly IpcClient _ipcClient;
    private readonly System.Windows.Forms.Timer _refreshTimer;

    // Controls
    private Label _connectionLabel = null!;
    private Label _backendLabel = null!;
    private Label _sensorsLabel = null!;
    private Label _fansLabel = null!;
    private Label _uptimeLabel = null!;
    private Label _lastUpdateLabel = null!;
    private Label _agentIdLabel = null!;
    private Label _agentNameLabel = null!;
    private Label _versionLabel = null!;
    private Button _refreshButton = null!;
    private Button _closeButton = null!;

    public StatusForm(IpcClient ipcClient)
    {
        _ipcClient = ipcClient;

        InitializeComponents();

        // Auto-refresh timer
        _refreshTimer = new System.Windows.Forms.Timer { Interval = 2000 };
        _refreshTimer.Tick += async (s, e) => await RefreshStatusAsync();
        _refreshTimer.Start();

        // Initial load
        _ = RefreshStatusAsync();
    }

    private void InitializeComponents()
    {
        Text = "Pankha Agent Status";
        Size = new Size(400, 380);
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        ShowInTaskbar = false;

        var padding = 15;
        var labelWidth = 120;
        var valueWidth = 220;
        var rowHeight = 25;
        var y = padding;

        // Connection Status (highlighted)
        AddLabelRow("Connection:", ref _connectionLabel, ref y, padding, labelWidth, valueWidth, rowHeight);
        _connectionLabel.Font = new Font(_connectionLabel.Font, FontStyle.Bold);

        AddLabelRow("Backend URL:", ref _backendLabel, ref y, padding, labelWidth, valueWidth, rowHeight);

        // Separator
        y += 10;
        var sep1 = new Label
        {
            Text = "",
            BorderStyle = BorderStyle.Fixed3D,
            Height = 2,
            Width = ClientSize.Width - (padding * 2),
            Location = new Point(padding, y)
        };
        Controls.Add(sep1);
        y += 15;

        // Stats
        AddLabelRow("Sensors:", ref _sensorsLabel, ref y, padding, labelWidth, valueWidth, rowHeight);
        AddLabelRow("Fans:", ref _fansLabel, ref y, padding, labelWidth, valueWidth, rowHeight);
        AddLabelRow("Service Uptime:", ref _uptimeLabel, ref y, padding, labelWidth, valueWidth, rowHeight);
        AddLabelRow("Last Update:", ref _lastUpdateLabel, ref y, padding, labelWidth, valueWidth, rowHeight);

        // Separator
        y += 10;
        var sep2 = new Label
        {
            Text = "",
            BorderStyle = BorderStyle.Fixed3D,
            Height = 2,
            Width = ClientSize.Width - (padding * 2),
            Location = new Point(padding, y)
        };
        Controls.Add(sep2);
        y += 15;

        // Agent Info
        AddLabelRow("Agent ID:", ref _agentIdLabel, ref y, padding, labelWidth, valueWidth, rowHeight);
        AddLabelRow("Agent Name:", ref _agentNameLabel, ref y, padding, labelWidth, valueWidth, rowHeight);
        AddLabelRow("Version:", ref _versionLabel, ref y, padding, labelWidth, valueWidth, rowHeight);

        // Buttons
        y += 20;
        _refreshButton = new Button
        {
            Text = "Refresh",
            Location = new Point(ClientSize.Width - 180, y),
            Size = new Size(75, 28)
        };
        _refreshButton.Click += async (s, e) => await RefreshStatusAsync();
        Controls.Add(_refreshButton);

        _closeButton = new Button
        {
            Text = "Close",
            Location = new Point(ClientSize.Width - 95, y),
            Size = new Size(75, 28)
        };
        _closeButton.Click += (s, e) => Close();
        Controls.Add(_closeButton);
    }

    private void AddLabelRow(string labelText, ref Label valueLabel, ref int y, int padding, int labelWidth, int valueWidth, int rowHeight)
    {
        var label = new Label
        {
            Text = labelText,
            Location = new Point(padding, y),
            Size = new Size(labelWidth, rowHeight),
            TextAlign = ContentAlignment.MiddleRight
        };
        Controls.Add(label);

        valueLabel = new Label
        {
            Text = "Loading...",
            Location = new Point(padding + labelWidth + 5, y),
            Size = new Size(valueWidth, rowHeight),
            TextAlign = ContentAlignment.MiddleLeft
        };
        Controls.Add(valueLabel);

        y += rowHeight;
    }

    private async Task RefreshStatusAsync()
    {
        try
        {
            var status = await _ipcClient.GetStatusAsync();

            if (status != null)
            {
                _connectionLabel.Text = status.ConnectionState;
                _connectionLabel.ForeColor = status.ConnectionState == "Connected" ? Color.Green : Color.Orange;
                _sensorsLabel.Text = $"{status.SensorsDiscovered} discovered";
                _fansLabel.Text = $"{status.FansDiscovered} controllable";
                _uptimeLabel.Text = FormatUptime(status.Uptime);
                _lastUpdateLabel.Text = DateTime.Now.ToString("HH:mm:ss");
                _agentIdLabel.Text = status.AgentId;
                _agentNameLabel.Text = status.AgentId; // TODO: Get from config
                _versionLabel.Text = status.Version;
                _backendLabel.Text = "Connected"; // TODO: Get actual URL
            }
            else
            {
                _connectionLabel.Text = "Disconnected";
                _connectionLabel.ForeColor = Color.Red;
                _sensorsLabel.Text = "-";
                _fansLabel.Text = "-";
                _uptimeLabel.Text = "-";
                _lastUpdateLabel.Text = DateTime.Now.ToString("HH:mm:ss");
                _agentIdLabel.Text = "-";
                _agentNameLabel.Text = "-";
                _versionLabel.Text = "-";
                _backendLabel.Text = "Service not running";
            }
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Error refreshing status");
        }
    }

    private string FormatUptime(TimeSpan uptime)
    {
        if (uptime.TotalDays >= 1)
            return $"{(int)uptime.TotalDays}d {uptime.Hours}h {uptime.Minutes}m";
        if (uptime.TotalHours >= 1)
            return $"{(int)uptime.TotalHours}h {uptime.Minutes}m {uptime.Seconds}s";
        if (uptime.TotalMinutes >= 1)
            return $"{(int)uptime.TotalMinutes}m {uptime.Seconds}s";
        return $"{(int)uptime.TotalSeconds}s";
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        _refreshTimer?.Stop();
        _refreshTimer?.Dispose();
        base.OnFormClosing(e);
    }
}

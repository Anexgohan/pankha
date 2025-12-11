using Pankha.Tray.Services;
using Pankha.WindowsAgent.Models.Configuration;
using Serilog;

namespace Pankha.Tray.Forms;

/// <summary>
/// Form for editing agent configuration
/// </summary>
public class ConfigForm : Form
{
    private readonly IpcClient _ipcClient;
    private AgentConfig? _currentConfig;

    // Agent Settings
    private TextBox _agentNameTextBox = null!;
    private TextBox _agentIdTextBox = null!;

    // Backend Settings
    private TextBox _backendUrlTextBox = null!;
    private NumericUpDown _reconnectIntervalNumeric = null!;

    // Hardware Settings
    private NumericUpDown _updateIntervalNumeric = null!;
    private CheckBox _enableFanControlCheckBox = null!;
    private NumericUpDown _emergencyTempNumeric = null!;
    private NumericUpDown _minFanSpeedNumeric = null!;

    // Monitoring Settings
    private CheckBox _filterDuplicatesCheckBox = null!;
    private NumericUpDown _toleranceNumeric = null!;
    private NumericUpDown _fanStepNumeric = null!;
    private NumericUpDown _hysteresisNumeric = null!;

    // Buttons
    private Button _saveButton = null!;
    private Button _cancelButton = null!;
    private Label _statusLabel = null!;

    public ConfigForm(IpcClient ipcClient)
    {
        _ipcClient = ipcClient;

        InitializeComponents();

        // Load config on show
        Load += async (s, e) => await LoadConfigAsync();
    }

    private void InitializeComponents()
    {
        Text = "Pankha Agent Configuration";
        Size = new Size(450, 520);
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        ShowInTaskbar = false;

        var padding = 15;
        var y = padding;

        // === Agent Group ===
        var agentGroup = new GroupBox
        {
            Text = "Agent",
            Location = new Point(padding, y),
            Size = new Size(ClientSize.Width - (padding * 2), 80)
        };
        Controls.Add(agentGroup);

        var agentY = 22;
        AddTextBoxRow(agentGroup, "Name:", ref _agentNameTextBox, ref agentY, 80);
        AddTextBoxRow(agentGroup, "Agent ID:", ref _agentIdTextBox, ref agentY, 80);
        _agentIdTextBox.ReadOnly = true;
        _agentIdTextBox.BackColor = SystemColors.Control;

        y += agentGroup.Height + 10;

        // === Backend Group ===
        var backendGroup = new GroupBox
        {
            Text = "Backend Connection",
            Location = new Point(padding, y),
            Size = new Size(ClientSize.Width - (padding * 2), 80)
        };
        Controls.Add(backendGroup);

        var backendY = 22;
        AddTextBoxRow(backendGroup, "URL:", ref _backendUrlTextBox, ref backendY, 80);
        AddNumericRow(backendGroup, "Reconnect (ms):", ref _reconnectIntervalNumeric, ref backendY, 80, 1000, 60000, 1000);

        y += backendGroup.Height + 10;

        // === Hardware Group ===
        var hardwareGroup = new GroupBox
        {
            Text = "Hardware",
            Location = new Point(padding, y),
            Size = new Size(ClientSize.Width - (padding * 2), 130)
        };
        Controls.Add(hardwareGroup);

        var hwY = 22;
        AddNumericRow(hardwareGroup, "Update (sec):", ref _updateIntervalNumeric, ref hwY, 100, 1, 60, 1, 1);
        AddCheckBoxRow(hardwareGroup, "Enable Fan Control", ref _enableFanControlCheckBox, ref hwY, 100);
        AddNumericRow(hardwareGroup, "Emergency (°C):", ref _emergencyTempNumeric, ref hwY, 100, 50, 100, 0);
        AddNumericRow(hardwareGroup, "Min Fan (%):", ref _minFanSpeedNumeric, ref hwY, 100, 0, 100, 0);

        y += hardwareGroup.Height + 10;

        // === Monitoring Group ===
        var monitorGroup = new GroupBox
        {
            Text = "Monitoring",
            Location = new Point(padding, y),
            Size = new Size(ClientSize.Width - (padding * 2), 130)
        };
        Controls.Add(monitorGroup);

        var monY = 22;
        AddCheckBoxRow(monitorGroup, "Filter Duplicate Sensors", ref _filterDuplicatesCheckBox, ref monY, 150);
        AddNumericRow(monitorGroup, "Tolerance (°C):", ref _toleranceNumeric, ref monY, 100, 0.1m, 10, 1, 1);
        AddNumericRow(monitorGroup, "Fan Step (%):", ref _fanStepNumeric, ref monY, 100, 1, 50, 0);
        AddNumericRow(monitorGroup, "Hysteresis (°C):", ref _hysteresisNumeric, ref monY, 100, 0, 10, 1, 1);

        y += monitorGroup.Height + 15;

        // === Buttons ===
        _saveButton = new Button
        {
            Text = "Save && Restart Service",
            Location = new Point(ClientSize.Width - 240, y),
            Size = new Size(140, 30)
        };
        _saveButton.Click += async (s, e) => await SaveConfigAsync();
        Controls.Add(_saveButton);

        _cancelButton = new Button
        {
            Text = "Cancel",
            Location = new Point(ClientSize.Width - 90, y),
            Size = new Size(70, 30)
        };
        _cancelButton.Click += (s, e) => Close();
        Controls.Add(_cancelButton);

        // Status label
        _statusLabel = new Label
        {
            Text = "",
            Location = new Point(padding, y + 5),
            Size = new Size(200, 25),
            ForeColor = Color.Gray
        };
        Controls.Add(_statusLabel);
    }

    private void AddTextBoxRow(Control parent, string label, ref TextBox textBox, ref int y, int labelWidth)
    {
        var lbl = new Label
        {
            Text = label,
            Location = new Point(10, y + 3),
            Size = new Size(labelWidth, 20),
            TextAlign = ContentAlignment.MiddleRight
        };
        parent.Controls.Add(lbl);

        textBox = new TextBox
        {
            Location = new Point(labelWidth + 15, y),
            Size = new Size(parent.Width - labelWidth - 35, 23)
        };
        parent.Controls.Add(textBox);

        y += 28;
    }

    private void AddNumericRow(Control parent, string label, ref NumericUpDown numeric, ref int y, int labelWidth,
        decimal min, decimal max, int decimalPlaces, decimal increment = 1)
    {
        var lbl = new Label
        {
            Text = label,
            Location = new Point(10, y + 3),
            Size = new Size(labelWidth, 20),
            TextAlign = ContentAlignment.MiddleRight
        };
        parent.Controls.Add(lbl);

        numeric = new NumericUpDown
        {
            Location = new Point(labelWidth + 15, y),
            Size = new Size(100, 23),
            Minimum = min,
            Maximum = max,
            DecimalPlaces = decimalPlaces,
            Increment = increment
        };
        parent.Controls.Add(numeric);

        y += 28;
    }

    private void AddCheckBoxRow(Control parent, string label, ref CheckBox checkBox, ref int y, int offset)
    {
        checkBox = new CheckBox
        {
            Text = label,
            Location = new Point(offset + 15, y),
            Size = new Size(parent.Width - offset - 30, 20)
        };
        parent.Controls.Add(checkBox);

        y += 26;
    }

    private async Task LoadConfigAsync()
    {
        _statusLabel.Text = "Loading...";
        _statusLabel.ForeColor = Color.Gray;
        _saveButton.Enabled = false;

        try
        {
            _currentConfig = await _ipcClient.GetConfigAsync();

            if (_currentConfig != null)
            {
                // Populate form
                _agentNameTextBox.Text = _currentConfig.Agent.Name;
                _agentIdTextBox.Text = _currentConfig.Agent.AgentId;

                _backendUrlTextBox.Text = _currentConfig.Backend.Url;
                _reconnectIntervalNumeric.Value = _currentConfig.Backend.ReconnectInterval;

                _updateIntervalNumeric.Value = (decimal)_currentConfig.Hardware.UpdateInterval;
                _enableFanControlCheckBox.Checked = _currentConfig.Hardware.EnableFanControl;
                _emergencyTempNumeric.Value = (decimal)_currentConfig.Hardware.EmergencyTemperature;
                _minFanSpeedNumeric.Value = _currentConfig.Hardware.MinFanSpeed;

                _filterDuplicatesCheckBox.Checked = _currentConfig.Monitoring.FilterDuplicateSensors;
                _toleranceNumeric.Value = (decimal)_currentConfig.Monitoring.DuplicateSensorTolerance;
                _fanStepNumeric.Value = _currentConfig.Monitoring.FanStepPercent;
                _hysteresisNumeric.Value = (decimal)_currentConfig.Monitoring.HysteresisTemp;

                _statusLabel.Text = "Ready";
                _saveButton.Enabled = true;
            }
            else
            {
                _statusLabel.Text = "Failed to load (Service not running?)";
                _statusLabel.ForeColor = Color.Red;
            }
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Error loading config");
            _statusLabel.Text = $"Error: {ex.Message}";
            _statusLabel.ForeColor = Color.Red;
        }
    }

    private async Task SaveConfigAsync()
    {
        if (_currentConfig == null) return;

        _statusLabel.Text = "Saving...";
        _statusLabel.ForeColor = Color.Blue;
        _saveButton.Enabled = false;

        try
        {
            // Update config from form
            _currentConfig.Agent.Name = _agentNameTextBox.Text;

            _currentConfig.Backend.Url = _backendUrlTextBox.Text;
            _currentConfig.Backend.ReconnectInterval = (int)_reconnectIntervalNumeric.Value;

            _currentConfig.Hardware.UpdateInterval = (double)_updateIntervalNumeric.Value;
            _currentConfig.Hardware.EnableFanControl = _enableFanControlCheckBox.Checked;
            _currentConfig.Hardware.EmergencyTemperature = (double)_emergencyTempNumeric.Value;
            _currentConfig.Hardware.MinFanSpeed = (int)_minFanSpeedNumeric.Value;

            _currentConfig.Monitoring.FilterDuplicateSensors = _filterDuplicatesCheckBox.Checked;
            _currentConfig.Monitoring.DuplicateSensorTolerance = (double)_toleranceNumeric.Value;
            _currentConfig.Monitoring.FanStepPercent = (int)_fanStepNumeric.Value;
            _currentConfig.Monitoring.HysteresisTemp = (double)_hysteresisNumeric.Value;

            var success = await _ipcClient.SetConfigAsync(_currentConfig);

            if (success)
            {
                _statusLabel.Text = "Saved! Restart service to apply.";
                _statusLabel.ForeColor = Color.Green;

                // Offer to restart service
                var result = MessageBox.Show(
                    "Configuration saved. Would you like to restart the service now?",
                    "Configuration Saved",
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Question);

                if (result == DialogResult.Yes)
                {
                    // Use same method as tray context
                    RestartService();
                }
            }
            else
            {
                _statusLabel.Text = "Save failed";
                _statusLabel.ForeColor = Color.Red;
            }
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Error saving config");
            _statusLabel.Text = $"Error: {ex.Message}";
            _statusLabel.ForeColor = Color.Red;
        }
        finally
        {
            _saveButton.Enabled = true;
        }
    }

    private void RestartService()
    {
        try
        {
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
                var psi = new System.Diagnostics.ProcessStartInfo
                {
                    FileName = agentExe,
                    Arguments = "--restart",
                    Verb = "runas",
                    UseShellExecute = true
                };
                System.Diagnostics.Process.Start(psi);
            }
        }
        catch (System.ComponentModel.Win32Exception)
        {
            // UAC cancelled
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Error restarting service");
        }
    }
}

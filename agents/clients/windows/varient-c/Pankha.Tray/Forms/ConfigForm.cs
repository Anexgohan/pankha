using Pankha.Tray.Services;
using Pankha.Tray.Models;
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
    private ComboBox _updateIntervalComboBox = null!;  // Changed from NumericUpDown
    private CheckBox _enableFanControlCheckBox = null!;
    private ComboBox _emergencyTempComboBox = null!;   // Changed from NumericUpDown
    private NumericUpDown _minFanSpeedNumeric = null!;

    // Monitoring Settings
    private CheckBox _filterDuplicatesCheckBox = null!;
    private ComboBox _toleranceComboBox = null!;       // Changed from NumericUpDown
    private ComboBox _fanStepComboBox = null!;         // Changed from NumericUpDown
    private ComboBox _hysteresisComboBox = null!;      // Changed from NumericUpDown

    // Logging Settings
    private ComboBox _logLevelComboBox = null!;

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
        Size = new Size(450, 700); // Increased Height
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
        AddNumericRow(backendGroup, "Reconnect (ms):", ref _reconnectIntervalNumeric, ref backendY, 80, 1000, 60000, 0, 1000);

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
        // Populate Update Interval from UIOptions
        var updateIntervals = UIOptions.Instance.GetUpdateIntervals();
        var updateItems = updateIntervals.Select(v => $"{v}s").ToArray();
        AddComboBoxRow(hardwareGroup, "Agent Rate:", ref _updateIntervalComboBox, ref hwY, 100, updateItems);

        AddCheckBoxRow(hardwareGroup, "Enable Fan Control", ref _enableFanControlCheckBox, ref hwY, 100);

        // Populate Emergency Temp from UIOptions
        var emergencyTemps = UIOptions.Instance.GetEmergencyTemps();
        var emergencyItems = emergencyTemps.Select(v => $"{v}°C").ToArray();
        AddComboBoxRow(hardwareGroup, "Emergency Temp:", ref _emergencyTempComboBox, ref hwY, 100, emergencyItems);

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

        // Populate Sensor Tolerance from UIOptions
        var tolerances = UIOptions.Instance.GetSensorTolerances();
        var toleranceItems = tolerances.Select(v => $"{v:F2}°C").ToArray();
        AddComboBoxRow(monitorGroup, "Tolerance:", ref _toleranceComboBox, ref monY, 100, toleranceItems);

        // Populate Fan Step from UIOptions
        var fanSteps = UIOptions.Instance.GetFanSteps();
        var fanStepItems = fanSteps.Select(v => v.Label).ToArray();
        AddComboBoxRow(monitorGroup, "Fan Step:", ref _fanStepComboBox, ref monY, 100, fanStepItems);

        // Populate Hysteresis from UIOptions
        var hysteresis = UIOptions.Instance.GetHysteresisOptions();
        var hysteresisItems = hysteresis.Select(v => v.Label).ToArray();
        AddComboBoxRow(monitorGroup, "Hysteresis:", ref _hysteresisComboBox, ref monY, 100, hysteresisItems);

        y += monitorGroup.Height + 10;

        // === Logging Group ===
        var logGroup = new GroupBox
        {
            Text = "Logging",
            Location = new Point(padding, y),
            Size = new Size(ClientSize.Width - (padding * 2), 60)
        };
        Controls.Add(logGroup);

        var logY = 22;
        // Populate Log Level from UIOptions
        var logLevels = UIOptions.Instance.GetLogLevels();
        var logLevelItems = logLevels.Select(v => v.Label).ToArray();
        AddComboBoxRow(logGroup, "Log Level:", ref _logLevelComboBox, ref logY, 80, logLevelItems);

        y += logGroup.Height + 15;

        // === Buttons ===
        _saveButton = new Button
        {
            Text = "Save",
            Location = new Point(ClientSize.Width - 190, y),
            Size = new Size(90, 30)
        };
        _saveButton.Click += async (s, e) => await SaveConfigAsync();
        Controls.Add(_saveButton);

        _cancelButton = new Button
        {
            Text = "Close",
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

    private void AddComboBoxRow(Control parent, string label, ref ComboBox comboBox, ref int y, int labelWidth, string[] items)
    {
         var lbl = new Label
         {
             Text = label,
             Location = new Point(10, y + 3),
             Size = new Size(labelWidth, 20),
             TextAlign = ContentAlignment.MiddleRight
         };
         parent.Controls.Add(lbl);

         comboBox = new ComboBox
         {
             Location = new Point(labelWidth + 15, y),
             Size = new Size(180, 23),  // Wider to prevent label truncation
             DropDownStyle = ComboBoxStyle.DropDownList
         };
         comboBox.Items.AddRange(items);
         parent.Controls.Add(comboBox);

         y += 28;
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
                SetupUrlPlaceholder(); // Apply placeholder logic
                _reconnectIntervalNumeric.Value = _currentConfig.Backend.ReconnectInterval;

                // Set Update Interval ComboBox
                var updateIntervals = UIOptions.Instance.GetUpdateIntervals();
                var updateIdx = Array.IndexOf(updateIntervals, _currentConfig.Hardware.UpdateInterval);
                if (updateIdx >= 0) _updateIntervalComboBox.SelectedIndex = updateIdx;

                _enableFanControlCheckBox.Checked = _currentConfig.Hardware.EnableFanControl;

                // Set Emergency Temp ComboBox
                var emergencyTemps = UIOptions.Instance.GetEmergencyTemps();
                var emergencyIdx = Array.IndexOf(emergencyTemps, (int)_currentConfig.Hardware.EmergencyTemperature);
                if (emergencyIdx >= 0) _emergencyTempComboBox.SelectedIndex = emergencyIdx;

                _minFanSpeedNumeric.Value = _currentConfig.Hardware.MinFanSpeed;

                _filterDuplicatesCheckBox.Checked = _currentConfig.Monitoring.FilterDuplicateSensors;

                // Set Sensor Tolerance ComboBox
                var tolerances = UIOptions.Instance.GetSensorTolerances();
                var toleranceIdx = Array.FindIndex(tolerances, t => Math.Abs(t - _currentConfig.Monitoring.DuplicateSensorTolerance) < 0.01);
                if (toleranceIdx >= 0) _toleranceComboBox.SelectedIndex = toleranceIdx;

                // Set Fan Step ComboBox
                var fanSteps = UIOptions.Instance.GetFanSteps();
                var fanStepIdx = Array.FindIndex(fanSteps, f => f.Value == _currentConfig.Monitoring.FanStepPercent);
                if (fanStepIdx >= 0) _fanStepComboBox.SelectedIndex = fanStepIdx;

                // Set Hysteresis ComboBox
                var hysteresis = UIOptions.Instance.GetHysteresisOptions();
                var hysteresisIdx = Array.FindIndex(hysteresis, h => Math.Abs(h.Value - _currentConfig.Monitoring.HysteresisTemp) < 0.01);
                if (hysteresisIdx >= 0) _hysteresisComboBox.SelectedIndex = hysteresisIdx;

                // Set Log Level ComboBox
                var logLevels = UIOptions.Instance.GetLogLevels();
                var level = _currentConfig.Logging.LogLevel ?? "Information";
                var logLevelIdx = Array.FindIndex(logLevels, l => l.Value.Equals(level, StringComparison.OrdinalIgnoreCase));
                if (logLevelIdx >= 0)
                    _logLevelComboBox.SelectedIndex = logLevelIdx;
                else
                {
                    // Fallback: find "Information" or select first item
                    logLevelIdx = Array.FindIndex(logLevels, l => l.Value.Equals("Information", StringComparison.OrdinalIgnoreCase));
                    if (logLevelIdx >= 0)
                        _logLevelComboBox.SelectedIndex = logLevelIdx;
                    else if (_logLevelComboBox.Items.Count > 0)
                        _logLevelComboBox.SelectedIndex = 0;
                }

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

    // Placeholder text logic
    private const string URL_PLACEHOLDER = "192.168.xxx.xxx:3000";

    private void SetupUrlPlaceholder()
    {
        // Initial state check
        if (string.IsNullOrWhiteSpace(_backendUrlTextBox.Text) || _backendUrlTextBox.Text == URL_PLACEHOLDER)
        {
            _backendUrlTextBox.Text = URL_PLACEHOLDER;
            _backendUrlTextBox.ForeColor = Color.Gray;
        }
        else
        {
            _backendUrlTextBox.ForeColor = SystemColors.WindowText;
        }

        // Events
        _backendUrlTextBox.Enter += (s, e) =>
        {
            if (_backendUrlTextBox.Text == URL_PLACEHOLDER)
            {
                _backendUrlTextBox.Text = "";
                _backendUrlTextBox.ForeColor = SystemColors.WindowText;
            }
        };

        _backendUrlTextBox.Leave += (s, e) =>
        {
            if (string.IsNullOrWhiteSpace(_backendUrlTextBox.Text))
            {
                _backendUrlTextBox.Text = URL_PLACEHOLDER;
                _backendUrlTextBox.ForeColor = Color.Gray;
            }
        };
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

            // URL Formatting Logic
            var url = _backendUrlTextBox.Text.Trim();
            if (url == URL_PLACEHOLDER || string.IsNullOrWhiteSpace(url))
            {
                url = ""; // Handle as empty or keep previous? Assume empty if placeholder
            }
            else
            {
                // Auto-formatting
                // 1. Remove trailing slash if inside generic path but keep /websocket
                if (url.EndsWith("/")) url = url.TrimEnd('/');

                // 2. Add scheme if missing
                if (!url.StartsWith("ws://") && !url.StartsWith("wss://"))
                {
                    url = "ws://" + url;
                }

                // 3. Add /websocket if missing
                if (!url.EndsWith("/websocket"))
                {
                    url += "/websocket";
                }
            }
            _currentConfig.Backend.Url = url;
            // Update the textbox to show the formatted URL (optional, but good UX)
            if (url != "") 
            {
                 _backendUrlTextBox.Text = url;
                 _backendUrlTextBox.ForeColor = SystemColors.WindowText;
            }

            _currentConfig.Backend.ReconnectInterval = (int)_reconnectIntervalNumeric.Value;

            // Read Update Interval from ComboBox
            var updateIntervals = UIOptions.Instance.GetUpdateIntervals();
            if (_updateIntervalComboBox.SelectedIndex >= 0 && _updateIntervalComboBox.SelectedIndex < updateIntervals.Length)
                _currentConfig.Hardware.UpdateInterval = updateIntervals[_updateIntervalComboBox.SelectedIndex];

            _currentConfig.Hardware.EnableFanControl = _enableFanControlCheckBox.Checked;

            // Read Emergency Temp from ComboBox
            var emergencyTemps = UIOptions.Instance.GetEmergencyTemps();
            if (_emergencyTempComboBox.SelectedIndex >= 0 && _emergencyTempComboBox.SelectedIndex < emergencyTemps.Length)
                _currentConfig.Hardware.EmergencyTemperature = emergencyTemps[_emergencyTempComboBox.SelectedIndex];

            _currentConfig.Hardware.MinFanSpeed = (int)_minFanSpeedNumeric.Value;

            _currentConfig.Monitoring.FilterDuplicateSensors = _filterDuplicatesCheckBox.Checked;

            // Read Sensor Tolerance from ComboBox
            var tolerances = UIOptions.Instance.GetSensorTolerances();
            if (_toleranceComboBox.SelectedIndex >= 0 && _toleranceComboBox.SelectedIndex < tolerances.Length)
                _currentConfig.Monitoring.DuplicateSensorTolerance = tolerances[_toleranceComboBox.SelectedIndex];

            // Read Fan Step from ComboBox
            var fanSteps = UIOptions.Instance.GetFanSteps();
            if (_fanStepComboBox.SelectedIndex >= 0 && _fanStepComboBox.SelectedIndex < fanSteps.Length)
                _currentConfig.Monitoring.FanStepPercent = fanSteps[_fanStepComboBox.SelectedIndex].Value;

            // Read Hysteresis from ComboBox
            var hysteresis = UIOptions.Instance.GetHysteresisOptions();
            if (_hysteresisComboBox.SelectedIndex >= 0 && _hysteresisComboBox.SelectedIndex < hysteresis.Length)
                _currentConfig.Monitoring.HysteresisTemp = hysteresis[_hysteresisComboBox.SelectedIndex].Value;

            // Read Log Level from ComboBox
            var logLevels = UIOptions.Instance.GetLogLevels();
            if (_logLevelComboBox.SelectedIndex >= 0 && _logLevelComboBox.SelectedIndex < logLevels.Length)
                _currentConfig.Logging.LogLevel = logLevels[_logLevelComboBox.SelectedIndex].Value;

            var success = await _ipcClient.SetConfigAsync(_currentConfig);

            if (success)
            {
                _statusLabel.Text = "Saved successfully.";
                _statusLabel.ForeColor = Color.Green;
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

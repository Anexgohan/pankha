using System;
using System.Drawing;
using System.Windows.Forms;
using WixSharp;
using WixSharp.UI.Forms;

namespace Pankha.WixSharpInstaller
{
    /// <summary>
    /// Config option dialog handling both "Change" (Reset Config) and "Remove" (Keep Config) scenarios
    /// </summary>
    public partial class UninstallConfirmDialog : ManagedForm, IManagedDialog
    {
        private Label banner;
        private Label title;
        private Label description;
        private CheckBox configOptionCheckBox;
        private CheckBox keepLogsCheckBox;
        private Label infoText;
        private Button back;
        private Button next;
        private Button cancel;
        private Panel middlePanel;

        // Mode tracking
        private string currentMode;

        public UninstallConfirmDialog()
        {
            InitializeComponent();
        }

        void InitializeComponent()
        {
            this.SuspendLayout();

            // Form properties - match WixSharp standard size
            this.ClientSize = new Size(494, 361);
            this.FormBorderStyle = FormBorderStyle.FixedDialog;
            this.MaximizeBox = false;
            this.MinimizeBox = false;
            this.StartPosition = FormStartPosition.CenterScreen;
            this.Text = "[ProductName] Setup";
            this.BackColor = SystemColors.Window;

            // Banner (top colored bar)
            banner = new Label
            {
                BackColor = Color.White,
                Location = new Point(0, 0),
                Size = new Size(494, 58),
                BorderStyle = BorderStyle.FixedSingle
            };
            this.Controls.Add(banner);

            // Title
            title = new Label
            {
                Text = "Remove Pankha Windows Agent", // Default
                Font = new Font("Tahoma", 12F, FontStyle.Bold),
                Location = new Point(11, 8),
                Size = new Size(400, 40),
                BackColor = Color.White,
                AutoSize = false
            };
            banner.Controls.Add(title);

            // Middle panel (white background)
            middlePanel = new Panel
            {
                BackColor = Color.White,
                Location = new Point(0, 58),
                Size = new Size(494, 266)
            };
            this.Controls.Add(middlePanel);

            // Description
            description = new Label
            {
                Text = "Clicking Next will uninstall Pankha with the following options...", // Default
                Font = new Font("Tahoma", 8.25F),
                Location = new Point(20, 15),
                Size = new Size(450, 120),
                AutoSize = false,
                BackColor = Color.White
            };
            middlePanel.Controls.Add(description);

            // Separator line
            var separator = new Label
            {
                BorderStyle = BorderStyle.Fixed3D,
                Height = 2,
                Location = new Point(20, 145),
                Size = new Size(450, 2)
            };
            middlePanel.Controls.Add(separator);

            // Config option checkbox
            configOptionCheckBox = new CheckBox
            {
                Text = "Keep configuration files (config.json)", // Default
                Font = new Font("Tahoma", 8.25F, FontStyle.Bold),
                Location = new Point(20, 160),
                Size = new Size(450, 24),
                Checked = true, // Default
                BackColor = Color.White
            };
            configOptionCheckBox.Checked = true; // Default
            configOptionCheckBox.BackColor = Color.White;
            middlePanel.Controls.Add(configOptionCheckBox);

            // Keep Logs Checkbox
            keepLogsCheckBox = new CheckBox
            {
                Text = "Keep logs directory",
                Font = new Font("Tahoma", 8.25F, FontStyle.Bold),
                Location = new Point(20, 185), // Below config checkbox
                Size = new Size(450, 24),
                Checked = true,
                BackColor = Color.White
            };
            middlePanel.Controls.Add(keepLogsCheckBox);

            // Info text
            infoText = new Label
            {
                Text = "Defaulting to Keep Configuration...", // Default
                Font = new Font("Tahoma", 8.25F),
                ForeColor = Color.Gray,

                Location = new Point(40, 215), // Moved down
                Size = new Size(430, 40),
                AutoSize = false,
                BackColor = Color.White
            };
            middlePanel.Controls.Add(infoText);

            // Buttons panel (bottom gray bar)
            var bottomPanel = new Panel
            {
                BackColor = SystemColors.Control,
                Location = new Point(0, 324),
                Size = new Size(494, 37),
                BorderStyle = BorderStyle.FixedSingle
            };
            this.Controls.Add(bottomPanel);

            // Back button
            back = new Button
            {
                Text = "< &Back",
                Location = new Point(236, 6),
                Size = new Size(75, 23),
                TabIndex = 0
            };
            back.Click += Back_Click;
            bottomPanel.Controls.Add(back);

            // Next button
            next = new Button
            {
                Text = "&Next >",
                Location = new Point(316, 6),
                Size = new Size(75, 23),
                TabIndex = 1
            };
            next.Click += Next_Click;
            bottomPanel.Controls.Add(next);

            // Cancel button
            cancel = new Button
            {
                Text = "Cancel",
                Location = new Point(404, 6),
                Size = new Size(75, 23),
                TabIndex = 2
            };
            cancel.Click += Cancel_Click;
            bottomPanel.Controls.Add(cancel);

            this.AcceptButton = next;
            this.CancelButton = cancel;

            this.ResumeLayout(false);
        }

        void Back_Click(object sender, EventArgs e)
        {
            SaveState();
            Shell.GoPrev();
        }

        void Next_Click(object sender, EventArgs e)
        {
            SaveState();
            Shell.GoNext();
        }

        void Cancel_Click(object sender, EventArgs e)
        {
            Shell.Cancel();
        }

        private void SaveState()
        {
            if (currentMode == "Change")
            {
                // In Change mode, checkbox controls RESET_CONFIG
                Runtime.Session["RESET_CONFIG"] = configOptionCheckBox.Checked ? "1" : "0";
            }
            else // Remove mode
            {
                // In Remove mode, checkbox controls KEEP_CONFIG
                // In Remove mode, checkbox controls KEEP_CONFIG
                Runtime.Session["KEEP_CONFIG"] = configOptionCheckBox.Checked ? "1" : "0";
                Runtime.Session["KEEP_LOGS"] = keepLogsCheckBox.Checked ? "1" : "0";
            }
        }

        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            
            try 
            {
                // Get the install mode
                var mode = Runtime.Session["WixUI_InstallMode"];
                var removeProp = Runtime.Session["REMOVE"];

                this.Text = "Pankha Windows Agent Setup"; // Neutral title first

                // Handle Repair - Skip
                if (mode == "Repair")
                {
                    this.Text = "Repairing..."; // Set temp text in case it glimpses
                    Shell.GoNext();
                    return;
                }

                this.Text = $"{this.Text} (Mode: {mode})";
                
                this.Text = $"{this.Text} (Mode: {mode})";
                
                // Debug to user - REMOVED
                // MessageBox.Show($"Debug: UninstallConfirmDialog.OnShown\nMode: '{mode}'\nREMOVE: '{removeProp}'");

                // If mode is empty, default to Remove
                if (string.IsNullOrEmpty(mode))
                {
                    mode = "Remove";
                }
                currentMode = mode;

                // Configure UI based on mode
                if (currentMode == "Change")
                {
                    SetupChangeMode();
                }
                else
                {
                    // Default to Remove mode behavior
                    // Explicitly set title for Remove
                    this.Text = "Remove Pankha Windows Agent"; 
                    SetupRemoveMode();
                }

                // Set banner image if available
                try
                {
                    banner.BackgroundImage = Runtime.Session.GetResourceBitmap("WixUI_Bmp_Banner");
                }
                catch { }
            }
            catch (Exception ex)
            {
               // Silent fail on UI logic errors to avoid blocking
               Console.WriteLine("Error in OnShown: " + ex.Message);
            }
        }

        private void SetupChangeMode()
        {
            title.Text = "Modify Pankha Windows Agent";
            description.Text = "You can modify the installation using the options below:\n\n" +
                               "Check the box below if you wish to reset your configuration to defaults.";
            
            configOptionCheckBox.Text = "Reset configuration (config.json)";
            keepLogsCheckBox.Visible = false; // Hide Logs option for Change mode (implicitly kept)
            
            // For Reset, default is Unchecked (Safe)
            // Check if user previously set it
            string savedState = Runtime.Session["RESET_CONFIG"];
            configOptionCheckBox.Checked = savedState == "1";

            infoText.Text = "If checked, your current configuration will be DELETED and replaced with defaults.\n" +
                            "This cannot be undone.";
        }

        private void SetupRemoveMode()
        {
            title.Text = "Remove Pankha Windows Agent";
            description.Text = "Clicking Next will uninstall Pankha with the following options:\n\n" +
                               "The following components will be removed:\n\n" +
                               "  • Pankha Agent Windows Service\n" +
                               "  • Program files and executables\n" +
                               "  • Start Menu shortcuts\n" +
                               "  • Logs directory";

            configOptionCheckBox.Text = "Keep configuration files (config.json)";
            
            // For Keep Config, default is Checked (Safe)
            string savedState = Runtime.Session["KEEP_CONFIG"];
            // Default to "1" (checked) unless explicitly set to "0"
            configOptionCheckBox.Checked = savedState != "0";

            // Default to "1" (checked) unless explicitly set to "0"
            configOptionCheckBox.Checked = savedState != "0";
            
            keepLogsCheckBox.Visible = true;
            string savedLogs = Runtime.Session["KEEP_LOGS"];
            keepLogsCheckBox.Checked = savedLogs != "0";

            infoText.Text = "If checked, your configuration and logs will be preserved.\n" +
                            "Uncheck boxes to remove respective files.";
        }
    }
}

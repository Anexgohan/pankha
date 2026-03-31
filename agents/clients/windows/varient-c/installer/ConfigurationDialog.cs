using System;
using System.Drawing;
using System.Windows.Forms;
using WixSharp;
using WixSharp.UI.Forms;

namespace Pankha.WixSharpInstaller
{
    public class ConfigurationDialog : ManagedForm, IManagedDialog
    {
        private CheckBox resetConfigCheckBox;
        private CheckBox pawnioCheckBox;
        private Label descriptionLabel;
        private Button backButton;
        private Button nextButton;
        private Button cancelButton;

        private PictureBox banner;
        private Label bannerTitle;
        private Label bannerDescription;
        private Panel middlePanel;
        private Panel bottomPanel;

        public ConfigurationDialog()
        {
            InitializeComponent();
        }

        private void InitializeComponent()
        {
            this.SuspendLayout();

            // Form properties - matching project standard height
            this.ClientSize = new Size(494, 361);
            this.FormBorderStyle = FormBorderStyle.FixedDialog;
            this.MaximizeBox = false;
            this.MinimizeBox = false;
            this.StartPosition = FormStartPosition.CenterScreen;
            this.Text = "[ProductName] Setup";
            this.BackColor = SystemColors.Window;
            this.AutoScaleMode = AutoScaleMode.Dpi;

            // 1. Banner (Always white background)
            banner = new PictureBox
            {
                BackColor = Color.White,
                Location = new Point(0, 0),
                Size = new Size(494, 58),
                BorderStyle = BorderStyle.FixedSingle
            };
            this.Controls.Add(banner);

            bannerTitle = new Label
            {
                Text = "Configuration Options",
                Font = new Font("Segoe UI", 12F, FontStyle.Bold),
                Location = new Point(15, 8),
                Size = new Size(350, 24),
                BackColor = Color.White,
                AutoSize = false
            };
            banner.Controls.Add(bannerTitle);

            bannerDescription = new Label
            {
                Text = "Choose how to handle existing configuration.",
                Font = new Font("Segoe UI", 8.25F),
                Location = new Point(25, 32),
                Size = new Size(350, 16),
                BackColor = Color.White,
                AutoSize = false
            };
            banner.Controls.Add(bannerDescription);

            // 2. Middle Panel (Content area)
            middlePanel = new Panel
            {
                BackColor = Color.White,
                Location = new Point(0, 58),
                Size = new Size(494, 266)
            };
            this.Controls.Add(middlePanel);

            descriptionLabel = new Label
            {
                Text = "If you are upgrading or reinstalling, you can choose to keep your existing configuration and logs, or perform a clean install.",
                Font = new Font("Segoe UI", 9F),
                Location = new Point(25, 20),
                Size = new Size(440, 45),
                BackColor = Color.White
            };
            middlePanel.Controls.Add(descriptionLabel);

            resetConfigCheckBox = new CheckBox
            {
                Text = "Reset configuration (Clean Install)",
                Font = new Font("Segoe UI", 9F, FontStyle.Bold),
                Location = new Point(25, 80),
                Size = new Size(400, 24),
                BackColor = Color.White
            };
            middlePanel.Controls.Add(resetConfigCheckBox);

            var warningIcon = new Label
            {
                Text = "⚠️",
                Font = new Font("Segoe UI Emoji", 12F),
                Location = new Point(42, 110),
                Size = new Size(24, 24),
                BackColor = Color.White
            };
            middlePanel.Controls.Add(warningIcon);

            var resetDesc = new Label
            {
                Text = "WARNING: If checked, your existing 'config.json' and 'logs' folder will be DELETED.\nSelect this if you want to start fresh.",
                Font = new Font("Segoe UI", 8.25F),
                Location = new Point(70, 112),
                Size = new Size(380, 40),
                ForeColor = Color.DarkRed,
                BackColor = Color.White
            };
            middlePanel.Controls.Add(resetDesc);

            // --- PawnIO Driver Section ---
            var pawnioSeparator = new Label
            {
                BorderStyle = BorderStyle.Fixed3D,
                Location = new Point(25, 162),
                Size = new Size(440, 2),
                BackColor = Color.White
            };
            middlePanel.Controls.Add(pawnioSeparator);

            pawnioCheckBox = new CheckBox
            {
                Text = "Install PawnIO Driver",
                Font = new Font("Segoe UI", 9F, FontStyle.Bold),
                Location = new Point(25, 174),
                Size = new Size(400, 24),
                Checked = true,
                BackColor = Color.White
            };
            middlePanel.Controls.Add(pawnioCheckBox);

            var pawnioDesc = new Label
            {
                Text = "Required for LibreHardwareMonitor — provides low-level access for\nmotherboard temperature sensors and PWM fan control.",
                Font = new Font("Segoe UI", 8.25F),
                Location = new Point(42, 200),
                Size = new Size(400, 32),
                BackColor = Color.White
            };
            middlePanel.Controls.Add(pawnioDesc);

            var pawnioLink = new LinkLabel
            {
                Text = "More info: pawnio.eu",
                Font = new Font("Segoe UI", 8.25F),
                Location = new Point(42, 234),
                Size = new Size(200, 16),
                BackColor = Color.White
            };
            pawnioLink.LinkClicked += (s, ev) =>
            {
                try { System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("https://pawnio.eu") { UseShellExecute = true }); } catch { }
            };
            middlePanel.Controls.Add(pawnioLink);

            // 3. Bottom Panel (Buttons)
            bottomPanel = new Panel
            {
                BackColor = SystemColors.Control,
                Location = new Point(0, 324),
                Size = new Size(494, 37),
                BorderStyle = BorderStyle.FixedSingle
            };
            this.Controls.Add(bottomPanel);

            backButton = new Button { Text = "< &Back", Location = new Point(236, 6), Size = new Size(75, 23) };
            nextButton = new Button { Text = "&Next >", Location = new Point(316, 6), Size = new Size(75, 23) };
            cancelButton = new Button { Text = "Cancel", Location = new Point(404, 6), Size = new Size(75, 23) };

            backButton.Click += (s, e) => Shell.GoPrev();
            nextButton.Click += (s, e) => Shell.GoNext();
            cancelButton.Click += (s, e) => Shell.Cancel();

            bottomPanel.Controls.Add(backButton);
            bottomPanel.Controls.Add(nextButton);
            bottomPanel.Controls.Add(cancelButton);

            this.AcceptButton = nextButton;
            this.CancelButton = cancelButton;

            this.Load += ConfigurationDialog_Load;
            this.ResumeLayout(false);
        }

        private void ConfigurationDialog_Load(object sender, EventArgs e)
        {
            // Set Banner background if WixSharp has it
            try
            {
                banner.BackgroundImage = Runtime.Session.GetResourceBitmap("WixUI_Bmp_Banner");
            }
            catch { }

            // Bind Reset Config property
            string val = Runtime.Session["RESET_CONFIG"];
            resetConfigCheckBox.Checked = (val == "1");
            UpdateNextButtonText();

            resetConfigCheckBox.CheckedChanged += (s, ev) =>
            {
                Runtime.Session["RESET_CONFIG"] = resetConfigCheckBox.Checked ? "1" : "0";
                UpdateNextButtonText();
            };

            // Bind PawnIO property
            // Check if PawnIO is already installed — show checked+disabled if so
            bool pawnioInstalled = System.IO.File.Exists(@"C:\Windows\System32\drivers\PawnIO.sys");
            string pawnioVal = Runtime.Session["INSTALL_PAWNIO"];
            if (pawnioInstalled)
            {
                pawnioCheckBox.Checked = true;
                pawnioCheckBox.Enabled = false;
                pawnioCheckBox.Text = "Install PawnIO Driver (already installed)";
                Runtime.Session["INSTALL_PAWNIO"] = "0"; // Skip install — already present
            }
            else
            {
                pawnioCheckBox.Checked = (pawnioVal != "0");
            }

            pawnioCheckBox.CheckedChanged += (s, ev) =>
            {
                if (!pawnioCheckBox.Checked)
                {
                    // PawnIO is mandatory — warn and either re-check or abort
                    var result = MessageBox.Show(
                        "PawnIO is required for Pankha to read hardware sensors and control fans.\n\n" +
                        "The installation cannot continue without PawnIO.\n\n" +
                        "Click OK to re-enable PawnIO installation,\n" +
                        "or Cancel to abort the installer.",
                        "PawnIO Required",
                        MessageBoxButtons.OKCancel,
                        MessageBoxIcon.Warning,
                        MessageBoxDefaultButton.Button1);

                    if (result == DialogResult.OK)
                    {
                        pawnioCheckBox.Checked = true;
                        return;
                    }
                    else
                    {
                        // User chose to abort — cancel the entire installer
                        Shell.Cancel();
                        return;
                    }
                }
                Runtime.Session["INSTALL_PAWNIO"] = pawnioCheckBox.Checked ? "1" : "0";
            };
        }

        private void UpdateNextButtonText()
        {
            nextButton.Text = resetConfigCheckBox.Checked ? "Reset & Next >" : "&Next >";
        }
    }
}

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

            // Bind Property
            string val = Runtime.Session["RESET_CONFIG"];
            resetConfigCheckBox.Checked = (val == "1");
            UpdateNextButtonText();

            // Save on change
            resetConfigCheckBox.CheckedChanged += (s, ev) => 
            {
                Runtime.Session["RESET_CONFIG"] = resetConfigCheckBox.Checked ? "1" : "0";
                UpdateNextButtonText();
            };
        }

        private void UpdateNextButtonText()
        {
            nextButton.Text = resetConfigCheckBox.Checked ? "Reset & Next >" : "&Next >";
        }
    }
}

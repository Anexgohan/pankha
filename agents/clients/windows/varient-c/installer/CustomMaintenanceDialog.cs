using System;
using System.Drawing;
using System.Windows.Forms;
using WixSharp;
using WixSharp.UI.Forms;

namespace Pankha.WixSharpInstaller
{
    /// <summary>
    /// Custom Maintenance Type Dialog
    /// Replaces the standard WixSharp MaintenanceTypeDialog to ensure consistent navigation
    /// forcing the flow to go to UninstallConfirmDialog instead of jumping to ProgressDialog.
    /// </summary>
    public partial class CustomMaintenanceDialog : ManagedForm, IManagedDialog
    {
        private Label banner;
        private Label title;
        private Label description;
        
        private Button changeBtn;
        private Label changeLbl;
        
        private Button repairBtn;
        private Label repairLbl;
        
        private Button removeBtn;
        private Label removeLbl;

        private Button back;
        private Button next;
        private Button cancel;
        private Panel middlePanel;

        public CustomMaintenanceDialog()
        {
            InitializeComponent();
        }

        void InitializeComponent()
        {
            this.SuspendLayout();
            // Form properties - match WixSharp/Standard MSI size
            this.ClientSize = new Size(494, 361);
            this.FormBorderStyle = FormBorderStyle.FixedDialog;
            this.MaximizeBox = false;
            this.MinimizeBox = false;
            this.StartPosition = FormStartPosition.CenterScreen;
            this.Text = "[ProductName] Setup";
            this.BackColor = SystemColors.Window;

            // Banner
            banner = new Label
            {
                BackColor = Color.White,
                Location = new Point(0, 0),
                Size = new Size(494, 58),
                BorderStyle = BorderStyle.FixedSingle
            };
            this.Controls.Add(banner);

            title = new Label
            {
                Text = "Change, repair, or remove installation",
                Font = new Font("Tahoma", 12F, FontStyle.Bold),
                Location = new Point(11, 8),
                Size = new Size(400, 40),
                BackColor = Color.White,
                AutoSize = false
            };
            banner.Controls.Add(title);

            // Middle Panel
            middlePanel = new Panel
            {
                BackColor = Color.White,
                Location = new Point(0, 58),
                Size = new Size(494, 266)
            };
            this.Controls.Add(middlePanel);

            var mainInstruction = new Label
            {
                Text = "Select the operation you wish to perform.",
                Font = new Font("Tahoma", 9F),
                Location = new Point(20, 15),
                Size = new Size(450, 20),
                BackColor = Color.White
            };
            middlePanel.Controls.Add(mainInstruction);

            // === CHANGE OPTION ===
            changeBtn = new Button
            {
                Text = "&Change",
                Location = new Point(40, 50),
                Size = new Size(120, 23),
                TextAlign = ContentAlignment.MiddleCenter
            };
            changeBtn.Click += Change_Click;
            middlePanel.Controls.Add(changeBtn);

            changeLbl = new Label
            {
                Text = "Lets you change the way features are installed.",
                Location = new Point(170, 53),
                Size = new Size(300, 30),
                BackColor = Color.White
            };
            middlePanel.Controls.Add(changeLbl);

            // === REPAIR OPTION ===
            repairBtn = new Button
            {
                Text = "&Repair",
                Location = new Point(40, 100),
                Size = new Size(120, 23),
                TextAlign = ContentAlignment.MiddleCenter
            };
            repairBtn.Click += Repair_Click;
            middlePanel.Controls.Add(repairBtn);

            repairLbl = new Label
            {
                Text = "Repairs errors in the most recent installation by fixing missing and corrupt files, shortcuts, and registry entries.",
                Location = new Point(170, 103),
                Size = new Size(300, 40),
                BackColor = Color.White
            };
            middlePanel.Controls.Add(repairLbl);

            // === REMOVE OPTION ===
            removeBtn = new Button
            {
                Text = "&Remove",
                Location = new Point(40, 160),
                Size = new Size(120, 23),
                TextAlign = ContentAlignment.MiddleCenter
            };
            removeBtn.Click += Remove_Click;
            middlePanel.Controls.Add(removeBtn);

            removeLbl = new Label
            {
                Text = "Removes [ProductName] from your computer.",
                Location = new Point(170, 163),
                Size = new Size(300, 20),
                BackColor = Color.White
            };
            middlePanel.Controls.Add(removeLbl);


            // Bottom Panel
            var bottomPanel = new Panel
            {
                BackColor = SystemColors.Control,
                Location = new Point(0, 324),
                Size = new Size(494, 37),
                BorderStyle = BorderStyle.FixedSingle
            };
            this.Controls.Add(bottomPanel);

            // Bottom Buttons (Back/Cancel only, as the main options act as Next)
            back = new Button
            {
                Text = "< &Back",
                Location = new Point(236, 6),
                Size = new Size(75, 23),
                Enabled = false // Usually disabled on first maintenance screen
            };
            back.Click += Back_Click;
            bottomPanel.Controls.Add(back);

            next = new Button
            {
                Text = "&Next >",
                Location = new Point(316, 6),
                Size = new Size(75, 23),
                Enabled = false,
                Visible = false // Hidden because user must click Change/Repair/Remove options
            };
            bottomPanel.Controls.Add(next);

            cancel = new Button
            {
                Text = "Cancel",
                Location = new Point(404, 6),
                Size = new Size(75, 23)
            };
            cancel.Click += Cancel_Click;
            bottomPanel.Controls.Add(cancel);

            this.CancelButton = cancel;

            this.ResumeLayout(false);
        }

        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            try
            {
                banner.BackgroundImage = Runtime.Session.GetResourceBitmap("WixUI_Bmp_Banner");

            }
            catch {}
        }

        void Change_Click(object sender, EventArgs e)
        {

            Runtime.Session["WixUI_InstallMode"] = "Change";
            Runtime.Session["MODIFY_ACTION"] = "Change";
            Runtime.Session["REMOVE"] = "";
            Runtime.Session["REINSTALL"] = "";
            Shell.GoNext();
        }

        void Repair_Click(object sender, EventArgs e)
        {

            Runtime.Session["WixUI_InstallMode"] = "Repair";
            Runtime.Session["MODIFY_ACTION"] = "Repair";
            Runtime.Session["REMOVE"] = "";
            Runtime.Session["ADDLOCAL"] = "";
            Runtime.Session["REINSTALL"] = "ALL";
            Runtime.Session["REINSTALLMODE"] = "omus";
            Shell.GoNext();
        }

        void Remove_Click(object sender, EventArgs e)
        {

            Runtime.Session["WixUI_InstallMode"] = "Remove";
            Runtime.Session["MODIFY_ACTION"] = "Remove";
            Runtime.Session["REMOVE"] = "ALL";
            Runtime.Session["ADDLOCAL"] = "";
            Runtime.Session["REINSTALL"] = "";
            Shell.GoNext();
        }

        void Back_Click(object sender, EventArgs e)
        {
            Shell.GoPrev();
        }

        void Cancel_Click(object sender, EventArgs e)
        {
            Shell.Cancel();
        }
    }
}

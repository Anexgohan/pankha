using Pankha.WindowsAgent.Models.Ipc;
using System.Drawing.Drawing2D;

namespace Pankha.Tray.Forms;

/// <summary>
/// Borderless tooltip form that displays hardware stats on tray icon hover
/// </summary>
public class ToolTipForm : Form
{
    private readonly System.Windows.Forms.Timer _hideTimer;
    private AgentStatus? _lastStatus;
    
    // Colors (dark theme)
    private readonly Color _bgColor = Color.FromArgb(45, 45, 48);
    private readonly Color _borderColor = Color.FromArgb(70, 70, 75);
    private readonly Color _textColor = Color.FromArgb(220, 220, 220);
    private readonly Color _headerColor = Color.FromArgb(255, 255, 255);
    private readonly Color _accentGreen = Color.FromArgb(100, 200, 100);
    private readonly Color _accentRed = Color.FromArgb(200, 100, 100);
    private readonly Color _separatorColor = Color.FromArgb(80, 80, 85);

    public ToolTipForm()
    {
        InitializeForm();
        
        // Timer to auto-hide after mouse leaves tray icon
        _hideTimer = new System.Windows.Forms.Timer { Interval = 350 };
        _hideTimer.Tick += OnHideTimerTick;
    }

    private void InitializeForm()
    {
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.Manual;
        ShowInTaskbar = false;
        TopMost = true;
        BackColor = _bgColor;
        Size = new Size(230, 320);  // Larger to fit sensors and fans
        
        // Double-buffer to reduce flicker
        SetStyle(ControlStyles.AllPaintingInWmPaint | 
                 ControlStyles.UserPaint | 
                 ControlStyles.OptimizedDoubleBuffer, true);
    }

    public void UpdateStatus(AgentStatus? status)
    {
        _lastStatus = status;
        
        // Calculate dynamic height based on content
        int height = 95; // Base: header + status line + counts line + footer + margins
        if (status != null)
        {
            height += status.TopSensors.Count * 18 + 15;  // Sensors + separator
            height += status.TopFans.Count * 18 + 15;     // Fans + separator
            height += 50; // Averages section (2 lines + padding)
        }
        else
        {
            height += 50; // Disconnected message
        }
        
        Size = new Size(230, Math.Max(height, 180));
        Invalidate(); // Trigger repaint
    }

    public void ShowAt(Point cursorLocation)
    {
        _hideTimer.Stop();
        
        var screen = Screen.FromPoint(cursorLocation).WorkingArea;
        const int margin = 25;  // Safe margin from cursor/edges
        
        // Position ABOVE the cursor (so it doesn't block tray icons)
        // Place tooltip above cursor with gap
        var y = cursorLocation.Y - Height - margin;
        
        // If would go above screen top, flip to below cursor
        if (y < screen.Top + margin)
            y = cursorLocation.Y + margin;
        
        // Horizontal: center on cursor, but keep within screen bounds
        var x = cursorLocation.X - (Width / 2);
        
        // Clamp to screen edges
        if (x < screen.Left + margin)
            x = screen.Left + margin;
        else if (x + Width > screen.Right - margin)
            x = screen.Right - Width - margin;
            
        Location = new Point(x, y);
        
        if (!Visible)
            Show();
    }

    public void StartHideTimer()
    {
        _hideTimer.Start();
    }

    public void CancelHideTimer()
    {
        _hideTimer.Stop();
    }
    
    private void OnHideTimerTick(object? sender, EventArgs e)
    {
        _hideTimer.Stop();
        
        // Only hide if mouse is not currently over the tooltip
        if (!ClientRectangle.Contains(PointToClient(Cursor.Position)))
        {
            Hide();
        }
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;

        // Draw border
        using (var borderPen = new Pen(_borderColor, 1))
        {
            g.DrawRectangle(borderPen, 0, 0, Width - 1, Height - 1);
        }

        var y = 10;
        var leftMargin = 12;
        var rightMargin = Width - 12;
        var valueColumn = 130;

        using var headerFont = new Font("Segoe UI", 10, FontStyle.Bold);
        using var textFont = new Font("Segoe UI", 9);
        using var smallFont = new Font("Segoe UI", 8);
        using var headerBrush = new SolidBrush(_headerColor);
        using var textBrush = new SolidBrush(_textColor);
        using var greenBrush = new SolidBrush(_accentGreen);
        using var redBrush = new SolidBrush(_accentRed);
        using var dimBrush = new SolidBrush(Color.FromArgb(140, 140, 145));
        using var sepPen = new Pen(_separatorColor);

        // Header
        g.DrawString("Pankha Fan Control", headerFont, headerBrush, leftMargin, y);
        y += 22;
        g.DrawLine(sepPen, leftMargin, y, rightMargin, y);
        y += 8;

        if (_lastStatus == null)
        {
            // Disconnected state
            g.DrawString("Status:", textFont, textBrush, leftMargin, y);
            g.DrawString("Disconnected ❌", textFont, redBrush, 80, y);
            y += 20;
            g.DrawString("Service not running", textFont, textBrush, leftMargin, y);
        }
        else
        {
            // Status row
            g.DrawString("Status:", textFont, textBrush, leftMargin, y);
            var statusText = _lastStatus.ConnectionState == "Connected" ? "Connected ✓" : _lastStatus.ConnectionState;
            var statusBrush = _lastStatus.ConnectionState == "Connected" ? greenBrush : redBrush;
            g.DrawString(statusText, textFont, statusBrush, 80, y);
            y += 18;

            // Sensor/Fan counts
            g.DrawString($"Sensors: {_lastStatus.SensorsDiscovered}  |  Fans: {_lastStatus.FansDiscovered}", 
                textFont, textBrush, leftMargin, y);
            y += 18;
            g.DrawLine(sepPen, leftMargin, y, rightMargin, y);
            y += 6;

            // Temperature readings
            if (_lastStatus.TopSensors.Count > 0)
            {
                foreach (var sensor in _lastStatus.TopSensors.Take(4))
                {
                    var shortName = TruncateName(sensor.Name, 12);
                    g.DrawString($"{shortName}:", textFont, textBrush, leftMargin, y);
                    g.DrawString($"{sensor.Temperature:F0}°C", textFont, textBrush, valueColumn, y);
                    y += 16;
                }
                g.DrawLine(sepPen, leftMargin, y, rightMargin, y);
                y += 6;
            }

            // Fan readings
            if (_lastStatus.TopFans.Count > 0)
            {
                foreach (var fan in _lastStatus.TopFans.Take(4))
                {
                    var shortName = TruncateName(fan.Name, 12);
                    g.DrawString($"{shortName}:", textFont, textBrush, leftMargin, y);
                    g.DrawString($"{fan.Rpm:F0} RPM", textFont, textBrush, valueColumn, y);
                    y += 16;
                }
                g.DrawLine(sepPen, leftMargin, y, rightMargin, y);
                y += 6;
            }

            // Averages
            if (_lastStatus.TopSensors.Count > 0)
            {
                var avgTemp = _lastStatus.TopSensors.Average(s => s.Temperature);
                g.DrawString("Temp Avg:", textFont, dimBrush, leftMargin, y);
                g.DrawString($"{avgTemp:F0}°C", textFont, dimBrush, valueColumn, y);
                y += 16;
            }
            if (_lastStatus.TopFans.Count > 0)
            {
                var avgRpm = _lastStatus.TopFans.Average(f => f.Rpm);
                g.DrawString("Fans Avg:", textFont, dimBrush, leftMargin, y);
                g.DrawString($"{avgRpm:F0} RPM", textFont, dimBrush, valueColumn, y);
            }
        }

        // Footer
        y = Height - 22;
        g.DrawLine(sepPen, leftMargin, y - 5, rightMargin, y - 5);
        g.DrawString("Click for details", smallFont, dimBrush, leftMargin, y);
    }
    
    private string TruncateName(string name, int maxLength)
    {
        if (name.Length <= maxLength) return name;
        return name.Substring(0, maxLength - 2) + "..";
    }

    private string FormatUptime(TimeSpan uptime)
    {
        if (uptime.TotalDays >= 1)
            return $"{(int)uptime.TotalDays}d {uptime.Hours}h";
        if (uptime.TotalHours >= 1)
            return $"{(int)uptime.TotalHours}h {uptime.Minutes}m";
        if (uptime.TotalMinutes >= 1)
            return $"{(int)uptime.TotalMinutes}m {uptime.Seconds}s";
        return $"{(int)uptime.TotalSeconds}s";
    }

    protected override void OnMouseEnter(EventArgs e)
    {
        base.OnMouseEnter(e);
        CancelHideTimer();
    }

    protected override void OnMouseLeave(EventArgs e)
    {
        base.OnMouseLeave(e);
        StartHideTimer();
    }

    protected override CreateParams CreateParams
    {
        get
        {
            // Make the form not steal focus
            var cp = base.CreateParams;
            cp.ExStyle |= 0x08000000; // WS_EX_NOACTIVATE
            return cp;
        }
    }
}

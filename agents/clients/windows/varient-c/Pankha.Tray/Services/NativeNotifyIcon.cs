using System.Runtime.InteropServices;

namespace Pankha.Tray.Services;

/// <summary>
/// Native NotifyIcon using Shell_NotifyIcon with NOTIFYICON_VERSION_4
/// to receive proper NIN_POPUPOPEN and NIN_POPUPCLOSE messages.
/// </summary>
public class NativeNotifyIcon : NativeWindow, IDisposable
{
    // Windows messages
    private const int WM_USER = 0x0400;
    private const int WM_TRAYMOUSE = WM_USER + 1024;
    
    // Shell notification messages (NOTIFYICON_VERSION_4)
    private const int NIN_POPUPOPEN = 0x0406;
    private const int NIN_POPUPCLOSE = 0x0407;
    private const int WM_MOUSEMOVE = 0x0200;
    private const int WM_LBUTTONDOWN = 0x0201;
    private const int WM_LBUTTONUP = 0x0202;
    private const int WM_LBUTTONDBLCLK = 0x0203;
    private const int WM_RBUTTONDOWN = 0x0204;
    private const int WM_RBUTTONUP = 0x0205;
    private const int WM_CONTEXTMENU = 0x007B;
    
    // Shell_NotifyIcon commands
    private const int NIM_ADD = 0x00;
    private const int NIM_MODIFY = 0x01;
    private const int NIM_DELETE = 0x02;
    private const int NIM_SETVERSION = 0x04;
    
    // NOTIFYICONDATA flags
    private const int NIF_MESSAGE = 0x01;
    private const int NIF_ICON = 0x02;
    private const int NIF_TIP = 0x04;
    private const int NIF_STATE = 0x08;
    private const int NIF_INFO = 0x10;
    private const int NIF_GUID = 0x20;
    private const int NIF_SHOWTIP = 0x80;
    
    private const int NOTIFYICON_VERSION_4 = 4;
    
    // Events for tray interactions
    public event Action? PopupOpen;
    public event Action? PopupClose;
    public event Action? LeftClick;
    public event Action? DoubleClick;
    public event Action<Point>? RightClick;
    
    private NOTIFYICONDATA _data;
    private bool _isAdded;
    private bool _disposed;
    
    public NativeNotifyIcon(Icon icon, string tooltip)
    {
        // Create a hidden window to receive messages
        CreateHandle(new CreateParams());
        
        _data = new NOTIFYICONDATA
        {
            cbSize = Marshal.SizeOf<NOTIFYICONDATA>(),
            hWnd = Handle,
            uID = 100,
            uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP | NIF_SHOWTIP,
            uCallbackMessage = WM_TRAYMOUSE,
            hIcon = icon.Handle,
            szTip = tooltip ?? "",
            uVersion = NOTIFYICON_VERSION_4
        };
        
        _isAdded = Shell_NotifyIcon(NIM_ADD, ref _data);
        if (_isAdded)
        {
            Shell_NotifyIcon(NIM_SETVERSION, ref _data);
        }
    }
    
    public void UpdateIcon(Icon icon)
    {
        if (_disposed || !_isAdded) return;
        
        _data.hIcon = icon.Handle;
        _data.uFlags = NIF_ICON;
        Shell_NotifyIcon(NIM_MODIFY, ref _data);
    }
    
    public void UpdateTooltip(string tooltip)
    {
        if (_disposed || !_isAdded) return;
        
        _data.szTip = tooltip ?? "";
        _data.uFlags = NIF_TIP;
        Shell_NotifyIcon(NIM_MODIFY, ref _data);
    }
    
    protected override void WndProc(ref Message m)
    {
        if (m.Msg == WM_TRAYMOUSE)
        {
            // In Version 4, the message type is in the low word of LParam
            int msg = (int)((long)m.LParam & 0xFFFF);
            
            switch (msg)
            {
                case NIN_POPUPOPEN:
                case WM_MOUSEMOVE: // Fallback: WM_MOUSEMOVE always fires on hover
                    PopupOpen?.Invoke();
                    break;
                    
                case NIN_POPUPCLOSE:
                    PopupClose?.Invoke();
                    break;
                    
                case WM_LBUTTONUP:
                    LeftClick?.Invoke();
                    break;
                    
                case WM_LBUTTONDBLCLK:
                    DoubleClick?.Invoke();
                    break;
                    
                case WM_RBUTTONUP:
                case WM_CONTEXTMENU:
                    RightClick?.Invoke(Cursor.Position);
                    break;
            }
        }
        
        base.WndProc(ref m);
    }
    
    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        
        if (_isAdded)
        {
            Shell_NotifyIcon(NIM_DELETE, ref _data);
            _isAdded = false;
        }
        
        DestroyHandle();
        GC.SuppressFinalize(this);
    }
    
    ~NativeNotifyIcon()
    {
        Dispose();
    }
    
    #region P/Invoke
    
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
    private struct NOTIFYICONDATA
    {
        public int cbSize;
        public IntPtr hWnd;
        public int uID;
        public int uFlags;
        public int uCallbackMessage;
        public IntPtr hIcon;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
        public string szTip;
        public int dwState;
        public int dwStateMask;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)]
        public string szInfo;
        public int uVersion;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)]
        public string szInfoTitle;
        public int dwInfoFlags;
        public Guid guidItem;
        public IntPtr hBalloonIcon;
    }
    
    [DllImport("shell32.dll", CharSet = CharSet.Auto)]
    private static extern bool Shell_NotifyIcon(int dwMessage, ref NOTIFYICONDATA lpData);
    
    #endregion
}

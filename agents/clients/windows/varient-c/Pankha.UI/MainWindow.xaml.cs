using System.Windows;
using System.ComponentModel;

namespace Pankha.UI;

/// <summary>
/// Interaction logic for MainWindow.xaml
/// </summary>
public partial class MainWindow : Window
{
    public MainWindow()
    {
        InitializeComponent();
        DataContext = new MainViewModel();
    }

    // Override closing to hide instead of close (Minimize to Tray behavior)
    protected override void OnClosing(CancelEventArgs e)
    {
        e.Cancel = true;
        this.Hide();
    }
}
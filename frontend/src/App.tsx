import SystemsPage from './systems/components/SystemsPage';
import LoginPage from './components/LoginPage';
import SetupPage from './components/SetupPage';
import { Branding } from './components/Branding';
import { Toaster } from './components/ui/Toaster';
import { GraphPatternDefs } from './components/GraphPatternDefs';
import { ThemeProvider } from './contexts/ThemeContext';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { VisibilityProvider } from './contexts/VisibilityContext';
import { DashboardSettingsProvider } from './contexts/DashboardSettingsContext';
import { LicenseProvider } from './license';
import { Loader2 } from 'lucide-react';

// Session gate: setup screen on a fresh Hub, login without a session,
// the dashboard once authenticated.
function AuthGate() {
  const { status } = useAuth();

  if (status === 'loading') {
    return (
      <div className="auth-loading">
        <Loader2 size={28} className="animate-spin" />
      </div>
    );
  }
  if (status === 'setup') return <SetupPage />;
  if (status === 'login') return <LoginPage />;

  return (
    <LicenseProvider>
      <DashboardSettingsProvider>
        <VisibilityProvider>
          <GraphPatternDefs />
          <div className="App">
            <SystemsPage />
            <Branding />
          </div>
        </VisibilityProvider>
      </DashboardSettingsProvider>
    </LicenseProvider>
  );
}

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AuthGate />
        <Toaster />
      </AuthProvider>
    </ThemeProvider>
  )
}

export default App

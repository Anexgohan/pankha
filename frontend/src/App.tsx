import SystemsPage from './systems/components/SystemsPage';
import { Branding } from './components/Branding';
import { Toaster } from './components/ui/Toaster';
import { ThemeProvider } from './contexts/ThemeContext';
import { SensorVisibilityProvider } from './contexts/SensorVisibilityContext';
import { DashboardSettingsProvider } from './contexts/DashboardSettingsContext';
import { LicenseProvider } from './license';

function App() {
  return (
    <ThemeProvider>
      <LicenseProvider>
        <DashboardSettingsProvider>
          <SensorVisibilityProvider>
            <div className="App">
              <SystemsPage />
              <Branding />
              <Toaster />
            </div>
          </SensorVisibilityProvider>
        </DashboardSettingsProvider>
      </LicenseProvider>
    </ThemeProvider>
  )
}

export default App

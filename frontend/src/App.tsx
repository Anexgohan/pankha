import SystemsPage from './systems/components/SystemsPage';
import { Branding } from './components/Branding';
import { Toaster } from './components/ui/Toaster';
import { GraphPatternDefs } from './components/GraphPatternDefs';
import { ThemeProvider } from './contexts/ThemeContext';
import { VisibilityProvider } from './contexts/VisibilityContext';
import { DashboardSettingsProvider } from './contexts/DashboardSettingsContext';
import { LicenseProvider } from './license';

function App() {
  return (
    <ThemeProvider>
      <LicenseProvider>
        <DashboardSettingsProvider>
          <VisibilityProvider>
            <GraphPatternDefs />
            <div className="App">
              <SystemsPage />
              <Branding />
              <Toaster />
            </div>
          </VisibilityProvider>
        </DashboardSettingsProvider>
      </LicenseProvider>
    </ThemeProvider>
  )
}

export default App

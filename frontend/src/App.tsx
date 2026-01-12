import SystemsPage from './systems/components/SystemsPage';
import { Branding } from './components/Branding';
import { Toaster } from './components/ui/Toaster';
import { ThemeProvider } from './contexts/ThemeContext';
import { SensorVisibilityProvider } from './contexts/SensorVisibilityContext';
import { LicenseProvider } from './license';

function App() {
  return (
    <ThemeProvider>
      <LicenseProvider>
        <SensorVisibilityProvider>
          <div className="App">
            <SystemsPage />
            <Branding />
            <Toaster />
          </div>
        </SensorVisibilityProvider>
      </LicenseProvider>
    </ThemeProvider>
  )
}

export default App

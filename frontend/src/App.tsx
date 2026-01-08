import Dashboard from './components/Dashboard';
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
            <Dashboard />
            <Branding />
            <Toaster />
          </div>
        </SensorVisibilityProvider>
      </LicenseProvider>
    </ThemeProvider>
  )
}

export default App

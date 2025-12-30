import Dashboard from './components/Dashboard';
import { Branding } from './components/Branding';
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
          </div>
        </SensorVisibilityProvider>
      </LicenseProvider>
    </ThemeProvider>
  )
}

export default App

import Dashboard from './components/Dashboard';
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
          </div>
        </SensorVisibilityProvider>
      </LicenseProvider>
    </ThemeProvider>
  )
}

export default App

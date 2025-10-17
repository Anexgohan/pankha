import Dashboard from './components/Dashboard';
import { ThemeProvider } from './contexts/ThemeContext';
import { DashboardSettingsProvider } from './contexts/DashboardSettingsContext';
import { SensorVisibilityProvider } from './contexts/SensorVisibilityContext';

function App() {
  return (
    <ThemeProvider>
      <DashboardSettingsProvider>
        <SensorVisibilityProvider>
          <div className="App">
            <Dashboard />
          </div>
        </SensorVisibilityProvider>
      </DashboardSettingsProvider>
    </ThemeProvider>
  )
}

export default App

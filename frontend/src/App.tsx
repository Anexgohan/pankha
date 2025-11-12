import Dashboard from './components/Dashboard';
import { ThemeProvider } from './contexts/ThemeContext';
import { SensorVisibilityProvider } from './contexts/SensorVisibilityContext';

function App() {
  return (
    <ThemeProvider>
      <SensorVisibilityProvider>
        <div className="App">
          <Dashboard />
        </div>
      </SensorVisibilityProvider>
    </ThemeProvider>
  )
}

export default App

import React from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { Sun, MoonStar, Monitor } from 'lucide-react';

const ThemeToggle: React.FC = () => {
  const { theme, actualTheme, toggleTheme } = useTheme();

  const getTitle = () => {
    if (theme === 'system') {
      return `System theme (currently ${actualTheme})`;
    }
    return `Switch to ${actualTheme === 'dark' ? 'light' : 'dark'} mode`;
  };

  return (
    <button 
      onClick={toggleTheme}
      className="theme-toggle"
      title={getTitle()}
      aria-label={getTitle()}
    >
      <div className="theme-icon-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {theme === 'system' ? (
          <Monitor size={20} stroke="var(--text-primary)" strokeWidth={2} />
        ) : actualTheme === 'dark' ? (
          <MoonStar size={20} stroke="var(--text-primary)" strokeWidth={2} />
        ) : (
          <Sun size={20} stroke="var(--text-primary)" strokeWidth={2} />
        )}
      </div>
    </button>
  );
};

export default ThemeToggle;
import React from 'react';
import { useTheme } from '../contexts/ThemeContext';

const ThemeToggle: React.FC = () => {
  const { theme, actualTheme, toggleTheme } = useTheme();

  const getIcon = () => {
    if (theme === 'system') {
      return '🖥️';
    }
    return actualTheme === 'dark' ? '🌙' : '☀️';
  };

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
      {getIcon()}
    </button>
  );
};

export default ThemeToggle;
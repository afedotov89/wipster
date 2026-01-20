import React, { createContext, useState, useContext, useEffect } from 'react';

// Theme types
export const THEME_MODES = {
  LIGHT: 'light',
  DARK: 'dark',
  SYSTEM: 'system',
};

// Check browser environment
const isBrowser = typeof window !== 'undefined';

// Default value
const defaultThemeContextValue = {
  themeMode: THEME_MODES.SYSTEM,
  setThemeMode: () => {},
  resolvedTheme: 'light', // Actual theme after system resolution
};

// Create context
export const ThemeContext = createContext(defaultThemeContextValue);

// Theme provider
export const ThemeProvider = ({ children }) => {
  // Get saved theme from localStorage
  const [themeMode, setThemeMode] = useState(THEME_MODES.SYSTEM);
  // Actual theme after system resolution
  const [resolvedTheme, setResolvedTheme] = useState(THEME_MODES.LIGHT);

  // On initialization, check saved theme
  useEffect(() => {
    if (isBrowser) {
      const savedTheme = localStorage.getItem('themeMode');
      if (savedTheme && Object.values(THEME_MODES).includes(savedTheme)) {
        setThemeMode(savedTheme);
      }
    }
  }, []);

  // Save selected theme
  useEffect(() => {
    if (isBrowser) {
      localStorage.setItem('themeMode', themeMode);
    }
  }, [themeMode]);

  // Determine system theme and resolve actual theme
  useEffect(() => {
    if (!isBrowser) return;
    
    const updateResolvedTheme = () => {
      if (themeMode === THEME_MODES.SYSTEM) {
        // Check system settings
        const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        setResolvedTheme(systemPrefersDark ? THEME_MODES.DARK : THEME_MODES.LIGHT);
      } else {
        setResolvedTheme(themeMode);
      }
    };

    updateResolvedTheme();

    // Listen for system theme changes
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      if (themeMode === THEME_MODES.SYSTEM) {
        updateResolvedTheme();
      }
    };

    // Add and remove listener
    mediaQuery.addEventListener('change', handleChange);
    return () => {
      mediaQuery.removeEventListener('change', handleChange);
    };
  }, [themeMode]);

  // Context value
  const contextValue = {
    themeMode,
    setThemeMode,
    resolvedTheme,
  };

  return (
    <ThemeContext.Provider value={contextValue}>
      {children}
    </ThemeContext.Provider>
  );
};

// Hook for using theme
export const useTheme = () => useContext(ThemeContext); 
import React, { useMemo, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider as MuiThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { GlobalStyles } from '@mui/material';
import { ThemeProvider, useTheme } from './contexts/ThemeContext';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { createAppTheme } from './theme';
import Header from './components/Header';

// Import pages
import HomePage from './pages/Home';
import LoginPage from './pages/Login';
import RegisterPage from './pages/Register';
import SettingsPage from './pages/Settings';

// Global styles to fix overflow and scrolling issues
const globalStyles = (
  <GlobalStyles
    styles={theme => ({
      'html, body': {
        margin: 0,
        padding: 0,
        height: '100%',
        width: '100%',
        overflow: 'hidden'
      },
      '#root': {
        height: '100%',
        width: '100%',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column'
      },
      '.main-content': {
        flexGrow: 1,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column'
      },
      // Explicitly override styles for links
      'a': {
        color: theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.85)' : 'rgba(0, 0, 0, 0.75)',
        textDecoration: 'none',
        WebkitTapHighlightColor: 'transparent',
      },
      'a:hover, a:focus': {
        color: theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 1)' : 'rgba(0, 0, 0, 0.95)',
        textDecoration: 'none',
      },
      'a:visited': {
        color: theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.85)' : 'rgba(0, 0, 0, 0.75)',
      }
    })}
  />
);

// PrivateRoute component to protect routes that require authentication
const PrivateRoute = ({ children }) => {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return <div>Loading...</div>; // You could replace this with a proper loading component
  }

  return isAuthenticated ? children : <Navigate to="/login" />;
};

// ThemedApp component applying the theme
function ThemedApp() {
  const { resolvedTheme } = useTheme();
  const theme = useMemo(() => createAppTheme(resolvedTheme), [resolvedTheme]);

  useEffect(() => {
    // Remove the server-side injected CSS
    const jssStyles = document.querySelector('#jss-server-side');
    if (jssStyles) {
      jssStyles.parentElement.removeChild(jssStyles);
    }
  }, []);

  return (
    <MuiThemeProvider theme={theme}>
      <CssBaseline />
      {globalStyles}
      <div style={{
        flexGrow: 1,
        display: 'flex',
        flexDirection: 'column',
        background: theme.palette.gradients.page,
        overflow: 'hidden'
      }}>
        <Header />
        <div className="main-content" style={{ background: 'none' }}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/settings" element={
              <PrivateRoute>
                <SettingsPage />
              </PrivateRoute>
            } />
          </Routes>
        </div>
      </div>
    </MuiThemeProvider>
  );
}

// Main App component
export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <ThemedApp />
      </AuthProvider>
    </ThemeProvider>
  );
}

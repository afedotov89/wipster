import * as React from 'react';
import Head from 'next/head';
import { ThemeProvider as MuiThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider, useTheme } from '../src/contexts/ThemeContext';
import { AuthProvider } from '../src/contexts/AuthContext';
import { createAppTheme } from '../src/theme';
import Header from '../src/components/Header';
import { GlobalStyles } from '@mui/material';

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
      '#__next': {
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
      // Еще раз явно переопределим стили для ссылок
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

// Internal component for applying the theme
function ThemedApp({ Component, pageProps }) {
  const { resolvedTheme } = useTheme();
  const theme = React.useMemo(() => createAppTheme(resolvedTheme), [resolvedTheme]);

  React.useEffect(() => {
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
          <Component {...pageProps} />
        </div>
      </div>
    </MuiThemeProvider>
  );
}

// Main App component
export default function App(props) {
  return (
    <>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>React App</title>
      </Head>
      <ThemeProvider>
        <AuthProvider>
          <ThemedApp {...props} />
        </AuthProvider>
      </ThemeProvider>
    </>
  );
}
import React, { useState, useEffect } from 'react';
import { useNavigate, Link as RouterLink } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Container, Box, Button, Typography, Alert, CircularProgress, Link as MuiLink, Paper, useTheme, TextField, Divider } from '@mui/material';
import FormField from '../components/FormField';
import GoogleLoginButton from '../components/GoogleLoginButton';

const LoginPage = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated) {
      navigate('/'); // Redirect to home page or dashboard
    }
  }, [isAuthenticated, navigate]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      // Redirect is handled by the useEffect hook
    } catch (err) {
      const errorMessage = err.response?.data?.non_field_errors?.[0] || 'Login failed. Please check your credentials.';
      setError(errorMessage);
      setLoading(false);
    }
  };

  return (
    <Container component="main" maxWidth="xs">
      <Box
        sx={{
          marginTop: 8,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <Paper
          elevation={0}
          sx={{
            p: 4,
            width: '100%',
            borderRadius: 2,
            backgroundColor: isDark ? 'rgba(25, 25, 25, 0.8)' : 'white',
            border: '1px solid',
            borderColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)'
          }}
        >
          <Typography component="h1" variant="h5" align="center" sx={{ mb: 3 }}>
            Sign In
          </Typography>
          <Box component="form" onSubmit={handleSubmit} noValidate>
            {error && <Alert severity="error" sx={{ width: '100%', mb: 2 }}>{error}</Alert>}
            <FormField
              required
              id="email"
              label="Email Address"
              name="email"
              autoComplete="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
            />
            <FormField
              required
              name="password"
              label="Password"
              type="password"
              id="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
            />
            <Button
              type="submit"
              fullWidth
              variant="contained"
              sx={{
                mt: 3,
                mb: 2,
                py: 1.2,
                backgroundColor: theme.palette.accent.main,
                color: theme.palette.accent.contrastText,
                border: '1px solid',
                borderColor: theme.palette.accent.main,
                borderRadius: 1.5,
                '&:hover': {
                  backgroundColor: theme.palette.accent.dark,
                  borderColor: theme.palette.accent.dark,
                }
              }}
              disabled={loading}
            >
              {loading ? <CircularProgress size={24} /> : 'Sign In'}
            </Button>
            <Divider sx={{ my: 2 }}>or</Divider>
            <GoogleLoginButton />
            <Box sx={{ display: 'flex', justifyContent: 'space-between', width: '100%', mt: 1 }}>
              <MuiLink
                component={RouterLink}
                to="/password-reset"
                variant="body2"
                underline="none"
                sx={{
                  cursor: 'pointer',
                  opacity: 0.85,
                  transition: 'all 0.2s ease',
                  position: 'relative',
                  '&::after': {
                    content: '""',
                    position: 'absolute',
                    width: '100%',
                    height: '1px',
                    bottom: -1,
                    left: 0,
                    backgroundColor: 'currentColor',
                    opacity: 0,
                    transition: 'opacity 0.2s ease',
                  },
                  '&:hover': {
                    opacity: 1,
                    '&::after': {
                      opacity: 0.7,
                    }
                  }
                }}
              >
                Forgot password?
              </MuiLink>
              <MuiLink
                component={RouterLink}
                to="/register"
                variant="body2"
                underline="none"
                sx={{
                  cursor: 'pointer',
                  opacity: 0.85,
                  transition: 'all 0.2s ease',
                  position: 'relative',
                  '&::after': {
                    content: '""',
                    position: 'absolute',
                    width: '100%',
                    height: '1px',
                    bottom: -1,
                    left: 0,
                    backgroundColor: 'currentColor',
                    opacity: 0,
                    transition: 'opacity 0.2s ease',
                  },
                  '&:hover': {
                    opacity: 1,
                    '&::after': {
                      opacity: 0.7,
                    }
                  }
                }}
              >
                {"Don't have an account? Sign Up"}
              </MuiLink>
            </Box>
          </Box>
        </Paper>
      </Box>
    </Container>
  );
};

export default LoginPage;
import React, { useState } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '../src/contexts/AuthContext';
import { Container, Box, Button, Typography, Alert, CircularProgress, Link as MuiLink, Paper, useTheme } from '@mui/material';
import Link from 'next/link';
import FormField from '../src/components/FormField';

const RegisterPage = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const { register, isAuthenticated } = useAuth();
  const router = useRouter();
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  // Redirect if already authenticated
  React.useEffect(() => {
    if (isAuthenticated) {
      router.push('/'); // Redirect to home page or dashboard
    }
  }, [isAuthenticated, router]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setSuccess('');

    if (password !== passwordConfirmation) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      // dj-rest-auth registration typically requires email, password, password confirmation
      await register({ email, password1: password, password2: passwordConfirmation });
      setSuccess('Registration successful! You can now log in.'); // Or redirect if registration logs user in
      // Optionally clear form or redirect
      // router.push('/login');
    } catch (err) {
      // Handle specific errors from the backend
      const errorData = err.response?.data;
      let errorMessage = 'Registration failed. Please try again.';
      if (errorData) {
        if (errorData.email) errorMessage = `Email: ${errorData.email[0]}`;
        else if (errorData.password) errorMessage = `Password: ${errorData.password[0]}`;
        else if (errorData.non_field_errors) errorMessage = errorData.non_field_errors[0];
      }
      setError(errorMessage);
    } finally {
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
            Sign Up
          </Typography>
          <Box component="form" onSubmit={handleSubmit} noValidate>
            {error && <Alert severity="error" sx={{ width: '100%', mb: 2 }}>{error}</Alert>}
            {success && <Alert severity="success" sx={{ width: '100%', mb: 2 }}>{success}</Alert>}
            <FormField
              required
              id="email"
              label="Email Address"
              name="email"
              autoComplete="email"
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
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
            />
            <FormField
              required
              name="passwordConfirmation"
              label="Confirm Password"
              type="password"
              id="passwordConfirmation"
              autoComplete="new-password"
              value={passwordConfirmation}
              onChange={(e) => setPasswordConfirmation(e.target.value)}
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
              {loading ? <CircularProgress size={24} /> : 'Sign Up'}
            </Button>
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', width: '100%', mt: 1 }}>
              <Link href="/login" passHref>
                <MuiLink
                  component="span"
                  variant="body2"
                  underline="none"
                  color="inherit"
                  sx={{
                    cursor: 'pointer',
                    opacity: 0.85,
                    transition: 'all 0.2s ease',
                    position: 'relative',
                    color: isDark ? 'rgba(255, 255, 255, 0.85) !important' : 'rgba(0, 0, 0, 0.7) !important',
                    textDecoration: 'none !important',
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
                      color: isDark ? 'rgba(255, 255, 255, 1) !important' : 'rgba(0, 0, 0, 0.95) !important',
                      '&::after': {
                        opacity: 0.7,
                      }
                    }
                  }}
                >
                  Already have an account? Sign in
                </MuiLink>
              </Link>
            </Box>
          </Box>
        </Paper>
      </Box>
    </Container>
  );
};

export default RegisterPage;
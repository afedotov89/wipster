import React from 'react';
import { Container, Typography, Button, Box, Paper } from '@mui/material';
import { useAuth } from '../src/contexts/AuthContext';

export default function Home() {
  const { isAuthenticated, user } = useAuth();

  return (
    <Container maxWidth="md">
      <Box sx={{ mt: 8, mb: 4, textAlign: 'center' }}>
        <Typography variant="h3" component="h1" gutterBottom>
          React + Django Boilerplate
        </Typography>
        <Typography variant="h5" color="textSecondary" paragraph>
          A modern full-stack starter template with authentication & theming
        </Typography>
      </Box>

      <Paper sx={{ p: 4, borderRadius: 2 }}>
        {isAuthenticated ? (
          <Typography variant="body1">
            Welcome back, {user?.email || 'User'}! You are logged in.
          </Typography>
        ) : (
          <Typography variant="body1">
            Please log in to access all features.
          </Typography>
        )}
      </Paper>
    </Container>
  );
}
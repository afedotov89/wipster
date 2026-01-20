import React from 'react';
import { Container, Typography, Box, Paper } from '@mui/material';
import { useAuth } from '../contexts/AuthContext';

export default function HomePage() {
  const { user } = useAuth();

  return (
    <Container maxWidth="lg" sx={{ py: 4, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <Paper elevation={3} sx={{ p: 4, borderRadius: 2 }}>
          <Typography variant="h4" component="h1" gutterBottom>
            Welcome to the Web App
          </Typography>
          {user && (
            <Typography variant="body1">
              You are logged in as {user.email}
            </Typography>
          )}
        </Paper>
      </Box>
    </Container>
  );
}
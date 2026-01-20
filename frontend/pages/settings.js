import React, { useState, useEffect } from 'react';
import { 
  Container, 
  Typography, 
  Paper, 
  Box, 
  Radio, 
  RadioGroup, 
  FormControlLabel, 
  FormControl, 
  FormLabel,
  Divider,
  IconButton
} from '@mui/material';
import { useTheme, THEME_MODES } from '../src/contexts/ThemeContext';
import Link from 'next/link';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';

export default function Settings() {
  // First set local state to default
  const [localThemeMode, setLocalThemeMode] = useState(THEME_MODES.SYSTEM);
  
  // Safely get theme context
  const themeContext = useTheme();
  
  // Synchronize local state with context on mounting
  useEffect(() => {
    if (themeContext?.themeMode) {
      setLocalThemeMode(themeContext.themeMode);
    }
  }, [themeContext?.themeMode]);

  const handleThemeChange = (event) => {
    const newTheme = event.target.value;
    setLocalThemeMode(newTheme);
    
    // Safely update the global state
    if (themeContext?.setThemeMode) {
      themeContext.setThemeMode(newTheme);
    }
  };

  return (
    <Container maxWidth="md">
      <Box my={4}>
        <Box display="flex" alignItems="center" mb={4}>
          <Link href="/" passHref>
            <IconButton 
              aria-label="back"
              sx={{ mr: 2 }}
            >
              <ArrowBackIcon />
            </IconButton>
          </Link>
          <Typography variant="h4" component="h1">
            Settings
          </Typography>
        </Box>
        
        <Paper 
          elevation={0} 
          sx={{ 
            p: 3, 
            borderRadius: 2, 
            border: '1px solid',
            borderColor: (theme) => theme.palette.mode === 'dark' 
              ? 'rgba(255, 255, 255, 0.1)' 
              : 'rgba(0, 0, 0, 0.1)'
          }}
        >
          <Typography variant="h6" gutterBottom>
            Appearance Settings
          </Typography>
          <Divider sx={{ mb: 3 }} />

          <FormControl component="fieldset">
            <FormLabel component="legend" sx={{ mb: 1 }}>Theme</FormLabel>
            <RadioGroup
              aria-label="theme-mode"
              name="theme-mode"
              value={localThemeMode}
              onChange={handleThemeChange}
            >
              <FormControlLabel 
                value={THEME_MODES.LIGHT} 
                control={<Radio />} 
                label="Light" 
                sx={{ mb: 1 }}
              />
              <FormControlLabel 
                value={THEME_MODES.DARK} 
                control={<Radio />} 
                label="Dark" 
                sx={{ mb: 1 }}
              />
              <FormControlLabel 
                value={THEME_MODES.SYSTEM} 
                control={<Radio />} 
                label="System (default)" 
              />
            </RadioGroup>
          </FormControl>
        </Paper>
      </Box>
    </Container>
  );
} 
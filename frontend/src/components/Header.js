import React, { useState } from 'react';
import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import SettingsIcon from '@mui/icons-material/Settings';
import LightModeIcon from '@mui/icons-material/LightMode';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import LoginIcon from '@mui/icons-material/Login';
import LogoutIcon from '@mui/icons-material/Logout';
import { Link } from 'react-router-dom';
import { Box, Tooltip, Container, Button, Menu, MenuItem, ListItemIcon, ListItemText, SvgIcon, CircularProgress } from '@mui/material';
import { useTheme, THEME_MODES } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';

// Custom split theme icon component (half light, half dark)
const SplitThemeIcon = (props) => {
  let themeMode = THEME_MODES.SYSTEM;

  try {
    const themeContext = useTheme();
    themeMode = themeContext?.themeMode || THEME_MODES.SYSTEM;
  } catch (error) {
    console.error('Error using theme context:', error);
  }

  const uniqueId = React.useId(); // Generate unique ID for SVG elements
  const leftClipId = `leftHalf-${uniqueId}`;
  const rightClipId = `rightHalf-${uniqueId}`;

  return (
    <SvgIcon {...props}>
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <clipPath id={leftClipId}>
            <rect x="0" y="0" width="12" height="24" />
          </clipPath>
          <clipPath id={rightClipId}>
            <rect x="12" y="0" width="12" height="24" />
          </clipPath>
        </defs>
        {/* Light half */}
        <circle
          cx="12"
          cy="12"
          r="9"
          fill="#ffffff"
          stroke="currentColor"
          strokeWidth="0.5"
          clipPath={`url(#${leftClipId})`}
        />
        {/* Dark half */}
        <circle
          cx="12"
          cy="12"
          r="9"
          fill="#121212"
          stroke="currentColor"
          strokeWidth="0.5"
          clipPath={`url(#${rightClipId})`}
        />
        {/* Circle outline */}
        <circle
          cx="12"
          cy="12"
          r="9"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
        />
        {/* Divider line */}
        <line
          x1="12"
          y1="3"
          x2="12"
          y2="21"
          stroke="currentColor"
          strokeWidth="0.75"
        />
      </svg>
    </SvgIcon>
  );
};

// Header component
const Header = () => {
  // Theme context hook
  let themeMode = THEME_MODES.SYSTEM;
  let setThemeMode = () => {};
  try {
    const themeContext = useTheme();
    themeMode = themeContext?.themeMode || THEME_MODES.SYSTEM;
    setThemeMode = themeContext?.setThemeMode || (() => {});
  } catch (error) {
    console.error('Error using theme context:', error);
  }

  // Auth context hook
  const { user, isAuthenticated, isLoading, logout } = useAuth();

  // State for theme menu
  const [themeMenuAnchorEl, setThemeMenuAnchorEl] = useState(null);
  const isThemeMenuOpen = Boolean(themeMenuAnchorEl);

  // Handler for opening theme menu
  const handleThemeMenuOpen = (event) => {
    setThemeMenuAnchorEl(event.currentTarget);
  };

  // Handler for closing theme menu
  const handleThemeMenuClose = () => {
    setThemeMenuAnchorEl(null);
  };

  // Handler for changing theme
  const handleThemeChange = (newTheme) => {
    setThemeMode(newTheme);
    handleThemeMenuClose();
  };

  // Defining theme icon based on current theme
  const getThemeIcon = () => {
    switch (themeMode) {
      case THEME_MODES.LIGHT:
        return <LightModeIcon fontSize="small" />;
      case THEME_MODES.DARK:
        return <DarkModeIcon fontSize="small" />;
      default:
        return <SplitThemeIcon fontSize="small" />;
    }
  };

  // Tooltip text for current theme
  const getThemeText = () => {
    switch (themeMode) {
      case THEME_MODES.LIGHT:
        return 'Light Theme';
      case THEME_MODES.DARK:
        return 'Dark Theme';
      default:
        return 'System Theme';
    }
  };

  return (
    <AppBar
      position="static"
      color="transparent"
      elevation={0}
      sx={(theme) => ({
        marginLeft: '-24px',
        marginRight: '-24px',
        width: 'calc(100% + 48px)',
        background: 'none',
        backgroundColor: 'transparent',
        backdropFilter: 'blur(8px)',
        boxShadow: theme.palette.mode === 'dark'
          ? '0 1px 2px rgba(255, 255, 255, 0.08)' // Light shadow for dark theme
          : '0 1px 2px rgba(0, 0, 0, 0.1)',      // Dark shadow for light theme
        border: 'none',
        position: 'relative',
        zIndex: 3,
      })}
    >
      <Container
        maxWidth={false}
        disableGutters
        sx={{
          width: '100%',
          maxWidth: 'none'
        }}
      >
        <Toolbar
          disableGutters
          sx={{
            px: { xs: 4, sm: 4.5 },
            py: 1
          }}
        >
          <Link to="/" style={{ textDecoration: 'none', color: 'inherit', flexGrow: 1, paddingLeft: '0.75rem' }}>
            <Typography
              variant="h6"
              component="div"
              sx={{
                fontWeight: 500,
                letterSpacing: 0.5
              }}
            >
              React + Django Boilerplate
            </Typography>
          </Link>

          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <Link to="/settings">
              <Button
                variant="text"
                startIcon={<SettingsIcon />}
                sx={{
                  mr: 2,
                  textTransform: 'none',
                  fontWeight: 'medium',
                  opacity: 0.7,
                  '&:hover': {
                    opacity: 1
                  }
                }}
              >
                Settings
              </Button>
            </Link>

            {/* Authentication Section */}
            {isLoading ? (
              <CircularProgress size={24} sx={{ mx: 1, color: 'inherit' }} />
            ) : isAuthenticated ? (
              <>
                <Typography variant="body2" sx={{ mx: 1, opacity: 0.8 }}>
                  {user?.email}
                </Typography>
                <Tooltip title="Logout">
                  <IconButton
                    onClick={logout}
                    color="inherit"
                    sx={{
                      opacity: 0.7,
                      '&:hover': {
                        opacity: 1
                      }
                    }}
                  >
                    <LogoutIcon />
                  </IconButton>
                </Tooltip>
              </>
            ) : (
              <>
                <Link to="/login">
                  <Button
                    variant="text"
                    startIcon={<LoginIcon />}
                    sx={{
                      mr: 1,
                      textTransform: 'none',
                      fontWeight: 'medium',
                      opacity: 0.7,
                      '&:hover': {
                        opacity: 1,
                        backgroundColor: 'action.hover'
                      }
                    }}
                  >
                    Login
                  </Button>
                </Link>
                <Link to="/register">
                  <Button
                    variant="outlined"
                    sx={{
                      textTransform: 'none',
                      fontWeight: 'medium'
                    }}
                  >
                    Sign Up
                  </Button>
                </Link>
              </>
            )}

            {/* Theme Picker */}
            <Tooltip title={getThemeText()}>
              <IconButton
                onClick={handleThemeMenuOpen}
                color="inherit"
                aria-label="Change theme"
                sx={{
                  ml: 2,
                  opacity: 0.7,
                  '&:hover': {
                    opacity: 1
                  }
                }}
              >
                {getThemeIcon()}
              </IconButton>
            </Tooltip>
            <Menu
              anchorEl={themeMenuAnchorEl}
              open={isThemeMenuOpen}
              onClose={handleThemeMenuClose}
              PaperProps={{
                elevation: 2,
                sx: { minWidth: 180 }
              }}
            >
              <MenuItem onClick={() => handleThemeChange(THEME_MODES.LIGHT)}>
                <ListItemIcon>
                  <LightModeIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>Light Theme</ListItemText>
              </MenuItem>
              <MenuItem onClick={() => handleThemeChange(THEME_MODES.DARK)}>
                <ListItemIcon>
                  <DarkModeIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>Dark Theme</ListItemText>
              </MenuItem>
              <MenuItem onClick={() => handleThemeChange(THEME_MODES.SYSTEM)}>
                <ListItemIcon>
                  <SplitThemeIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>System Theme</ListItemText>
              </MenuItem>
            </Menu>
          </Box>
        </Toolbar>
      </Container>
    </AppBar>
  );
};

export default Header;

import { createTheme } from '@mui/material/styles';

// Function for creating a theme based on mode (light, dark or system)
export const createAppTheme = (mode) => {
  const isDark = mode === 'dark';

  // Friendly Green accent color for primary actions
  const friendlyGreen = {
    main: isDark ? '#4CAF50' : '#23b02a', // User requested green for light theme
    light: isDark ? '#66BB6A' : '#42c847', // Adjusted light shade for #23b02a
    dark: isDark ? '#388E3C' : '#1b8a21', // Adjusted dark shade for #23b02a
    contrastText: '#ffffff',
  };

  // Neutral colors for light and dark themes
  const neutral = {
    main: isDark ? 'rgba(255, 255, 255, 0.9)' : 'rgba(0, 0, 0, 0.7)',
    light: isDark ? 'rgba(255, 255, 255, 0.7)' : 'rgba(0, 0, 0, 0.5)',
    dark: isDark ? 'rgba(255, 255, 255, 1)' : 'rgba(0, 0, 0, 0.9)',
    contrastText: isDark ? '#121212' : '#ffffff',
  };

  // Серый нейтральный цвет для вторичных элементов
  const neutralGrey = {
    main: isDark ? 'rgba(255, 255, 255, 0.8)' : 'rgba(0, 0, 0, 0.6)',
    light: isDark ? 'rgba(255, 255, 255, 0.6)' : 'rgba(0, 0, 0, 0.4)',
    dark: isDark ? 'rgba(255, 255, 255, 1)' : 'rgba(0, 0, 0, 0.8)',
    contrastText: isDark ? '#121212' : '#ffffff',
  };

  // Gradient configuration
  const gradients = {
    // Header gradient (horizontal)
    header: isDark
      ? 'linear-gradient(90deg, rgba(40,40,40,0.3) 0%, rgba(30,30,30,0.1) 70%, rgba(30,30,30,0) 100%)'
      : 'linear-gradient(90deg, rgba(76, 175, 80, 0.05) 0%, rgba(250,250,250,0.03) 50%, rgba(255,255,255,0) 100%)',

    // Page background with radial "spots" gradients
    page: isDark
      ? 'radial-gradient(circle at 15% 15%, rgba(76, 175, 80, 0.04) 0%, rgba(0, 0, 0, 0) 35%), ' +
        'radial-gradient(circle at 85% 30%, rgba(76, 175, 80, 0.035) 0%, rgba(0, 0, 0, 0) 40%), ' +
        'radial-gradient(circle at 30% 65%, rgba(76, 175, 80, 0.03) 0%, rgba(0, 0, 0, 0) 35%), ' +
        'radial-gradient(circle at 70% 85%, rgba(76, 175, 80, 0.025) 0%, rgba(0, 0, 0, 0) 30%)'
      : 'radial-gradient(circle at 15% 15%, rgba(76, 175, 80, 0.035) 0%, rgba(255, 255, 255, 0) 35%), ' +
        'radial-gradient(circle at 85% 30%, rgba(76, 175, 80, 0.03) 0%, rgba(255, 255, 255, 0) 40%), ' +
        'radial-gradient(circle at 30% 65%, rgba(76, 175, 80, 0.025) 0%, rgba(255, 255, 255, 0) 35%), ' +
        'radial-gradient(circle at 70% 85%, rgba(76, 175, 80, 0.02) 0%, rgba(255, 255, 255, 0) 30%)',

    // Panel header gradient (top to bottom)
    panelHeader: isDark
      ? 'linear-gradient(180deg, rgba(76, 175, 80, 0.055) 0%, rgba(30,30,30,0) 100%)'
      : 'linear-gradient(180deg, rgba(76, 175, 80, 0.05) 0%, rgba(255,255,255,0) 100%)',
  };

  return createTheme({
    palette: {
      mode,
      primary: neutral,
      secondary: neutralGrey,
      accent: friendlyGreen, // Add our green accent color
      gradients, // Add our gradients to the palette
      background: {
        default: isDark ? '#121212' : '#ffffff',
        paper: isDark ? '#1e1e1e' : '#ffffff',
      },
      text: {
        primary: isDark ? 'rgba(255, 255, 255, 0.95)' : 'rgba(0, 0, 0, 0.87)',
        secondary: isDark ? 'rgba(255, 255, 255, 0.8)' : 'rgba(0, 0, 0, 0.6)',
      },
      action: {
        active: isDark ? 'rgba(255, 255, 255, 0.9)' : 'rgba(0, 0, 0, 0.7)',
        hover: isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.05)',
      },
    },
    typography: {
      fontFamily: [
        '-apple-system',
        'BlinkMacSystemFont',
        '"Segoe UI"',
        'Roboto',
        '"Helvetica Neue"',
        'Arial',
        'sans-serif',
      ].join(','),
    },
    shape: {
      borderRadius: 6,
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: (theme) => ({
          'a': {
            color: theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.85)' : 'rgba(0, 0, 0, 0.75)',
            textDecoration: 'none',
            '-webkit-tap-highlight-color': 'transparent'
          },
          'a:hover, a:focus': {
            color: theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 1)' : 'rgba(0, 0, 0, 0.95)',
            textDecoration: 'none',
          },
          'a:visited': {
            color: theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.85)' : 'rgba(0, 0, 0, 0.75)',
          },
        }),
      },
      MuiButton: {
        defaultProps: {
          disableElevation: true, // Disable button shadows
        },
        styleOverrides: {
          root: ({ theme }) => ({
            textTransform: 'none', // Remove capitalization on buttons
            fontWeight: 500,
            // Add hover style for icons within the button
            '&:hover .MuiSvgIcon-root': {
              color: theme.palette.accent.main,
            },
          }),
          // Settings for outlined button variant
          outlined: ({ theme }) => ({
            borderColor: theme.palette.mode === 'dark'
              ? 'rgba(255, 255, 255, 0.23)'
              : 'rgba(0, 0, 0, 0.23)',
            '&:hover': {
              backgroundColor: theme.palette.mode === 'dark'
                ? 'rgba(255, 255, 255, 0.05)'
                : 'rgba(0, 0, 0, 0.05)',
              borderColor: theme.palette.mode === 'dark'
                ? 'rgba(255, 255, 255, 0.4)'
                : 'rgba(0, 0, 0, 0.4)',
            }
          }),
          // Settings for contained button variant
          contained: ({ theme }) => ({
            backgroundColor: theme.palette.mode === 'dark'
              ? 'rgba(255, 255, 255, 0.1)'
              : 'rgba(0, 0, 0, 0.08)',
            color: theme.palette.text.primary,
            '&:hover': {
              backgroundColor: theme.palette.mode === 'dark'
                ? 'rgba(255, 255, 255, 0.2)'
                : 'rgba(0, 0, 0, 0.15)',
            }
          }),
          // Settings for primary action buttons with green accent
          containedAccent: {
            backgroundColor: friendlyGreen.main,
            color: friendlyGreen.contrastText,
            '&:hover': {
              backgroundColor: friendlyGreen.dark,
            }
          },
          outlinedAccent: {
            borderColor: friendlyGreen.main,
            color: friendlyGreen.main,
            '&:hover': {
              backgroundColor: 'rgba(76, 175, 80, 0.08)',
              borderColor: friendlyGreen.dark,
            }
          },
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: ({ theme }) => ({
            color: theme.palette.text.primary,
            '&:hover': {
              color: theme.palette.accent.main,
            }
          }),
        },
      },
      MuiAppBar: {
        styleOverrides: {
          colorTransparent: {
            // Subtle shadow instead of border
            borderBottom: 'none',
            boxShadow: 'none', // Removed the shadow
          },
        },
      },
      MuiDivider: {
        styleOverrides: {
          root: {
            borderColor: mode === 'dark' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)',
          },
        },
      },
      MuiSvgIcon: {
        styleOverrides: {
          root: ({ theme }) => ({
            color: 'inherit',
          }),
        },
      },
      MuiTextField: {
        styleOverrides: {
          root: ({ theme }) => ({
            '& .MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline': {
              borderColor: theme.palette.mode === 'dark'
                ? theme.palette.accent.light
                : theme.palette.accent.main,
              borderWidth: 1,
            },
            '& .MuiInputLabel-root.Mui-focused': {
              color: theme.palette.mode === 'dark'
                ? theme.palette.accent.light
                : theme.palette.accent.main,
            },
          })
        }
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: ({ theme }) => ({
            backgroundColor: theme.palette.background.paper,
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
              borderColor: theme.palette.mode === 'dark'
                ? theme.palette.accent.light
                : theme.palette.accent.main,
              borderWidth: 1,
            },
            '&:hover .MuiOutlinedInput-notchedOutline': {
              borderColor: theme.palette.mode === 'dark'
                ? 'rgba(255, 255, 255, 0.3)'
                : 'rgba(0, 0, 0, 0.3)',
            },
          }),
        },
      },
      MuiSelect: {
        styleOverrides: {
          root: ({ theme }) => ({
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
              borderColor: theme.palette.mode === 'dark'
                ? theme.palette.accent.light
                : theme.palette.accent.main,
            },
          }),
        },
      },
      MuiSlider: {
        styleOverrides: {
          thumb: {
            '&.Mui-active': {
              boxShadow: '0px 0px 0px 8px rgba(76, 175, 80, 0.16)',
            },
            '&:hover': {
              boxShadow: '0px 0px 0px 8px rgba(76, 175, 80, 0.1)',
            },
            '&.Mui-focusVisible': {
              boxShadow: '0px 0px 0px 8px rgba(76, 175, 80, 0.16)',
            },
          },
          track: ({ theme }) => ({
            backgroundColor: theme.palette.accent.main,
          }),
          rail: {
            opacity: 0.25,
          },
        },
      },
      MuiCheckbox: {
        styleOverrides: {
          root: ({ theme }) => ({
            '&.Mui-checked': {
              color: theme.palette.mode === 'dark'
                ? theme.palette.accent.light
                : theme.palette.accent.main,
            },
          }),
        },
      },
      MuiLink: {
        defaultProps: {
          underline: 'none',
          color: 'inherit'
        },
        styleOverrides: {
          root: ({ theme }) => ({
            color: theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.85)' : 'rgba(0, 0, 0, 0.75)',
            textDecoration: 'none',
            position: 'relative',
            WebkitTapHighlightColor: 'transparent',
            '&:visited': {
              color: theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.85)' : 'rgba(0, 0, 0, 0.75)',
            },
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
              color: `${theme.palette.accent.main} !important`,
              textDecoration: 'none',
              '&::after': {
                opacity: 0.6,
              }
            }
          })
        }
      },
      MuiMenuItem: {
        styleOverrides: {
          root: ({ theme }) => ({
            '&:hover': {
              backgroundColor: theme.palette.mode === 'dark'
                ? 'rgba(76, 175, 80, 0.1)' // Dark green hover
                : 'rgba(76, 175, 80, 0.08)', // Light green hover
            },
            '&.Mui-selected': {
              backgroundColor: theme.palette.mode === 'dark'
                ? 'rgba(76, 175, 80, 0.15)' // Darker green for selected
                : 'rgba(76, 175, 80, 0.12)', // Lighter green for selected
              '&:hover': {
                backgroundColor: theme.palette.mode === 'dark'
                  ? 'rgba(76, 175, 80, 0.2)' // Darker green on hover when selected
                  : 'rgba(76, 175, 80, 0.16)', // Lighter green on hover when selected
              }
            }
          }),
        },
      },
    },
  });
};

// Export light theme as default
const theme = createAppTheme('light');

export default theme;
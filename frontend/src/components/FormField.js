import React from 'react';
import { TextField, useTheme } from '@mui/material';

/**
 * FormField - A styled TextField component for forms with better dark mode support
 *
 * @param {Object} props - Props passed to MUI TextField
 * @returns {JSX.Element} Styled TextField component
 */
const FormField = (props) => {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  return (
    <TextField
      margin="normal"
      fullWidth
      variant="outlined"
      color="secondary"
      {...props}
      InputLabelProps={{
        style: {
          color: isDark ? 'rgba(255, 255, 255, 0.8)' : 'rgba(0, 0, 0, 0.6)',
        },
        ...props.InputLabelProps
      }}
      InputProps={{
        style: {
          color: isDark ? 'rgba(255, 255, 255, 0.95)' : 'rgba(0, 0, 0, 0.87)',
        },
        ...props.InputProps
      }}
      sx={{
        '& .MuiInputBase-root': {
          backgroundColor: isDark ? 'rgba(30, 30, 30, 0.6)' : 'rgba(255, 255, 255, 0.9)',
          borderRadius: 1.5,
          height: '52px',
        },
        '& .MuiOutlinedInput-root': {
          '& fieldset': {
            borderColor: isDark ? 'rgba(255, 255, 255, 0.25)' : 'rgba(0, 0, 0, 0.15)',
            borderWidth: '1px'
          },
          '&:hover fieldset': {
            borderColor: isDark ? 'rgba(255, 255, 255, 0.4)' : 'rgba(0, 0, 0, 0.3)',
          },
          '&.Mui-focused fieldset': {
            borderColor: isDark ? 'rgba(255, 255, 255, 0.7)' : 'rgba(70, 70, 70, 0.8)',
            borderWidth: '1px',
          },
        },
        '& .MuiInputLabel-root': {
          color: isDark ? 'rgba(255, 255, 255, 0.8)' : 'rgba(0, 0, 0, 0.6)',
        },
        '& .MuiInputLabel-root.Mui-focused': {
          color: isDark ? 'rgba(255, 255, 255, 0.95)' : 'rgba(70, 70, 70, 0.9)',
        },
        '& .MuiInputBase-input': {
          padding: '14px',
        },
        '& .MuiInputBase-input:-webkit-autofill': {
          WebkitBoxShadow: isDark
            ? '0 0 0 100px rgba(40, 40, 40, 0.9) inset !important'
            : '0 0 0 100px rgba(245, 245, 245, 0.9) inset !important',
          WebkitTextFillColor: isDark
            ? 'rgba(255, 255, 255, 0.95) !important'
            : 'rgba(0, 0, 0, 0.9) !important',
          caretColor: isDark ? 'rgba(255, 255, 255, 0.95)' : 'rgba(0, 0, 0, 0.9)',
          borderRadius: '6px',
        },
        ...props.sx
      }}
    />
  );
};

export default FormField;
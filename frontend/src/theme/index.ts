import { createTheme } from "@mui/material/styles";

export const theme = createTheme({
  palette: {
    mode: "dark",
    primary: { main: "#2E7D6F" },
    secondary: { main: "#4A8C6E" },
    background: {
      default: "#0f1a17",
      paper: "#162220",
    },
  },
  typography: {
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif",
    fontSize: 13,
  },
  shape: { borderRadius: 10 },
  components: {
    MuiOutlinedInput: {
      styleOverrides: {
        notchedOutline: {
          "& legend": { transition: "none" },
        },
      },
    },
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          userSelect: "none",
          cursor: "default",
          backgroundImage: [
            "radial-gradient(ellipse 120% 80% at 15% 25%, rgba(46,125,111,0.09) 0%, rgba(46,125,111,0.03) 40%, transparent 70%)",
            "radial-gradient(ellipse 100% 100% at 85% 15%, rgba(74,140,110,0.06) 0%, rgba(74,140,110,0.02) 35%, transparent 65%)",
            "radial-gradient(ellipse 130% 90% at 55% 85%, rgba(40,110,90,0.08) 0%, rgba(40,110,90,0.02) 45%, transparent 75%)",
            "radial-gradient(ellipse 90% 120% at 5% 65%, rgba(30,80,65,0.1) 0%, rgba(30,80,65,0.03) 40%, transparent 70%)",
            "radial-gradient(ellipse 110% 70% at 90% 55%, rgba(50,130,100,0.05) 0%, rgba(50,130,100,0.01) 35%, transparent 60%)",
          ].join(", "),
          backgroundAttachment: "fixed",
        },
      },
    },
  },
});

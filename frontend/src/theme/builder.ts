import { createTheme, Theme } from "@mui/material/styles";
import type { ThemeDef } from "./themes";

export function buildMuiTheme(def: ThemeDef): Theme {
  return createTheme({
    palette: {
      mode: def.mode,
      primary: { main: def.primary },
      secondary: { main: def.secondary },
      background: {
        default: def.bgDefault,
        paper: def.bgPaper,
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
          notchedOutline: { "& legend": { transition: "none" } },
        },
      },
      MuiCssBaseline: {
        styleOverrides: {
          ":root": {
            "--overlay-1": def.overlay[0],
            "--overlay-2": def.overlay[1],
            "--overlay-3": def.overlay[2],
            "--overlay-4": def.overlay[3],
            "--text-strong": def.overlay[4],
          },
          body: {
            userSelect: "none",
            cursor: "default",
            backgroundColor: def.bgDefault,
            backgroundImage: def.ambient,
            backgroundAttachment: "fixed",
            transition: "background-color 400ms ease, background-image 400ms ease, color 400ms ease",
          },
        },
      },
    },
  });
}

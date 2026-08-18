import { createTheme, Theme } from "@mui/material/styles";
import type { ThemeDef } from "./themes";
import { SCENES } from "./scenes";

export function buildMuiTheme(def: ThemeDef): Theme {
  const layers = SCENES[def.id] ?? [];

  const imageList: string[] = layers.map((l) => l.image);
  const positionList: string[] = layers.map((l) => l.position ?? "center");
  const sizeList: string[] = layers.map((l) => l.size ?? "cover");
  const repeatList: string[] = layers.map((l) => l.repeat ?? "no-repeat");

  // Ambient gradients sit underneath, each with its own position/size/repeat so
  // the four lists stay the same length
  for (const gradient of def.ambient) {
    imageList.push(gradient);
    positionList.push("center");
    sizeList.push("auto");
    repeatList.push("no-repeat");
  }

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
          root: { backgroundColor: def.bgPaper },
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
            // A card has to read as a card against a textured board. Measured
            // against a top-tier reference (Excalidraw's floating toolbar edge,
            // 1.53:1), shadow alone was leaving light themes at 1.01–1.07:1 —
            // the shadow simply did not register at the boundary. The hairline
            // ring is what the reference uses too, and it carries the edge.
            "--card-shadow": def.mode === "light"
              ? "0 0 0 1px rgba(0,0,0,0.24), 0 1px 2px rgba(0,0,0,0.06), 0 3px 8px rgba(0,0,0,0.08)"
              : "0 0 0 1px rgba(255,255,255,0.22), 0 1px 3px rgba(0,0,0,0.28)",
            "--card-shadow-drag": def.mode === "light"
              ? "0 4px 12px rgba(0,0,0,0.10), 0 8px 24px rgba(0,0,0,0.08)"
              : "0 4px 8px rgba(0,0,0,0.3)",
            // The sidebar is a tinted pane over the SAME background, not an
            // opaque slab of bgDefault. Filling it with bgDefault left it
            // 22–59 luminance levels darker than the board on every dark
            // theme, because the board is that colour plus all the ambient
            // blooms while the sidebar blocked them.
            "--sidebar-tint": def.mode === "light"
              ? "rgba(255,255,255,0.30)"
              : "rgba(0,0,0,0.15)",
            colorScheme: def.mode,
          },
          body: {
            userSelect: "none",
            cursor: "default",
            backgroundColor: def.bgDefault,
            backgroundImage: imageList.join(", "),
            backgroundPosition: positionList.join(", "),
            backgroundSize: sizeList.join(", "),
            backgroundRepeat: repeatList.join(", "),
            backgroundAttachment: "fixed",
            transition: "background-color 400ms ease, background-image 400ms ease, color 400ms ease",
          },
          "*::-webkit-scrollbar": { width: 10, height: 10 },
          "*::-webkit-scrollbar-track": { background: "transparent" },
          "*::-webkit-scrollbar-thumb": {
            background: def.overlay[2],
            borderRadius: 5,
            border: `2px solid transparent`,
            backgroundClip: "padding-box",
          },
          "*::-webkit-scrollbar-thumb:hover": {
            background: def.overlay[3],
            backgroundClip: "padding-box",
            border: `2px solid transparent`,
          },
          "*::-webkit-scrollbar-corner": { background: "transparent" },
        },
      },
    },
  });
}

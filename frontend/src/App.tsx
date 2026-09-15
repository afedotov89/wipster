import { useEffect, useMemo } from "react";
import { ThemeProvider, CssBaseline, Box } from "@mui/material";
import { buildMuiTheme } from "./theme/builder";
import { useThemeStore } from "./theme/store";
import { useSettingsStore } from "./stores/settingsStore";
import { useAiUiCommands } from "./stores/aiUiCommands";
import AppShell from "./components/layout/AppShell";
import { useUndoRedo } from "./hooks/useUndoRedo";
import { useAutoUpdater } from "./hooks/useAutoUpdater";
import UpdateBanner from "./components/layout/UpdateBanner";
import { useUpdateStore } from "./stores/updateStore";

function AppContent() {
  useUndoRedo();
  useAutoUpdater();
  // The window buttons float over whatever is at the top of the window: the
  // sidebar's own title band normally, the update banner when there is one.
  const bannerShowing = useUpdateStore((s) => s.available || s.justUpdated);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
      <UpdateBanner />
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <AppShell windowButtonsOverlap={!bannerShowing} />
      </Box>
    </Box>
  );
}

export default function App() {
  const current = useThemeStore((s) => s.current);
  const hydrateFromDb = useThemeStore((s) => s.hydrateFromDb);
  const hydrateSettings = useSettingsStore((s) => s.hydrate);
  const muiTheme = useMemo(() => buildMuiTheme(current), [current]);

  useEffect(() => { hydrateFromDb(); }, [hydrateFromDb]);
  useEffect(() => { hydrateSettings(); }, [hydrateSettings]);
  // Lets the assistant switch views, open a task or change the theme.
  useAiUiCommands();

  return (
    <ThemeProvider theme={muiTheme}>
      <CssBaseline />
      <AppContent />
    </ThemeProvider>
  );
}

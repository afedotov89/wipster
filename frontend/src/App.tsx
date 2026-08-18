import { useEffect, useMemo } from "react";
import { ThemeProvider, CssBaseline, Box, Typography, Button, LinearProgress } from "@mui/material";
import SystemUpdateIcon from "@mui/icons-material/SystemUpdate";
import { buildMuiTheme } from "./theme/builder";
import { useThemeStore } from "./theme/store";
import AppShell from "./components/layout/AppShell";
import { useUndoRedo } from "./hooks/useUndoRedo";
import { useAutoUpdater } from "./hooks/useAutoUpdater";
import { useI18n } from "./i18n";
import { TITLEBAR_HEIGHT, TRAFFIC_LIGHTS_WIDTH } from "./utils/constants";

function UpdateBanner({ available, version, downloading, progress, ready, downloadAndInstall, installAndRelaunch }: ReturnType<typeof useAutoUpdater>) {
  const { locale } = useI18n();

  if (!available) return null;

  return (
    <Box
      sx={{
        pl: `${TRAFFIC_LIGHTS_WIDTH}px`,
        pr: 2,
        py: 0.75,
        minHeight: TITLEBAR_HEIGHT,
        flexShrink: 0,
        bgcolor: "primary.main",
        color: "white",
        display: "flex",
        alignItems: "center",
        gap: 1,
        fontSize: 12,
      }}
    >
      <SystemUpdateIcon sx={{ fontSize: 16 }} />
      {ready ? (
        <>
          <Typography variant="caption" sx={{ flex: 1 }}>
            {locale === "ru" ? `Обновление ${version} готово` : `Update ${version} ready`}
          </Typography>
          <Button size="small" variant="outlined" sx={{ color: "white", borderColor: "white", fontSize: 11 }} onClick={installAndRelaunch}>
            {locale === "ru" ? "Перезапустить" : "Restart"}
          </Button>
        </>
      ) : downloading ? (
        <>
          <Typography variant="caption" sx={{ flex: 1 }}>
            {locale === "ru" ? "Загрузка..." : "Downloading..."} {progress}%
          </Typography>
          <LinearProgress variant="determinate" value={progress} sx={{ width: 80, height: 4, borderRadius: 2 }} />
        </>
      ) : (
        <>
          <Typography variant="caption" sx={{ flex: 1 }}>
            {locale === "ru" ? `Доступно обновление ${version}` : `Update ${version} available`}
          </Typography>
          <Button size="small" variant="outlined" sx={{ color: "white", borderColor: "white", fontSize: 11 }} onClick={downloadAndInstall}>
            {locale === "ru" ? "Обновить" : "Update"}
          </Button>
        </>
      )}
    </Box>
  );
}

function AppContent() {
  useUndoRedo();
  const updater = useAutoUpdater();
  // When the banner is showing it occupies the titlebar band itself, so the
  // shell must not reserve that space a second time.
  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
      <UpdateBanner {...updater} />
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <AppShell titlebarInset={updater.available ? 0 : TITLEBAR_HEIGHT} />
      </Box>
    </Box>
  );
}

export default function App() {
  const current = useThemeStore((s) => s.current);
  const hydrateFromDb = useThemeStore((s) => s.hydrateFromDb);
  const muiTheme = useMemo(() => buildMuiTheme(current), [current]);

  useEffect(() => { hydrateFromDb(); }, [hydrateFromDb]);

  return (
    <ThemeProvider theme={muiTheme}>
      <CssBaseline />
      <AppContent />
    </ThemeProvider>
  );
}

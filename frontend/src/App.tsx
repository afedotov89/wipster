import { ThemeProvider, CssBaseline, Box, Typography, Button, LinearProgress } from "@mui/material";
import SystemUpdateIcon from "@mui/icons-material/SystemUpdate";
import { theme } from "./theme";
import AppShell from "./components/layout/AppShell";
import { useUndoRedo } from "./hooks/useUndoRedo";
import { useAutoUpdater } from "./hooks/useAutoUpdater";
import { useI18n } from "./i18n";

function UpdateBanner() {
  const { available, version, downloading, progress, ready, downloadAndInstall, installAndRelaunch } = useAutoUpdater();
  const { locale } = useI18n();

  if (!available) return null;

  return (
    <Box
      sx={{
        px: 2,
        py: 0.75,
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
  return (
    <>
      <UpdateBanner />
      <AppShell />
    </>
  );
}

export default function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AppContent />
    </ThemeProvider>
  );
}

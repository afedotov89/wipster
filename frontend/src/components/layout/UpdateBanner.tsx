import { Box, Button, IconButton, LinearProgress, Typography } from "@mui/material";
import SystemUpdateIcon from "@mui/icons-material/SystemUpdate";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import CloseIcon from "@mui/icons-material/Close";
import { useI18n } from "@/i18n";
import { useUpdateStore } from "@/stores/updateStore";
import { useUiStore } from "@/stores/uiStore";
import { HEADER_BAND_HEIGHT, TRAFFIC_LIGHTS_WIDTH } from "@/utils/constants";

const BUTTON_SX = { color: "white", borderColor: "white", fontSize: 11 } as const;

/**
 * The strip across the top of the window when there is news about the app
 * itself: an update to take, or one that has just been taken.
 *
 * Both moments offer the same thing — "what's new" — because an update the user
 * cannot read is only a number going up. The notes themselves live in one place
 * (settings → about), so this stays a strip.
 */
export default function UpdateBanner() {
  const { t } = useI18n();
  const { available, version, downloading, progress, ready, justUpdated, currentVersion } =
    useUpdateStore();
  const downloadAndInstall = useUpdateStore((s) => s.downloadAndInstall);
  const installAndRelaunch = useUpdateStore((s) => s.installAndRelaunch);
  const dismissJustUpdated = useUpdateStore((s) => s.dismissJustUpdated);
  const openSettings = useUiStore((s) => s.openSettings);

  const showUpdated = justUpdated && !available;
  if (!available && !showUpdated) return null;

  const showNotes = () => {
    openSettings("about");
    if (showUpdated) dismissJustUpdated();
  };

  return (
    <Box
      data-tauri-drag-region
      sx={{
        // While it shows, the banner *is* the titlebar band: the window buttons
        // float over its left end, so it has to clear them horizontally and be
        // tall enough to hold them — a shorter strip left them straddling its
        // bottom edge, half on the banner and half on the app.
        pl: `${TRAFFIC_LIGHTS_WIDTH}px`,
        pr: 2,
        py: 0.75,
        minHeight: HEADER_BAND_HEIGHT,
        flexShrink: 0,
        bgcolor: showUpdated ? "success.main" : "primary.main",
        color: "white",
        display: "flex",
        alignItems: "center",
        gap: 1,
        fontSize: 12,
      }}
    >
      {showUpdated ? (
        <>
          <CheckCircleOutlineIcon sx={{ fontSize: 16 }} />
          <Typography variant="caption" sx={{ flex: 1 }}>
            {t.updatedTo(currentVersion)}
          </Typography>
          <Button size="small" variant="outlined" sx={BUTTON_SX} onClick={showNotes}>
            {t.whatsNew}
          </Button>
          <IconButton
            size="small"
            onClick={dismissJustUpdated}
            sx={{ color: "white" }}
            aria-label={t.close}
          >
            <CloseIcon sx={{ fontSize: 14 }} />
          </IconButton>
        </>
      ) : (
        <>
          <SystemUpdateIcon sx={{ fontSize: 16 }} />
          {ready ? (
            <>
              <Typography variant="caption" sx={{ flex: 1 }}>
                {t.updateReady(version ?? "")}
              </Typography>
              <Button size="small" variant="outlined" sx={BUTTON_SX} onClick={installAndRelaunch}>
                {t.updateRestart}
              </Button>
            </>
          ) : downloading ? (
            <>
              <Typography variant="caption" sx={{ flex: 1 }}>
                {t.updateDownloading} {progress}%
              </Typography>
              <LinearProgress
                variant="determinate"
                value={progress}
                sx={{ width: 80, height: 4, borderRadius: 2 }}
              />
            </>
          ) : (
            <>
              <Typography variant="caption" sx={{ flex: 1 }}>
                {t.updateAvailable(version ?? "")}
              </Typography>
              <Button
                size="small"
                variant="text"
                sx={{ ...BUTTON_SX, border: 0 }}
                onClick={showNotes}
              >
                {t.whatsNew}
              </Button>
              <Button size="small" variant="outlined" sx={BUTTON_SX} onClick={downloadAndInstall}>
                {t.updateNow}
              </Button>
            </>
          )}
        </>
      )}
    </Box>
  );
}

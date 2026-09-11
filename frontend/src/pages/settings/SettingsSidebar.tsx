import { Box, Divider, List, ListItemButton, ListItemIcon, ListItemText, Typography } from "@mui/material";
import ArrowBackIosNewIcon from "@mui/icons-material/ArrowBackIosNew";
import { useI18n } from "@/i18n";
import { useUiStore } from "@/stores/uiStore";
import { HEADER_BAND_HEIGHT, TRAFFIC_LIGHTS_WIDTH } from "@/utils/constants";
import SettingsNav from "./SettingsNav";

/**
 * The sidebar, while the settings are open.
 *
 * The app is one window, so the settings live in it rather than in a second
 * one floating on top: the column that listed projects lists the sections
 * instead, and the way back sits at the very top, where the eye already is.
 * Same width, same band, same rhythm — nothing jumps when you go in or out.
 */
export default function SettingsSidebar({
  windowButtonsOverlap,
}: {
  windowButtonsOverlap: boolean;
}) {
  const { t } = useI18n();
  const closeSettings = useUiStore((s) => s.closeSettings);
  const section = useUiStore((s) => s.settingsSection);
  const setSection = useUiStore((s) => s.setSettingsSection);

  return (
    <Box
      sx={{
        width: 240,
        height: "100%",
        borderRight: 1,
        borderColor: "divider",
        display: "flex",
        flexDirection: "column",
        bgcolor: "var(--sidebar-tint)",
      }}
    >
      <Box
        data-tauri-drag-region
        sx={{
          pl: windowButtonsOverlap ? `${TRAFFIC_LIGHTS_WIDTH}px` : 2,
          pr: 2,
          height: HEADER_BAND_HEIGHT,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
        }}
      >
        <Typography variant="subtitle2" color="text.secondary">
          {t.appName}
        </Typography>
      </Box>

      <List dense disablePadding sx={{ pt: 0.5 }}>
        <ListItemButton onClick={closeSettings} sx={{ mx: 1, borderRadius: 1 }}>
          <ListItemIcon sx={{ minWidth: 32 }}>
            <ArrowBackIosNewIcon sx={{ fontSize: 13 }} />
          </ListItemIcon>
          <ListItemText
            primary={t.backToProjects}
            primaryTypographyProps={{ fontSize: 13, fontWeight: 600 }}
          />
        </ListItemButton>
      </List>

      <Divider sx={{ my: 1 }} />

      <Box sx={{ px: 2, py: 0.5 }}>
        <Typography variant="caption" color="text.secondary">
          {t.settingsCaption}
        </Typography>
      </Box>

      <SettingsNav current={section} onSelect={setSection} />
    </Box>
  );
}

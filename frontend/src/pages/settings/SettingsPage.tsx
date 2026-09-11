import { useEffect, useRef } from "react";
import { Box, Typography } from "@mui/material";
import { useI18n } from "@/i18n";
import { useUiStore } from "@/stores/uiStore";
import { HEADER_BAND_HEIGHT } from "@/utils/constants";
import { settingsTabId } from "./SettingsNav";
import { settingsSection } from "./sections";

/**
 * The section itself, where the board would otherwise be.
 *
 * The band names it, exactly as it names the project on a board — the sidebar
 * says where you are, this says what you are looking at.
 */
export default function SettingsPage() {
  const { t } = useI18n();
  const section = useUiStore((s) => s.settingsSection);
  const closeSettings = useUiStore((s) => s.closeSettings);
  const { Panel, title } = settingsSection(section);

  // A new section starts at its own beginning, not where the last one was left.
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panelRef.current?.scrollTo({ top: 0 });
  }, [section]);

  // Escape leaves the settings — unless the assistant's panel is up, which is
  // nearer the user than the page behind it and has first claim on the key.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || useUiStore.getState().agentPanelOpen) return;
      e.preventDefault();
      closeSettings();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeSettings]);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Box
        data-tauri-drag-region
        sx={{
          px: 3,
          height: HEADER_BAND_HEIGHT,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
        }}
      >
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          {title(t)}
        </Typography>
      </Box>

      <Box
        ref={panelRef}
        id="settings-panel"
        role="tabpanel"
        aria-labelledby={settingsTabId(section)}
        sx={{ flex: 1, minHeight: 0, overflow: "auto", px: 3, pt: 1, pb: 4 }}
      >
        <Panel />
      </Box>
    </Box>
  );
}

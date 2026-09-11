import { Box, Typography, ToggleButtonGroup, ToggleButton, IconButton } from "@mui/material";
import RemoveIcon from "@mui/icons-material/Remove";
import AddIcon from "@mui/icons-material/Add";
import { useI18n } from "@/i18n";
import { useSettingsStore } from "@/stores/settingsStore";
import { MAX_WIP_LIMIT, MIN_WIP_LIMIT } from "@/utils/constants";
import SettingsGroup from "./SettingsGroup";

/** Language and the one rule the whole board obeys: how much may be in progress. */
export default function GeneralPanel() {
  const { t, locale, setLocale } = useI18n();
  const wipLimit = useSettingsStore((s) => s.wipLimit);
  const setWipLimit = useSettingsStore((s) => s.setWipLimit);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2, maxWidth: 620 }}>
      <SettingsGroup>
      <Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {t.language}
        </Typography>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={locale}
          onChange={(_e, val) => {
            if (val) setLocale(val);
          }}
        >
          <ToggleButton value="en" sx={{ px: 2 }}>English</ToggleButton>
          <ToggleButton value="ru" sx={{ px: 2 }}>Русский</ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {/* WIP limit — a stepper rather than a number field: no browser spinners,
          no half-typed values, and the bounds are visible as disabled buttons. */}
      <Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {t.wipLimitSetting}
        </Typography>
        <Box
          sx={{
            display: "inline-flex",
            alignItems: "center",
            border: 1,
            borderColor: "divider",
            borderRadius: 1,
            overflow: "hidden",
          }}
        >
          <IconButton
            size="small"
            onClick={() => setWipLimit(wipLimit - 1)}
            disabled={wipLimit <= MIN_WIP_LIMIT}
            sx={{ borderRadius: 0 }}
            aria-label={t.wipLimitSetting}
          >
            <RemoveIcon fontSize="small" />
          </IconButton>
          <Typography sx={{ minWidth: 40, textAlign: "center", fontSize: 14, fontWeight: 600 }}>
            {wipLimit}
          </Typography>
          <IconButton
            size="small"
            onClick={() => setWipLimit(wipLimit + 1)}
            disabled={wipLimit >= MAX_WIP_LIMIT}
            sx={{ borderRadius: 0 }}
            aria-label={t.wipLimitSetting}
          >
            <AddIcon fontSize="small" />
          </IconButton>
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.75 }}>
          {t.wipLimitSettingHint}
        </Typography>
      </Box>
      </SettingsGroup>
    </Box>
  );
}

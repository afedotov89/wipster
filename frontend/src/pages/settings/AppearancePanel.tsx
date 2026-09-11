import { Box, Typography } from "@mui/material";
import { useI18n } from "@/i18n";
import ThemePicker from "@/components/settings/ThemePicker";

/** Light or dark, and which of the moods. */
export default function AppearancePanel() {
  const { t } = useI18n();

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        {t.themeSectionHint}
      </Typography>
      <ThemePicker />
    </Box>
  );
}

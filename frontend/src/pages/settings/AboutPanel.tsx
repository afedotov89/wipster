import { Box, Chip, Divider, Typography } from "@mui/material";
import { useI18n } from "@/i18n";
import { useUpdateStore } from "@/stores/updateStore";
import Markdown from "@/components/common/Markdown";
import SettingsGroup from "./SettingsGroup";

/**
 * What this app is, and what every version of it changed.
 *
 * The one place release notes are shown, so both moments that raise the
 * question — an update waiting to be installed, and one that has just landed —
 * lead here instead of each growing a window of its own.
 */
export default function AboutPanel() {
  const { t } = useI18n();
  const { currentVersion, releases, available, version, notes } = useUpdateStore();

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2, maxWidth: 620 }}>
      <SettingsGroup>
        <Box sx={{ display: "flex", alignItems: "baseline", gap: 1 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            Wipster
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t.version} {currentVersion || "—"}
          </Typography>
        </Box>
      </SettingsGroup>

      {/* An update that is not installed yet describes itself: these notes
          travel with the update, because this build cannot know what a later
          one will say. */}
      {available && version && (
        <SettingsGroup
          title={t.updatePending(version)}
        >
          {notes ? (
            <Markdown>{notes}</Markdown>
          ) : (
            <Typography variant="caption" color="text.secondary">
              {t.noReleaseNotes}
            </Typography>
          )}
        </SettingsGroup>
      )}

      <Typography variant="body2" sx={{ fontWeight: 600, mt: 1 }}>
        {t.releaseHistory}
      </Typography>

      {releases.map((release, index) => (
        <Box key={release.version}>
          <Box sx={{ display: "flex", alignItems: "baseline", gap: 1, mb: 0.5 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {release.version}
            </Typography>
            {release.version === currentVersion && (
              <Chip
                label={t.currentVersion}
                size="small"
                variant="outlined"
                sx={{ height: 18, fontSize: 10 }}
              />
            )}
            <Typography variant="caption" color="text.secondary">
              {release.date}
            </Typography>
          </Box>
          <Markdown sx={{ color: "text.secondary" }}>{release.notes}</Markdown>
          {index < releases.length - 1 && <Divider sx={{ mt: 2 }} />}
        </Box>
      ))}
    </Box>
  );
}

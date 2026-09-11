import { Box, Button, Typography } from "@mui/material";
import { useI18n } from "@/i18n";
import { useLogStore } from "@/stores/logStore";

/** What the app has been doing — the first place to look when something failed. */
export default function LogsPanel() {
  const { t } = useI18n();
  const { entries, clear } = useLogStore();

  return (
    <Box sx={{ maxWidth: 760 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
        <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
          {t.logsCount(entries.length)}
        </Typography>
        <Button size="small" onClick={clear} disabled={entries.length === 0} sx={{ fontSize: 11 }}>
          {t.logsClear}
        </Button>
      </Box>
      <Box
        sx={{
          minHeight: 120,
          maxHeight: "60vh",
          overflow: "auto",
          bgcolor: "var(--overlay-3)",
          borderRadius: 1,
          p: 1.5,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 11,
          lineHeight: 1.6,
          userSelect: "text",
        }}
      >
        {entries.length === 0 ? (
          <Typography variant="caption" color="text.secondary">
            {t.logsEmpty}
          </Typography>
        ) : (
          entries.map((e, i) => (
            <Box
              key={i}
              sx={{
                color:
                  e.level === "error" ? "#ef5350" : e.level === "warn" ? "#ff9800" : "text.secondary",
              }}
            >
              <span style={{ opacity: 0.5 }}>{e.time}</span> [{e.level}] {e.message}
            </Box>
          ))
        )}
      </Box>
    </Box>
  );
}

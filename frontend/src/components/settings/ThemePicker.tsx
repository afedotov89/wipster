import { Box, Typography, ToggleButtonGroup, ToggleButton } from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import LightModeIcon from "@mui/icons-material/LightMode";
import DarkModeIcon from "@mui/icons-material/DarkMode";
import SettingsBrightnessIcon from "@mui/icons-material/SettingsBrightness";
import { useThemeStore } from "@/theme/store";
import { darkThemes, lightThemes, type ThemeDef, type Mode } from "@/theme/themes";
import { useI18n } from "@/i18n";

function ThemePreview({ def }: { def: ThemeDef }) {
  const isLight = def.mode === "light";
  const sidebarBg = isLight ? "rgba(0,0,0,0.04)" : "rgba(0,0,0,0.25)";
  const itemMuted1 = isLight ? "rgba(0,0,0,0.18)" : "rgba(255,255,255,0.18)";
  const itemMuted2 = isLight ? "rgba(0,0,0,0.10)" : "rgba(255,255,255,0.12)";
  const cardLine1 = isLight ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.55)";
  const cardLine2 = isLight ? "rgba(0,0,0,0.22)" : "rgba(255,255,255,0.25)";
  const columnTitle = isLight ? "rgba(0,0,0,0.18)" : "rgba(255,255,255,0.15)";

  return (
    <Box
      sx={{
        position: "relative",
        height: 110,
        borderRadius: 1.5,
        overflow: "hidden",
        backgroundColor: def.bgDefault,
        backgroundImage: def.ambient,
        backgroundAttachment: "local",
        backgroundSize: "200% 200%",
        backgroundPosition: "center",
        border: isLight ? "1px solid rgba(0,0,0,0.06)" : "none",
      }}
    >
      <Box
        sx={{
          position: "absolute",
          left: 6, top: 6, bottom: 6, width: 42,
          borderRadius: 0.75,
          bgcolor: sidebarBg,
          display: "flex", flexDirection: "column", gap: 0.5, p: 0.75,
        }}
      >
        <Box sx={{ width: "100%", height: 5, borderRadius: 0.5, bgcolor: def.primary, opacity: 0.9 }} />
        <Box sx={{ width: "70%", height: 4, borderRadius: 0.5, bgcolor: itemMuted1 }} />
        <Box sx={{ width: "85%", height: 4, borderRadius: 0.5, bgcolor: itemMuted2 }} />
        <Box sx={{ width: "60%", height: 4, borderRadius: 0.5, bgcolor: itemMuted2 }} />
      </Box>

      <Box
        sx={{
          position: "absolute",
          left: 56, right: 6, top: 6, bottom: 6,
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 0.5,
        }}
      >
        {[0, 1, 2].map((col) => (
          <Box key={col} sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 0.25 }}>
              <Box
                sx={{
                  width: 4, height: 4, borderRadius: "50%",
                  bgcolor: col === 0 ? "#5B8AC8" : col === 1 ? "#E6A03C" : "#6FBF73",
                }}
              />
              <Box sx={{ flex: 1, height: 3, borderRadius: 0.5, bgcolor: columnTitle }} />
            </Box>
            {[0, 1, col === 1 ? -1 : 2].filter((n) => n >= 0).map((row) => (
              <Box
                key={row}
                sx={{
                  bgcolor: def.bgPaper,
                  borderRadius: 0.5,
                  borderLeft: `2px solid ${def.primary}`,
                  p: 0.5,
                  display: "flex", flexDirection: "column", gap: 0.25,
                  boxShadow: isLight ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
                }}
              >
                <Box sx={{ width: "85%", height: 3, borderRadius: 0.25, bgcolor: cardLine1 }} />
                <Box sx={{ width: "60%", height: 3, borderRadius: 0.25, bgcolor: cardLine2 }} />
              </Box>
            ))}
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function ThemeGallery({
  themes, selectedId, onSelect,
}: {
  themes: ThemeDef[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const { locale } = useI18n();
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))",
        gap: 1.5,
      }}
    >
      {themes.map((def) => {
        const selected = def.id === selectedId;
        return (
          <Box
            key={def.id}
            onClick={() => onSelect(def.id)}
            sx={{
              cursor: "pointer",
              borderRadius: 2,
              p: 1,
              border: 2,
              borderColor: selected ? def.primary : "transparent",
              bgcolor: selected ? "var(--overlay-1)" : "transparent",
              transition: "border-color 200ms ease, background-color 200ms ease, transform 150ms ease",
              "&:hover": {
                transform: selected ? "none" : "translateY(-2px)",
                bgcolor: "var(--overlay-1)",
              },
              position: "relative",
            }}
          >
            {selected && (
              <CheckCircleIcon
                sx={{
                  position: "absolute",
                  top: 14, right: 14, fontSize: 18,
                  color: def.primary,
                  filter: "drop-shadow(0 0 4px rgba(0,0,0,0.6))",
                  zIndex: 2,
                }}
              />
            )}
            <ThemePreview def={def} />
            <Box sx={{ mt: 0.75, display: "flex", alignItems: "baseline", gap: 0.75 }}>
              <Typography sx={{ fontSize: 14, fontWeight: 600 }}>
                <span style={{ marginRight: 6 }}>{def.mood}</span>
                {def.name[locale === "ru" ? "ru" : "en"]}
              </Typography>
            </Box>
            <Typography sx={{ fontSize: 11, opacity: 0.55, mt: 0.25 }}>
              {def.description[locale === "ru" ? "ru" : "en"]}
            </Typography>
          </Box>
        );
      })}
    </Box>
  );
}

export default function ThemePicker() {
  const { locale } = useI18n();
  const darkThemeId = useThemeStore((s) => s.darkThemeId);
  const lightThemeId = useThemeStore((s) => s.lightThemeId);
  const mode = useThemeStore((s) => s.mode);
  const resolvedMode = useThemeStore((s) => s.resolvedMode);
  const setDarkTheme = useThemeStore((s) => s.setDarkTheme);
  const setLightTheme = useThemeStore((s) => s.setLightTheme);
  const setMode = useThemeStore((s) => s.setMode);

  return (
    <Box>
      {/* Mode toggle */}
      <Box sx={{ mb: 2.5, display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={mode}
          onChange={(_e, val: Mode | null) => { if (val) setMode(val); }}
        >
          <ToggleButton value="light" sx={{ px: 1.5, gap: 0.5 }}>
            <LightModeIcon sx={{ fontSize: 16 }} />
            <span style={{ fontSize: 12 }}>{locale === "ru" ? "Светлая" : "Light"}</span>
          </ToggleButton>
          <ToggleButton value="dark" sx={{ px: 1.5, gap: 0.5 }}>
            <DarkModeIcon sx={{ fontSize: 16 }} />
            <span style={{ fontSize: 12 }}>{locale === "ru" ? "Тёмная" : "Dark"}</span>
          </ToggleButton>
          <ToggleButton value="auto" sx={{ px: 1.5, gap: 0.5 }}>
            <SettingsBrightnessIcon sx={{ fontSize: 16 }} />
            <span style={{ fontSize: 12 }}>{locale === "ru" ? "Авто" : "Auto"}</span>
          </ToggleButton>
        </ToggleButtonGroup>
        {mode === "auto" && (
          <Typography variant="caption" sx={{ opacity: 0.6 }}>
            {locale === "ru" ? "Сейчас:" : "Now:"} {resolvedMode === "light"
              ? (locale === "ru" ? "светлая" : "light")
              : (locale === "ru" ? "тёмная" : "dark")}
          </Typography>
        )}
      </Box>

      {/* Galleries side-by-side on wide screens, stacked on narrow */}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
          gap: 3,
        }}
      >
        {/* Dark gallery */}
        <Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
            <DarkModeIcon sx={{ fontSize: 14, opacity: 0.6 }} />
            <Typography variant="body2" sx={{ fontWeight: 600, opacity: 0.85 }}>
              {locale === "ru" ? "Тёмная тема" : "Dark theme"}
            </Typography>
            {resolvedMode === "dark" && (
              <Typography variant="caption" sx={{ opacity: 0.5, ml: 0.5 }}>
                · {locale === "ru" ? "применяется" : "applied"}
              </Typography>
            )}
          </Box>
          <ThemeGallery
            themes={darkThemes()}
            selectedId={darkThemeId}
            onSelect={setDarkTheme}
          />
        </Box>

        {/* Light gallery */}
        <Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
            <LightModeIcon sx={{ fontSize: 14, opacity: 0.6 }} />
            <Typography variant="body2" sx={{ fontWeight: 600, opacity: 0.85 }}>
              {locale === "ru" ? "Светлая тема" : "Light theme"}
            </Typography>
            {resolvedMode === "light" && (
              <Typography variant="caption" sx={{ opacity: 0.5, ml: 0.5 }}>
                · {locale === "ru" ? "применяется" : "applied"}
              </Typography>
            )}
          </Box>
          <ThemeGallery
            themes={lightThemes()}
            selectedId={lightThemeId}
            onSelect={setLightTheme}
          />
        </Box>
      </Box>
    </Box>
  );
}

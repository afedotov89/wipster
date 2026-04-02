import { useEffect, useState } from "react";
import {
  Box,
  Typography,
  ToggleButtonGroup,
  ToggleButton,
  TextField,
  Button,
  Divider,
  Chip,
} from "@mui/material";
import { useI18n } from "@/i18n";
import { useLogStore } from "@/stores/logStore";
import * as api from "@/utils/tauri";

type Provider = "anthropic" | "openrouter";

export default function SettingsView() {
  const { t, locale, setLocale } = useI18n();
  const [provider, setProvider] = useState<Provider>("anthropic");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [openrouterKey, setOpenrouterKey] = useState("");
  const [model, setModel] = useState("");
  const [trackerToken, setTrackerToken] = useState("");
  const [trackerOrgId, setTrackerOrgId] = useState("");
  const [saved, setSaved] = useState("");

  useEffect(() => {
    Promise.all([
      api.getSetting("llm_provider"),
      api.getSetting("anthropic_api_key"),
      api.getSetting("openrouter_api_key"),
      api.getSetting("llm_model"),
      api.getSetting("tracker_token"),
      api.getSetting("tracker_org_id"),
    ]).then(([p, ak, ok, m, tt, to]) => {
      if (p === "openrouter") setProvider("openrouter");
      if (ak) setAnthropicKey(ak);
      if (ok) setOpenrouterKey(ok);
      if (m) setModel(m);
      if (tt) setTrackerToken(tt);
      if (to) setTrackerOrgId(to);
    }).catch(() => {});
  }, []);

  const showSaved = (section: string) => {
    setSaved(section);
    setTimeout(() => setSaved(""), 2000);
  };

  const handleSaveAi = async () => {
    await api.setSetting("llm_provider", provider);
    if (anthropicKey) await api.setSetting("anthropic_api_key", anthropicKey);
    if (openrouterKey) await api.setSetting("openrouter_api_key", openrouterKey);
    await api.setSetting("llm_model", model || defaultModel);
    showSaved("ai");
  };

  const handleSaveTracker = async () => {
    await api.setSetting("tracker_token", trackerToken);
    await api.setSetting("tracker_org_id", trackerOrgId);
    showSaved("tracker");
  };

  const defaultModel = provider === "openrouter" ? "anthropic/claude-sonnet-4" : "claude-sonnet-4-20250514";
  const activeKey = provider === "anthropic" ? anthropicKey : openrouterKey;

  return (
    <Box sx={{ p: 3, maxWidth: 480 }}>
      <Typography variant="h6" sx={{ mb: 3 }}>
        {t.settings}
      </Typography>

      {/* Language */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {t.language}
        </Typography>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={locale}
          onChange={(_e, val) => { if (val) setLocale(val); }}
        >
          <ToggleButton value="en" sx={{ px: 2 }}>English</ToggleButton>
          <ToggleButton value="ru" sx={{ px: 2 }}>Русский</ToggleButton>
        </ToggleButtonGroup>
      </Box>

      <Divider sx={{ mb: 3 }} />

      {/* AI Connector */}
      <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <Typography variant="body1" sx={{ fontWeight: 600 }}>
          {t.aiConnector}
        </Typography>

        <Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
            {t.provider}
          </Typography>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={provider}
            onChange={(_e, val) => { if (val) setProvider(val); }}
            sx={{ display: "flex" }}
          >
            <ToggleButton value="anthropic" sx={{ flex: 1, fontSize: 12 }}>Anthropic</ToggleButton>
            <ToggleButton value="openrouter" sx={{ flex: 1, fontSize: 12 }}>OpenRouter</ToggleButton>
          </ToggleButtonGroup>
        </Box>

        <TextField
          fullWidth
          size="small"
          type="password"
          label={provider === "anthropic" ? "Anthropic API Key" : "OpenRouter API Key"}
          placeholder={provider === "anthropic" ? "sk-ant-..." : "sk-or-..."}
          value={activeKey}
          onChange={(e) => provider === "anthropic" ? setAnthropicKey(e.target.value) : setOpenrouterKey(e.target.value)}
          InputProps={{ sx: { fontSize: 13 } }}
          InputLabelProps={{ sx: { fontSize: 13 } }}
        />

        <TextField
          fullWidth
          size="small"
          label={t.model}
          placeholder={defaultModel}
          value={model}
          onChange={(e) => setModel(e.target.value)}
          helperText={model ? undefined : defaultModel}
          InputProps={{ sx: { fontSize: 13 } }}
          InputLabelProps={{ sx: { fontSize: 13 } }}
          FormHelperTextProps={{ sx: { fontSize: 11 } }}
        />

        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Button size="small" variant="contained" onClick={handleSaveAi}>
            {t.save}
          </Button>
          {saved === "ai" && <Chip label={t.saved} size="small" color="success" />}
        </Box>
      </Box>

      <Divider sx={{ my: 3 }} />

      {/* Integrations */}
      <Box sx={{ display: "flex", flexDirection: "column", gap: 2, mb: 3 }}>
        <Typography variant="body1" sx={{ fontWeight: 600 }}>
          {t.integrations}
        </Typography>

        <Typography variant="body2" sx={{ fontWeight: 500 }}>
          {t.yandexTracker}
        </Typography>

        <TextField
          fullWidth
          size="small"
          type="password"
          label={t.trackerToken}
          placeholder="y0_..."
          value={trackerToken}
          onChange={(e) => setTrackerToken(e.target.value)}
          InputProps={{ sx: { fontSize: 13 } }}
          InputLabelProps={{ sx: { fontSize: 13 } }}
        />

        <TextField
          fullWidth
          size="small"
          label={t.trackerOrgId}
          value={trackerOrgId}
          onChange={(e) => setTrackerOrgId(e.target.value)}
          InputProps={{ sx: { fontSize: 13 } }}
          InputLabelProps={{ sx: { fontSize: 13 } }}
        />

        <Typography variant="caption" color="text.secondary">
          {t.trackerHelp}
        </Typography>

        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Button size="small" variant="contained" onClick={handleSaveTracker}>
            {t.save}
          </Button>
          {saved === "tracker" && <Chip label={t.saved} size="small" color="success" />}
        </Box>
      </Box>

      <Divider sx={{ my: 3 }} />

      <Divider sx={{ my: 3 }} />

      {/* Logs */}
      <LogPanel />
    </Box>
  );
}

function LogPanel() {
  const { entries, clear } = useLogStore();
  const [open, setOpen] = useState(false);

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, cursor: "pointer" }} onClick={() => setOpen(!open)}>
        <Typography variant="body2" color="text.secondary">
          Logs {entries.length > 0 && `(${entries.length})`}
        </Typography>
        <Typography variant="caption" color="text.secondary">{open ? "▼" : "▶"}</Typography>
      </Box>
      {open && (
        <Box sx={{ mt: 1 }}>
          <Button size="small" onClick={clear} sx={{ mb: 1, fontSize: 11 }}>Clear</Button>
          <Box
            sx={{
              maxHeight: 300,
              overflow: "auto",
              bgcolor: "rgba(0,0,0,0.3)",
              borderRadius: 1,
              p: 1,
              fontFamily: "monospace",
              fontSize: 11,
              lineHeight: 1.6,
            }}
          >
            {entries.length === 0 && (
              <Typography variant="caption" color="text.secondary">No logs yet</Typography>
            )}
            {entries.map((e, i) => (
              <Box key={i} sx={{ color: e.level === "error" ? "#ef5350" : e.level === "warn" ? "#ff9800" : "text.secondary" }}>
                <span style={{ opacity: 0.5 }}>{e.time}</span> [{e.level}] {e.message}
              </Box>
            ))}
          </Box>
        </Box>
      )}
    </Box>
  );
}

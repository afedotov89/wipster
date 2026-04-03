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
import { useI18n, type Translations } from "@/i18n";
import { useLogStore } from "@/stores/logStore";
import * as api from "@/utils/tauri";

type Provider = "anthropic" | "openrouter";

export default function SettingsView() {
  const { t, locale, setLocale } = useI18n();
  const [provider, setProvider] = useState<Provider>("anthropic");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [openrouterKey, setOpenrouterKey] = useState("");
  const [model, setModel] = useState("");
  const [saved, setSaved] = useState("");

  useEffect(() => {
    Promise.all([
      api.getSetting("llm_provider"),
      api.getSetting("anthropic_api_key"),
      api.getSetting("openrouter_api_key"),
      api.getSetting("llm_model"),
    ]).then(([p, ak, ok, m]) => {
      if (p === "openrouter") setProvider("openrouter");
      if (ak) setAnthropicKey(ak);
      if (ok) setOpenrouterKey(ok);
      if (m) setModel(m);
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

        <TrackerSection t={t} />
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

function TrackerSection({ t }: { t: Translations }) {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [orgId, setOrgId] = useState("");
  const [needsOrgId, setNeedsOrgId] = useState(false);
  const [connected, setConnected] = useState(false);
  const [userCode, setUserCode] = useState("");
  const [verifyUrl, setVerifyUrl] = useState("");
  const [polling, setPolling] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    Promise.all([
      api.getSetting("tracker_client_id"),
      api.getSetting("tracker_client_secret"),
      api.getSetting("tracker_org_id"),
      api.trackerStatus(),
    ]).then(([cid, cs, oid, status]) => {
      if (cid) setClientId(cid);
      if (cs) setClientSecret(cs);
      if (oid) setOrgId(oid);
      setConnected(status);
      if (!status && cid) setNeedsOrgId(true);
    }).catch(() => {});
  }, []);

  const handleStartAuth = async () => {
    if (!clientId) return;
    await api.setSetting("tracker_client_id", clientId);
    if (clientSecret) await api.setSetting("tracker_client_secret", clientSecret);
    setMessage("");
    try {
      const result = await api.trackerStartAuth();
      setUserCode(result.user_code);
      setVerifyUrl(result.verification_url);

      // Open browser
      window.open(result.verification_url, "_blank");

      // Start polling in background
      setPolling(true);
      try {
        const msg = await api.trackerPollToken();
        setMessage(msg);
        setUserCode("");
        setVerifyUrl("");
        if (msg.includes("Org ID") && !msg.includes("Подключено")) {
          setNeedsOrgId(true);
        } else {
          setConnected(true);
          setNeedsOrgId(false);
        }
      } catch (e) {
        setMessage(String(e));
      } finally {
        setPolling(false);
      }
    } catch (e) {
      setMessage(String(e));
    }
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <Typography variant="body2" sx={{ fontWeight: 500 }}>
          {t.yandexTracker}
        </Typography>
        {connected && <Chip label="✓" size="small" color="success" sx={{ height: 20 }} />}
      </Box>

      <TextField fullWidth size="small" label="Client ID" value={clientId} onChange={(e) => setClientId(e.target.value)} InputProps={{ sx: { fontSize: 13 } }} InputLabelProps={{ sx: { fontSize: 13 } }} />
      <TextField fullWidth size="small" type="password" label="Client Secret" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} InputProps={{ sx: { fontSize: 13 } }} InputLabelProps={{ sx: { fontSize: 13 } }} />

      <Button size="small" variant={connected ? "outlined" : "contained"} onClick={handleStartAuth} disabled={!clientId || !clientSecret || polling}>
        {polling ? "Ожидание авторизации..." : connected ? "Переподключить" : "Подключить"}
      </Button>

      {userCode && (
        <Box sx={{ p: 1.5, bgcolor: "rgba(255,255,255,0.05)", borderRadius: 1 }}>
          <Typography variant="body2" sx={{ mb: 1 }}>
            Откройте <a href={verifyUrl} target="_blank" rel="noreferrer" style={{ color: "#4DB6AC" }}>{verifyUrl}</a> и введите код:
          </Typography>
          <Typography variant="h5" sx={{ fontFamily: "monospace", fontWeight: 700, letterSpacing: 4, textAlign: "center" }}>
            {userCode}
          </Typography>
          {polling && (
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", textAlign: "center", mt: 1 }}>
              Автоматически подключится после авторизации...
            </Typography>
          )}
        </Box>
      )}

      {needsOrgId && (
        <Box sx={{ display: "flex", gap: 1, alignItems: "flex-end" }}>
          <TextField
            fullWidth
            size="small"
            label="Org ID"
            value={orgId}
            onChange={(e) => setOrgId(e.target.value)}
            InputProps={{ sx: { fontSize: 13 } }}
            InputLabelProps={{ sx: { fontSize: 13 } }}
          />
          <Button
            size="small"
            variant="contained"
            disabled={!orgId.trim()}
            onClick={async () => {
              await api.setSetting("tracker_org_id", orgId.trim());
              setConnected(true);
              setNeedsOrgId(false);
              setMessage("Подключено!");
            }}
            sx={{ whiteSpace: "nowrap" }}
          >
            OK
          </Button>
        </Box>
      )}

      {message && <Typography variant="caption" color="text.secondary">{message}</Typography>}
      <Typography variant="caption" color="text.secondary">{t.trackerHelp}</Typography>
    </Box>
  );
}

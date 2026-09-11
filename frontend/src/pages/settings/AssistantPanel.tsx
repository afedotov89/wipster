import { useEffect, useState } from "react";
import {
  Box,
  Typography,
  ToggleButtonGroup,
  ToggleButton,
  TextField,
  Button,
  Chip,
  CircularProgress,
} from "@mui/material";
import { useI18n } from "@/i18n";
import * as api from "@/utils/tauri";
import { appLog } from "@/stores/logStore";
import SettingsGroup from "./SettingsGroup";

type Provider = "anthropic" | "openrouter";

/** Which model answers, with which key — and proof that it really does. */
export default function AssistantPanel() {
  const { t } = useI18n();
  const [provider, setProvider] = useState<Provider>("anthropic");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [openrouterKey, setOpenrouterKey] = useState("");
  const [model, setModel] = useState("");
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<api.LlmTestResult | null>(null);
  const [testError, setTestError] = useState("");

  useEffect(() => {
    Promise.all([
      api.getSetting("llm_provider"),
      api.getSetting("anthropic_api_key"),
      api.getSetting("openrouter_api_key"),
      api.getSetting("llm_model"),
    ])
      .then(([p, ak, ok, m]) => {
        if (p === "openrouter") setProvider("openrouter");
        if (ak) setAnthropicKey(ak);
        if (ok) setOpenrouterKey(ok);
        if (m) setModel(m);
      })
      .catch(() => {});
  }, []);

  const defaultModel =
    provider === "openrouter" ? "anthropic/claude-sonnet-4" : "claude-sonnet-4-20250514";
  const activeKey = provider === "anthropic" ? anthropicKey : openrouterKey;

  const persist = async () => {
    await api.setSetting("llm_provider", provider);
    if (anthropicKey) await api.setSetting("anthropic_api_key", anthropicKey);
    if (openrouterKey) await api.setSetting("openrouter_api_key", openrouterKey);
    await api.setSetting("llm_model", model || defaultModel);
  };

  const handleSave = async () => {
    await persist();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  // Test what is on screen, not what was saved earlier — so persist first, then
  // probe through the real tool-use loop.
  const handleTest = async () => {
    if (testing) return;
    setTestResult(null);
    setTestError("");
    if (!activeKey.trim()) {
      setTestError(t.testKeyMissing);
      return;
    }
    setTesting(true);
    try {
      await persist();
      appLog.info(`[llm-test] probing ${provider} / ${model || defaultModel}`);
      const result = await api.testLlmConnection();
      setTestResult(result);
      appLog.info(
        `[llm-test] ${result.latency_ms}ms, tools: ${result.tools_called.join(", ") || "none"}`,
      );
    } catch (e) {
      const msg = String(e);
      setTestError(msg === "API_KEY_NOT_SET" ? t.testKeyMissing : msg);
      appLog.error(`[llm-test] failed: ${msg}`);
    } finally {
      setTesting(false);
    }
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2, maxWidth: 620 }}>
      <SettingsGroup>
      <Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
          {t.provider}
        </Typography>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={provider}
          onChange={(_e, val) => {
            if (val) setProvider(val);
          }}
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
        onChange={(e) =>
          provider === "anthropic" ? setAnthropicKey(e.target.value) : setOpenrouterKey(e.target.value)
        }
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
        <Button size="small" variant="contained" onClick={handleSave} sx={{ px: 2 }}>
          {t.save}
        </Button>
        <Button
          size="small"
          variant="outlined"
          onClick={handleTest}
          disabled={testing}
          startIcon={testing ? <CircularProgress size={12} color="inherit" /> : undefined}
        >
          {testing ? t.testRunning : t.testConnection}
        </Button>
        {saved && <Chip label={t.saved} size="small" color="success" />}
      </Box>
      </SettingsGroup>

      {(testResult || testError) && (
        <Box
          sx={{
            p: 1.5,
            borderRadius: 1,
            bgcolor: "var(--overlay-2)",
            borderLeft: "3px solid",
            borderColor: testError
              ? "error.main"
              : testResult?.tools_called.length
                ? "success.main"
                : "warning.main",
          }}
        >
          {testError ? (
            <Typography variant="body2" sx={{ fontSize: 12, color: "error.main", wordBreak: "break-word" }}>
              {t.testFailed}: {testError}
            </Typography>
          ) : testResult ? (
            <>
              <Typography variant="body2" sx={{ fontSize: 12, fontWeight: 600, mb: 0.5 }}>
                {t.testOk} · {testResult.model} · {testResult.latency_ms} ms
              </Typography>
              <Typography
                variant="body2"
                sx={{
                  fontSize: 12,
                  color: testResult.tools_called.length ? "success.main" : "warning.main",
                }}
              >
                {testResult.tools_called.length
                  ? t.testToolOk(testResult.tools_called.join(", "))
                  : t.testToolMissing}
              </Typography>
              {testResult.answer && (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: "block", mt: 0.5, fontSize: 11, wordBreak: "break-word" }}
                >
                  «{testResult.answer}» · {t.testProjectsInDb(testResult.projects_in_db)}
                </Typography>
              )}
            </>
          ) : null}
        </Box>
      )}
    </Box>
  );
}

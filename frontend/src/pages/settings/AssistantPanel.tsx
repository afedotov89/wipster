import { useEffect, useMemo, useState } from "react";
import {
  Box,
  Typography,
  TextField,
  MenuItem,
  Button,
  Chip,
  CircularProgress,
} from "@mui/material";
import { useI18n } from "@/i18n";
import * as api from "@/utils/tauri";
import { appLog } from "@/stores/logStore";
import SettingsGroup from "./SettingsGroup";

/** The key setting for a provider — one per service, so switching costs nothing. */
const keyOf = (providerId: string) => `${providerId}_api_key`;

/** Its model, remembered separately: "the model" means something different on each. */
const modelOf = (providerId: string) => `llm_model_${providerId}`;

/**
 * Which service answers, with which key, as which model.
 *
 * The list of services comes from the backend, so a provider added there shows
 * up here with its own key, default model and address — including the plain
 * "OpenAI-compatible" one, which is how anything not on the list gets in:
 * a token and a URL.
 */
export default function AssistantPanel() {
  const { t } = useI18n();
  const [providers, setProviders] = useState<api.LlmProvider[]>([]);
  const [providerId, setProviderId] = useState("anthropic");
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [models, setModels] = useState<Record<string, string>>({});
  const [baseUrl, setBaseUrl] = useState("");
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<api.LlmTestResult | null>(null);
  const [testError, setTestError] = useState("");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const list = await api.llmProviders();
      const [active, legacyModel, url, ...rest] = await Promise.all([
        api.getSetting("llm_provider"),
        api.getSetting("llm_model"),
        api.getSetting("llm_base_url"),
        ...list.flatMap((p) => [api.getSetting(keyOf(p.id)), api.getSetting(modelOf(p.id))]),
      ]);
      if (cancelled) return;

      const activeId = list.some((p) => p.id === active) ? (active as string) : "anthropic";
      const loadedKeys: Record<string, string> = {};
      const loadedModels: Record<string, string> = {};
      list.forEach((p, i) => {
        loadedKeys[p.id] = rest[i * 2] ?? "";
        // Before models were remembered per provider there was one setting for
        // all of them; it belongs to whichever provider was in use.
        loadedModels[p.id] = rest[i * 2 + 1] ?? (p.id === activeId ? (legacyModel ?? "") : "");
      });

      setProviders(list);
      setProviderId(activeId);
      setKeys(loadedKeys);
      setModels(loadedModels);
      setBaseUrl(url ?? "");
    })().catch(() => {
      // Nothing loaded means nothing to show; the fields stay empty and usable.
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const provider = useMemo(
    () => providers.find((p) => p.id === providerId),
    [providers, providerId],
  );
  const needsBaseUrl = !!provider && provider.base_url === "";
  const apiKey = keys[providerId] ?? "";
  const model = models[providerId] ?? "";
  const ready =
    !!apiKey.trim() && (!needsBaseUrl || (!!baseUrl.trim() && !!model.trim()));

  const persist = async () => {
    await api.setSetting("llm_provider", providerId);
    await api.setSetting(keyOf(providerId), apiKey.trim());
    await api.setSetting(modelOf(providerId), model.trim());
    // What the rest of the app reads. Empty means "the provider's own default".
    await api.setSetting("llm_model", model.trim());
    if (needsBaseUrl) await api.setSetting("llm_base_url", baseUrl.trim());
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
    if (!ready) {
      setTestError(t.testKeyMissing);
      return;
    }
    setTesting(true);
    try {
      await persist();
      appLog.info(`[llm-test] probing ${providerId} / ${model || provider?.default_model}`);
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
        <TextField
          select
          fullWidth
          size="small"
          label={t.provider}
          value={providers.length ? providerId : ""}
          onChange={(e) => setProviderId(e.target.value)}
          InputProps={{ sx: { fontSize: 13 } }}
          InputLabelProps={{ sx: { fontSize: 13 } }}
        >
          {providers.map((p) => (
            <MenuItem key={p.id} value={p.id} sx={{ fontSize: 13 }}>
              {p.base_url === "" ? t.providerCustom : p.label}
            </MenuItem>
          ))}
        </TextField>

        <TextField
          fullWidth
          size="small"
          type="password"
          label={t.apiKey}
          placeholder={provider?.key_hint}
          value={apiKey}
          onChange={(e) => setKeys((k) => ({ ...k, [providerId]: e.target.value }))}
          InputProps={{ sx: { fontSize: 13 } }}
          InputLabelProps={{ sx: { fontSize: 13 } }}
        />

        {needsBaseUrl && (
          <TextField
            fullWidth
            size="small"
            label={t.baseUrl}
            placeholder="https://api.example.com/v1"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            helperText={t.baseUrlHint}
            InputProps={{ sx: { fontSize: 13 } }}
            InputLabelProps={{ sx: { fontSize: 13 } }}
            FormHelperTextProps={{ sx: { fontSize: 11 } }}
          />
        )}

        <TextField
          fullWidth
          size="small"
          label={t.model}
          placeholder={provider?.model_hint}
          value={model}
          onChange={(e) => setModels((m) => ({ ...m, [providerId]: e.target.value }))}
          helperText={model.trim() ? undefined : provider?.default_model || undefined}
          InputProps={{ sx: { fontSize: 13 } }}
          InputLabelProps={{ sx: { fontSize: 13 } }}
          FormHelperTextProps={{ sx: { fontSize: 11 } }}
        />

        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Button
            size="small"
            variant="contained"
            onClick={handleSave}
            disabled={!ready}
            sx={{ px: 2 }}
          >
            {t.save}
          </Button>
          <Button
            size="small"
            variant="outlined"
            onClick={handleTest}
            disabled={testing || !ready}
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

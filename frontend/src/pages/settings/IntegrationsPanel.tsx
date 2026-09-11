import { useEffect, useState } from "react";
import {
  Box,
  Typography,
  TextField,
  Button,
  Chip,
} from "@mui/material";
import { useI18n, type Translations } from "@/i18n";
import * as api from "@/utils/tauri";
import SettingsGroup from "./SettingsGroup";

/**
 * Where the tasks come from.
 *
 * Both providers are peers: a company may run Yandex Tracker, a corporate
 * GitLab, or both, and the app reads issues from whichever is connected.
 */
export default function IntegrationsPanel() {
  const { t } = useI18n();

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2, maxWidth: 620 }}>
      <TrackerSection t={t} />
      <GitLabSection t={t} />
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
    <SettingsGroup
      title={
        <>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {t.yandexTracker}
          </Typography>
          {connected && <Chip label="✓" size="small" color="success" sx={{ height: 20 }} />}
        </>
      }
      caption={t.trackerHelp}
    >

      <TextField fullWidth size="small" label="Client ID" value={clientId} onChange={(e) => setClientId(e.target.value)} InputProps={{ sx: { fontSize: 13 } }} InputLabelProps={{ sx: { fontSize: 13 } }} />
      <TextField fullWidth size="small" type="password" label="Client Secret" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} InputProps={{ sx: { fontSize: 13 } }} InputLabelProps={{ sx: { fontSize: 13 } }} />

      <Button size="small" variant={connected ? "outlined" : "contained"} onClick={handleStartAuth} disabled={!clientId || !clientSecret || polling} sx={{ alignSelf: "flex-start", px: 2 }}>
        {polling ? "Ожидание авторизации..." : connected ? "Переподключить" : "Подключить"}
      </Button>

      {userCode && (
        <Box sx={{ p: 1.5, bgcolor: "var(--overlay-2)", borderRadius: 1 }}>
          <Typography variant="body2" sx={{ mb: 1 }}>
            Откройте <Box component="a" href={verifyUrl} target="_blank" rel="noreferrer" sx={{ color: "primary.main" }}>{verifyUrl}</Box> и введите код:
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
    </SettingsGroup>
  );
}

/**
 * GitLab as a tracker in its own right.
 *
 * For people whose company has no Yandex Tracker this is the only integration
 * that matters, so it sits beside it as an equal rather than under it. A
 * personal access token with `read_api` is enough to read and search; `api` is
 * only needed to create issues.
 */
function GitLabSection({ t }: { t: Translations }) {
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [connected, setConnected] = useState(false);
  const [message, setMessage] = useState("");
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    api
      .gitlabStatus()
      .then((configured) => {
        if (!configured) return;
        setUrl(configured);
        setConnected(true);
      })
      .catch(() => {});
  }, []);

  // The token is never read back, so the field is empty on every visit. Leaving
  // it that way has to mean "keep the one you have" — otherwise changing the
  // address would cost the user a trip to GitLab for a new token.
  const canConnect = !!url.trim() && (!!token.trim() || connected);

  const connect = async () => {
    setChecking(true);
    setMessage("");
    try {
      await api.gitlabConfigure(url.trim(), token.trim());
      const who = await api.gitlabTest();
      setToken("");
      setConnected(true);
      setMessage(t.gitlabConnected(who));
    } catch (e) {
      setConnected(false);
      setMessage(String(e));
    } finally {
      setChecking(false);
    }
  };

  return (
    <SettingsGroup
      title={
        <>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            GitLab
          </Typography>
          {connected && <Chip label="✓" size="small" color="success" sx={{ height: 20 }} />}
        </>
      }
      caption={t.gitlabHelp}
    >

      <TextField
        fullWidth
        size="small"
        label={t.gitlabUrl}
        placeholder="https://gitlab.company.ru"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        InputProps={{ sx: { fontSize: 13 } }}
        InputLabelProps={{ sx: { fontSize: 13 } }}
      />
      <TextField
        fullWidth
        size="small"
        type="password"
        label={t.gitlabToken}
        placeholder={connected ? t.gitlabTokenKept : "glpat-..."}
        value={token}
        onChange={(e) => setToken(e.target.value)}
        InputProps={{ sx: { fontSize: 13 } }}
        InputLabelProps={{ sx: { fontSize: 13 } }}
      />

      <Button
        size="small"
        variant={connected ? "outlined" : "contained"}
        disabled={!canConnect || checking}
        onClick={connect}
        sx={{ alignSelf: "flex-start", px: 2 }}
      >
        {checking ? t.gitlabChecking : connected ? t.gitlabRecheck : t.gitlabConnect}
      </Button>

      {message && (
        <Typography variant="caption" color="text.secondary">
          {message}
        </Typography>
      )}
    </SettingsGroup>
  );
}

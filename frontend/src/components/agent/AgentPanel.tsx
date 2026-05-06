import { useState, useRef, useEffect } from "react";
import {
  Box,
  TextField,
  Typography,
  IconButton,
  Paper,


  InputAdornment,
  CircularProgress,
  Button,
} from "@mui/material";
import SmartToyIcon from "@mui/icons-material/SmartToy";
import SendIcon from "@mui/icons-material/Send";
import PersonIcon from "@mui/icons-material/Person";
import HistoryIcon from "@mui/icons-material/History";
import ReplayIcon from "@mui/icons-material/Replay";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import CloseIcon from "@mui/icons-material/Close";
import CheckIcon from "@mui/icons-material/Check";
import BlockIcon from "@mui/icons-material/Block";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useTaskStore } from "@/stores/taskStore";
import { useProjectStore } from "@/stores/projectStore";
import { useUiStore } from "@/stores/uiStore";
import { useChatStore } from "@/stores/chatStore";
import { useI18n } from "@/i18n";
import { appLog } from "@/stores/logStore";
import * as api from "@/utils/tauri";

export default function AgentPanel() {
  const [input, setInput] = useState("");
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const { load, loadDoing } = useTaskStore();
  const { selectedProjectId } = useProjectStore();
  const { selectedTaskId } = useUiStore();
  const { t, locale } = useI18n();
  const {
    sessions, currentSessionId, messages,
    loadSessions, newSession, openSession,
    addMessage, deleteSession, setConfirmationStatus,
  } = useChatStore();

  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (visible && !initialized) {
      loadSessions().then(() => setInitialized(true));
    }
  }, [visible, initialized, loadSessions]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const handleSubmit = async () => {
    const msg = input.trim();
    if (!msg || loading) return;

    await addMessage("user", msg);
    setInput("");
    setLoading(true);

    try {
      // Build history from previous messages (last 20 max)
      const hist: [string, string][] = messages.slice(-20).map((m) => [m.role, m.text]);
      const response = await api.agentChat(msg, selectedTaskId ?? undefined, hist);
      for (const tc of response.tool_calls) {
        appLog.info(`[agent] ${tc.tool_name}(${Object.entries(tc.arguments).map(([k,v]) => `${k}=${JSON.stringify(v)}`).join(", ")}) → ${tc.result.substring(0, 150)}`);
      }
      await addMessage(
        "assistant",
        response.text,
        response.tool_calls,
        true,
        response.pending_confirmations,
      );
      if (selectedProjectId) await load(selectedProjectId);
      await loadDoing();
    } catch (e) {
      const err = String(e);
      appLog.error(`[agent] ${err}`);
      if (err.includes("API_KEY_NOT_SET")) {
        await addMessage("assistant", locale === "ru" ? "API-ключ не настроен. Перейдите в **Настройки** → **ИИ-ассистент**." : "API key not set. Go to **Settings** → **AI Assistant**.");
      } else {
        await addMessage("assistant", err);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRegenerate = async (msgIndex: number) => {
    // Find the user message before this assistant message
    let userMsg = "";
    for (let j = msgIndex - 1; j >= 0; j--) {
      if (messages[j].role === "user") {
        userMsg = messages[j].text;
        break;
      }
    }
    if (!userMsg || loading) return;
    setLoading(true);
    try {
      const hist: [string, string][] = messages.slice(0, msgIndex).map((m) => [m.role, m.text]);
      const response = await api.agentChat(userMsg, selectedTaskId ?? undefined, hist);
      await addMessage("assistant", response.text, response.tool_calls, true);
      if (selectedProjectId) await load(selectedProjectId);
      await loadDoing();
    } catch (e) {
      await addMessage("assistant", String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleNewChat = async () => {
    await newSession();
    setShowHistory(false);
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const handleConfirm = async (msg: api.ChatMessageRecord) => {
    if (!msg.pending_confirmations || loading) return;
    setLoading(true);
    try {
      const results = await api.agentConfirm(msg.pending_confirmations);
      for (const r of results) {
        appLog.info(`[agent] confirmed: ${r.tool_name} → ${r.result.substring(0, 100)}`);
      }
      await setConfirmationStatus(msg.id, "confirmed");
      const summary = results.map((r) => `✓ ${r.tool_name}: ${r.result}`).join("\n");
      await addMessage("assistant", summary, results, true);
      if (selectedProjectId) await load(selectedProjectId);
      await loadDoing();
    } catch (e) {
      await addMessage("assistant", String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleCancelConfirmation = async (msg: api.ChatMessageRecord) => {
    if (loading) return;
    await setConfirmationStatus(msg.id, "cancelled");
    await addMessage("assistant", locale === "ru" ? "Отменено." : "Cancelled.");
  };

  const formatPendingArgs = (args: Record<string, unknown>): [string, string][] => {
    const labels: Record<string, { ru: string; en: string }> = {
      queue: { ru: "Очередь", en: "Queue" },
      summary: { ru: "Заголовок", en: "Title" },
      description: { ru: "Описание", en: "Description" },
      priority: { ru: "Приоритет", en: "Priority" },
      task_id: { ru: "ID задачи", en: "Task ID" },
    };
    return Object.entries(args)
      .filter(([, v]) => v !== null && v !== undefined && v !== "")
      .map(([k, v]) => {
        const lbl = labels[k];
        const label = lbl ? lbl[locale === "ru" ? "ru" : "en"] : k;
        const value = typeof v === "string" ? v : JSON.stringify(v);
        return [label, value];
      });
  };

  if (!visible) {
    return (
      <IconButton
        onClick={() => {
          setVisible(true);
          setTimeout(() => inputRef.current?.focus(), 100);
        }}
        sx={{ position: "fixed", bottom: 16, right: 16, bgcolor: "primary.main", color: "white", "&:hover": { bgcolor: "primary.dark" } }}
      >
        <SmartToyIcon />
      </IconButton>
    );
  }

  return (
    <>
    {/* Invisible backdrop to close on outside click */}
    <Box
      onClick={() => setVisible(false)}
      sx={{ position: "fixed", inset: 0, zIndex: 1299 }}
    />
    <Paper
      elevation={8}
      onClick={(e) => e.stopPropagation()}
      sx={{
        position: "fixed",
        bottom: 16,
        right: 16,
        bgcolor: "background.paper",
        zIndex: 1300,
        width: 420,
        height: 520,
        display: "flex",
        flexDirection: "column",
        borderRadius: 2,
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <Box sx={{ px: 2, py: 1, bgcolor: "primary.main", color: "white", display: "flex", alignItems: "center", gap: 1 }}>
        {showHistory ? (
          <>
            <IconButton size="small" onClick={() => setShowHistory(false)} sx={{ color: "white" }}>
              <ArrowBackIcon fontSize="small" />
            </IconButton>
            <Typography variant="subtitle2" sx={{ flex: 1 }}>
              {locale === "ru" ? "История" : "History"}
            </Typography>
            <IconButton size="small" onClick={handleNewChat} sx={{ color: "white" }} title={locale === "ru" ? "Новый чат" : "New chat"}>
              <AddIcon fontSize="small" />
            </IconButton>
          </>
        ) : (
          <>
            <Typography variant="subtitle2" sx={{ flex: 1 }}>{t.agent}</Typography>
            <IconButton size="small" onClick={handleNewChat} sx={{ color: "white" }} title={locale === "ru" ? "Новый чат" : "New chat"}>
              <AddIcon fontSize="small" />
            </IconButton>
            <IconButton size="small" onClick={() => setShowHistory(true)} sx={{ color: "white" }} title={locale === "ru" ? "История" : "History"}>
              <HistoryIcon fontSize="small" />
            </IconButton>
            <IconButton size="small" onClick={() => setVisible(false)} sx={{ color: "white" }}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </>
        )}
      </Box>

      {showHistory ? (
        /* Session list */
        <Box sx={{ flex: 1, overflow: "auto", py: 0.5 }}>
          {sessions.length === 0 && (
            <Box sx={{ py: 4, textAlign: "center" }}>
              <Typography variant="body2" color="text.secondary" sx={{ fontSize: 12 }}>
                {locale === "ru" ? "Нет истории" : "No history"}
              </Typography>
            </Box>
          )}
          {sessions.map((s) => (
            <Box
              key={s.id}
              onClick={() => { openSession(s.id); setShowHistory(false); }}
              sx={{
                px: 2,
                py: 1,
                cursor: "pointer",
                "&:hover": { bgcolor: "action.hover" },
                display: "flex",
                alignItems: "center",
                gap: 1,
                ...(s.id === currentSessionId && { bgcolor: "action.selected" }),
              }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" noWrap sx={{ fontSize: 13 }}>
                  {s.title || (locale === "ru" ? "Новый чат" : "New chat")}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
                  {new Date(s.created_at + "Z").toLocaleDateString()}
                </Typography>
              </Box>
              <IconButton
                size="small"
                onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}
                sx={{ opacity: 0.3, "&:hover": { opacity: 1 } }}
              >
                <DeleteOutlineIcon sx={{ fontSize: 14 }} />
              </IconButton>
            </Box>
          ))}
        </Box>
      ) : (
        <>
          {/* Chat messages */}
          <Box sx={{ flex: 1, overflow: "auto", px: 2, py: 1, userSelect: "text", cursor: "text" }}>
            {messages.length === 0 && (
              <Box sx={{ py: 4, textAlign: "center" }}>
                <SmartToyIcon sx={{ fontSize: 32, opacity: 0.2, mb: 1 }} />
                <Typography variant="body2" color="text.secondary" sx={{ fontSize: 12 }}>
                  {locale === "ru" ? "Спросите что угодно о ваших задачах" : "Ask anything about your tasks"}
                </Typography>
              </Box>
            )}
            {messages.map((msg, i) => (
              <Box key={msg.id} sx={{ mb: 1.5, display: "flex", gap: 1, alignItems: "flex-start" }}>
                <Box sx={{ mt: "2px", flexShrink: 0 }}>
                  {msg.role === "user" ? (
                    <PersonIcon sx={{ fontSize: 16, opacity: 0.5 }} />
                  ) : (
                    <SmartToyIcon sx={{ fontSize: 16, color: "primary.main" }} />
                  )}
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Box
                    onClick={async (e) => {
                      const link = (e.target as HTMLElement).closest("a");
                      if (link) {
                        e.preventDefault();
                        const href = link.getAttribute("href");
                        if (href) {
                          try {
                            const { open } = await import("@tauri-apps/plugin-shell");
                            await open(href);
                          } catch {
                            window.open(href, "_blank");
                          }
                        }
                      }
                    }}
                    sx={{
                      fontSize: 13,
                      lineHeight: 1.5,
                      "& p": { m: 0, mb: 0.5 },
                      "& ul, & ol": { m: 0, pl: 2, mb: 0.5 },
                      "& li": { mb: 0.25 },
                      "& code": { bgcolor: "rgba(255,255,255,0.08)", px: 0.5, borderRadius: 0.5, fontSize: 12 },
                      "& pre": { bgcolor: "rgba(255,255,255,0.06)", p: 1, borderRadius: 1, overflow: "auto", mb: 0.5 },
                      "& strong": { fontWeight: 600 },
                      "& a": { color: "#5ec4b0", textDecorationColor: "rgba(94,196,176,0.4)", cursor: "pointer" },
                    }}
                  >
                    {msg.text && <Markdown remarkPlugins={[remarkGfm]}>{msg.text}</Markdown>}
                  </Box>
                  {msg.pending_confirmations && msg.pending_confirmations.length > 0 && (
                    <Box
                      sx={{
                        mt: msg.text ? 1 : 0,
                        p: 1.25,
                        borderRadius: 1,
                        border: 1,
                        borderColor: msg.confirmation_status === "confirmed"
                          ? "rgba(94,196,176,0.3)"
                          : msg.confirmation_status === "cancelled"
                            ? "rgba(255,255,255,0.08)"
                            : "rgba(255,180,0,0.35)",
                        bgcolor: msg.confirmation_status === "confirmed"
                          ? "rgba(94,196,176,0.06)"
                          : msg.confirmation_status === "cancelled"
                            ? "rgba(255,255,255,0.02)"
                            : "rgba(255,180,0,0.06)",
                      }}
                    >
                      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 0.75 }}>
                        {msg.confirmation_status === "confirmed" ? (
                          <CheckIcon sx={{ fontSize: 14, color: "#5ec4b0" }} />
                        ) : msg.confirmation_status === "cancelled" ? (
                          <BlockIcon sx={{ fontSize: 14, opacity: 0.5 }} />
                        ) : (
                          <WarningAmberIcon sx={{ fontSize: 14, color: "#f5b041" }} />
                        )}
                        <Typography variant="caption" sx={{ fontWeight: 600, fontSize: 11 }}>
                          {msg.confirmation_status === "confirmed"
                            ? (locale === "ru" ? "Выполнено" : "Confirmed")
                            : msg.confirmation_status === "cancelled"
                              ? (locale === "ru" ? "Отменено" : "Cancelled")
                              : (locale === "ru" ? "Требуется подтверждение" : "Confirmation required")}
                        </Typography>
                      </Box>
                      {msg.pending_confirmations.map((pc, k) => (
                        <Box key={k} sx={{ mb: k < msg.pending_confirmations!.length - 1 ? 1 : 0 }}>
                          <Typography sx={{ fontSize: 12, fontWeight: 500, mb: 0.25 }}>
                            {pc.description}
                          </Typography>
                          <Box sx={{ pl: 0.5 }}>
                            {formatPendingArgs(pc.arguments).map(([label, value], j) => (
                              <Box key={j} sx={{ display: "flex", gap: 0.5, fontSize: 11, lineHeight: 1.4 }}>
                                <Typography sx={{ fontSize: 11, opacity: 0.5, minWidth: 64, flexShrink: 0 }}>
                                  {label}:
                                </Typography>
                                <Typography sx={{ fontSize: 11, opacity: 0.85, wordBreak: "break-word" }}>
                                  {value}
                                </Typography>
                              </Box>
                            ))}
                          </Box>
                        </Box>
                      ))}
                      {msg.confirmation_status === "pending" && (
                        <Box sx={{ display: "flex", gap: 0.75, mt: 1 }}>
                          <Button
                            size="small"
                            variant="contained"
                            color="warning"
                            onClick={() => handleConfirm(msg)}
                            disabled={loading}
                            sx={{ fontSize: 11, py: 0.25, px: 1, minWidth: 0 }}
                          >
                            {locale === "ru" ? "Подтвердить" : "Confirm"}
                          </Button>
                          <Button
                            size="small"
                            variant="outlined"
                            onClick={() => handleCancelConfirmation(msg)}
                            disabled={loading}
                            sx={{ fontSize: 11, py: 0.25, px: 1, minWidth: 0 }}
                          >
                            {locale === "ru" ? "Отмена" : "Cancel"}
                          </Button>
                        </Box>
                      )}
                    </Box>
                  )}
                  {msg.tool_calls && msg.tool_calls.length > 0 && (
                    <details style={{ marginTop: 4 }}>
                      <summary style={{ fontSize: 10, opacity: 0.4, cursor: "pointer" }}>
                        {msg.tool_calls.length} tool{msg.tool_calls.length > 1 ? "s" : ""} used
                      </summary>
                      <Box sx={{ mt: 0.5, display: "flex", flexDirection: "column", gap: 0.25 }}>
                        {msg.tool_calls.map((tc, j) => (
                          <Typography key={j} sx={{ fontSize: 10, fontFamily: "monospace", opacity: 0.4 }}>
                            {tc.tool_name}({Object.entries(tc.arguments).map(([k,v]) => `${k}=${JSON.stringify(v)}`).join(", ")})
                          </Typography>
                        ))}
                      </Box>
                    </details>
                  )}
                  {msg.role === "assistant" && (
                    <IconButton size="small" onClick={() => handleRegenerate(i)} sx={{ mt: 0.25, opacity: 0.3, "&:hover": { opacity: 0.7 } }} title={locale === "ru" ? "Перегенерировать" : "Regenerate"}>
                      <ReplayIcon sx={{ fontSize: 14 }} />
                    </IconButton>
                  )}
                </Box>
              </Box>
            ))}
            {loading && (
              <Box sx={{ display: "flex", justifyContent: "center", py: 2 }}>
                <CircularProgress size={20} />
              </Box>
            )}
            <div ref={chatEndRef} />
          </Box>

          {/* Input */}
          <Box sx={{ p: 1, borderTop: 1, borderColor: "divider" }}>
            <TextField
              inputRef={inputRef}
              fullWidth
              size="small"
              multiline
              maxRows={5}
              placeholder={t.typeCommand}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
              disabled={loading}
              InputProps={{
                sx: { fontSize: 13, alignItems: "center" },
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton size="small" onClick={handleSubmit} disabled={loading}>
                      <SendIcon fontSize="small" />
                    </IconButton>
                  </InputAdornment>
                ),
              }}
            />
          </Box>
        </>
      )}
    </Paper>
    </>
  );
}

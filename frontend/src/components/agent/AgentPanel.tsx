import { useState, useRef, useEffect } from "react";
import {
  Box,
  TextField,
  Typography,
  IconButton,
  Paper,
  Button,
  Chip,
  InputAdornment,
  CircularProgress,
} from "@mui/material";
import SmartToyIcon from "@mui/icons-material/SmartToy";
import SendIcon from "@mui/icons-material/Send";
import PersonIcon from "@mui/icons-material/Person";
import HistoryIcon from "@mui/icons-material/History";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import CloseIcon from "@mui/icons-material/Close";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useTaskStore } from "@/stores/taskStore";
import { useProjectStore } from "@/stores/projectStore";
import { useHistoryStore } from "@/stores/historyStore";
import { useChatStore } from "@/stores/chatStore";
import { useI18n } from "@/i18n";
import * as api from "@/utils/tauri";

export default function AgentPanel() {
  const [input, setInput] = useState("");
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const { load, loadDoing, remove, update, move: moveTask } = useTaskStore();
  const { selectedProjectId } = useProjectStore();
  const { refresh } = useHistoryStore();
  const { t, locale } = useI18n();
  const {
    sessions, currentSessionId, messages,
    loadSessions, newSession, openSession,
    addMessage, markExecuted, deleteSession,
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
      const response = await api.agentChat(msg);
      await addMessage("assistant", response.summary, response.actions, false);
    } catch (e) {
      const err = String(e);
      if (err.includes("API_KEY_NOT_SET")) {
        await addMessage("assistant", locale === "ru" ? "API-ключ не настроен. Перейдите в **Настройки** → **ИИ-ассистент**." : "API key not set. Go to **Settings** → **AI Assistant**.");
      } else {
        await addMessage("assistant", err);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async (msgIndex: number) => {
    const msg = messages[msgIndex];
    if (!msg?.actions?.length) return;
    setLoading(true);

    try {
      for (const action of msg.actions) {
        switch (action.action) {
          case "delete":
            if (action.task_id) await remove(action.task_id);
            break;
          case "update":
            if (action.task_id && action.field)
              await update(action.task_id, { [action.field]: action.value });
            break;
          case "move":
            if (action.task_id && action.value)
              await moveTask(action.task_id, action.value as api.TaskStatus);
            break;
          case "create":
            if (action.value) {
              const projectId = action.field || selectedProjectId || undefined;
              await api.createTask(action.value, projectId);
            }
            break;
          case "remember":
          case "forget":
            break;
        }
      }
      await markExecuted(msg.id);
      if (selectedProjectId) await load(selectedProjectId);
      await loadDoing();
      await refresh();
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
    <Paper
      elevation={8}
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
                    sx={{
                      fontSize: 13,
                      lineHeight: 1.5,
                      "& p": { m: 0, mb: 0.5 },
                      "& ul, & ol": { m: 0, pl: 2, mb: 0.5 },
                      "& li": { mb: 0.25 },
                      "& code": { bgcolor: "rgba(255,255,255,0.08)", px: 0.5, borderRadius: 0.5, fontSize: 12 },
                      "& pre": { bgcolor: "rgba(255,255,255,0.06)", p: 1, borderRadius: 1, overflow: "auto", mb: 0.5 },
                      "& strong": { fontWeight: 600 },
                    }}
                  >
                    <Markdown remarkPlugins={[remarkGfm]}>{msg.text}</Markdown>
                  </Box>
                  {msg.actions && msg.actions.length > 0 && (
                    <Box sx={{ mt: 0.5, display: "flex", flexDirection: "column", gap: 0.5 }}>
                      {msg.actions.slice(0, 8).map((a, j) => (
                        <Chip key={j} label={a.description || a.value || a.action} size="small" variant="outlined" sx={{ justifyContent: "flex-start", fontSize: 11 }} />
                      ))}
                      {msg.actions.length > 8 && (
                        <Typography variant="caption" color="text.secondary">{t.andMore(msg.actions.length - 8)}</Typography>
                      )}
                      {!msg.executed && (
                        <Box sx={{ mt: 0.5, display: "flex", gap: 1 }}>
                          <Button size="small" variant="contained" onClick={() => handleApply(i)}>{t.apply}</Button>
                          <Button size="small" onClick={() => markExecuted(msg.id)}>{t.cancel}</Button>
                        </Box>
                      )}
                      {msg.executed && <Chip label={t.applied} size="small" color="success" sx={{ mt: 0.5 }} />}
                    </Box>
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
  );
}

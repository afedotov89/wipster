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
import StopCircleIcon from "@mui/icons-material/StopCircle";
import CheckIcon from "@mui/icons-material/Check";
import Chip from "@mui/material/Chip";
import BlockIcon from "@mui/icons-material/Block";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useTaskStore } from "@/stores/taskStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useProjectStore } from "@/stores/projectStore";
import { useUiStore } from "@/stores/uiStore";
import { useChatStore } from "@/stores/chatStore";
import { useI18n } from "@/i18n";
import { appLog } from "@/stores/logStore";
import * as api from "@/utils/tauri";
import { suggestPrompts } from "@/utils/promptSuggestions";

/// One line of the live activity read-out while the agent works.
type ActivityStep = Pick<api.AgentProgress, "seq" | "phase" | "tool" | "variant" | "detail">;

/// How many finished steps stay on screen; older ones scroll out of the trail.
const ACTIVITY_TRAIL = 6;

/// Ids only have to be unique among the runs of one app session, and
/// `crypto.randomUUID` is secure-context only — which the webview's custom
/// scheme does not guarantee.
let runCounter = 0;
const newRunId = () => `run-${Date.now().toString(36)}-${(runCounter += 1)}`;

export default function AgentPanel() {
  const [input, setInput] = useState("");
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [steps, setSteps] = useState<ActivityStep[]>([]);
  const [elapsed, setElapsed] = useState(0);
  /// Identifies the request in flight: the backend tags its progress events and
  /// accepts a stop for this id, and anything arriving under another id belongs
  /// to a run the user already walked away from.
  const runIdRef = useRef<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const { load, loadDoing, tasks, doingTasks, archivedTasks, findTask } = useTaskStore();
  const { selectedProjectId, projects } = useProjectStore();
  const { selectedTaskId, detailOpen, view } = useUiStore();
  const wipLimit = useSettingsStore((s) => s.wipLimit);
  const { t, locale } = useI18n();
  const {
    sessions, currentSessionId, messages,
    loadSessions, newSession, openSession,
    addMessage, deleteSession, setConfirmationStatus,
  } = useChatStore();

  const [initialized, setInitialized] = useState(false);
  // Context for the hints that does not live in a store: whether the tracker is
  // connected, and the commands this user types most often.
  const [trackerReady, setTrackerReady] = useState(false);
  const [recentPrompts, setRecentPrompts] = useState<string[]>([]);
  // Rotates so the "you can ask the app itself" tip is a different one each time.
  const [appTipIndex, setAppTipIndex] = useState(() => {
    const stored = Number(localStorage.getItem("wipster-app-tip") ?? 0);
    return Number.isFinite(stored) ? stored : 0;
  });

  useEffect(() => {
    if (visible && !initialized) {
      loadSessions().then(() => setInitialized(true));
    }
  }, [visible, initialized, loadSessions]);

  // Refreshed whenever the panel opens on an empty chat, so a command used
  // yesterday can be offered today.
  useEffect(() => {
    if (!visible || messages.length > 0) return;
    void api.trackerStatus().then(setTrackerReady).catch(() => setTrackerReady(false));
    void api
      .recentUserPrompts(8)
      .then((prompts) => setRecentPrompts(Array.isArray(prompts) ? prompts : []))
      .catch(() => setRecentPrompts([]));
    setAppTipIndex((previous) => {
      const next = previous + 1;
      try {
        localStorage.setItem("wipster-app-tip", String(next));
      } catch {
        // Rotation is a nicety; losing it costs nothing.
      }
      return next;
    });
  }, [visible, messages.length]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, steps]);

  // Live steps from the backend. The last one is what the agent is doing right
  // now; the ones before it are done. "Thinking" is never kept in the trail —
  // it is the gap between two real steps, not a step of its own.
  useEffect(() => {
    const unlisten = api.onAgentProgress((step) => {
      if (step.run_id !== runIdRef.current) return;
      setSteps((prev) => {
        const trail = prev.filter((s) => s.phase === "tool");
        return [...trail, step].slice(-ACTIVITY_TRAIL);
      });
    });
    return () => {
      void unlisten.then((off) => off());
    };
  }, []);

  // Seconds on the wall — the difference between "it is working" and "it is stuck".
  useEffect(() => {
    if (!loading) {
      setElapsed(0);
      return;
    }
    const startedAt = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [loading]);

  // Escape is the universal way out, innermost thing first: stop the run, leave
  // the history list, close the panel.
  useEffect(() => {
    if (!visible) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (runIdRef.current) void handleStop();
      else if (showHistory) setShowHistory(false);
      else setVisible(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [visible, showHistory, t]);

  /// Claim the panel for a new request and return its id. Anything still in
  /// flight is abandoned by the id check every handler makes before it writes.
  const startRun = (initial: ActivityStep[] = []) => {
    const runId = newRunId();
    runIdRef.current = runId;
    setSteps(initial);
    setLoading(true);
    return runId;
  };

  /// Release the panel, unless another run has already taken it over.
  const endRun = (runId: string) => {
    if (runIdRef.current !== runId) return false;
    runIdRef.current = null;
    setLoading(false);
    setSteps([]);
    return true;
  };

  const runAgent = async (userMsg: string, hist: [string, string][]) => {
    const runId = startRun();
    try {
      const response = await api.agentChat(runId, userMsg, selectedTaskId ?? undefined, hist);
      if (runIdRef.current !== runId) return;
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
      // A run the user stopped is not a failure, and a stopped run's error
      // belongs to nobody — the panel has already moved on.
      if (runIdRef.current !== runId || err.includes(api.AGENT_CANCELLED)) {
        appLog.info(`[agent] run dropped: ${err}`);
        return;
      }
      appLog.error(`[agent] ${err}`);
      if (err.includes("API_KEY_NOT_SET")) {
        await addMessage("assistant", t.agentNoApiKey);
      } else if (err.includes("INTERNAL_ERROR")) {
        await addMessage("assistant", t.agentInternalError);
      } else {
        await addMessage("assistant", err);
      }
    } finally {
      endRun(runId);
    }
  };

  const handleSubmit = async () => {
    const msg = input.trim();
    if (!msg || loading) return;

    // History from previous messages (last 20 max), captured before the new one.
    const hist: [string, string][] = messages.slice(-20).map((m) => [m.role, m.text]);
    await addMessage("user", msg);
    setInput("");
    await runAgent(msg, hist);
  };

  /// Stop whatever is running: the backend drops the run, the panel frees up.
  const handleStop = async () => {
    const runId = runIdRef.current;
    runIdRef.current = null;
    setLoading(false);
    setSteps([]);
    if (runId) {
      try {
        await api.agentCancel(runId);
      } catch (e) {
        appLog.error(`[agent] stop failed: ${e}`);
      }
    }
    await addMessage("assistant", t.agentStopped);
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
    const hist: [string, string][] = messages.slice(0, msgIndex).map((m) => [m.role, m.text]);
    await runAgent(userMsg, hist);
  };

  const handleNewChat = async () => {
    if (loading) await handleStop();
    await newSession();
    setShowHistory(false);
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const handleConfirm = async (msg: api.ChatMessageRecord) => {
    if (!msg.pending_confirmations || loading) return;
    // Confirmed tools run outside the agent loop, so their activity line is
    // built here from what the user just approved.
    const runId = startRun([
      {
        seq: 0,
        phase: "tool",
        tool: msg.pending_confirmations[0].tool_name,
        variant: null,
        detail: null,
      },
    ]);
    try {
      const results = await api.agentConfirm(msg.pending_confirmations);
      if (runIdRef.current !== runId) return;
      for (const r of results) {
        appLog.info(`[agent] confirmed: ${r.tool_name} → ${r.result.substring(0, 100)}`);
      }
      await setConfirmationStatus(msg.id, "confirmed");
      const summary = results.map((r) => `✓ ${r.tool_name}: ${r.result}`).join("\n");
      await addMessage("assistant", summary, results, true);
      if (selectedProjectId) await load(selectedProjectId);
      await loadDoing();
    } catch (e) {
      if (runIdRef.current !== runId) return;
      await addMessage("assistant", String(e));
    } finally {
      endRun(runId);
    }
  };

  const handleCancelConfirmation = async (msg: api.ChatMessageRecord) => {
    if (loading) return;
    await setConfirmationStatus(msg.id, "cancelled");
    await addMessage("assistant", locale === "ru" ? "Отменено." : "Cancelled.");
  };

  // Commands worth offering for what is on screen right now. Only computed for
  // an empty chat: once a conversation has started, the context is the
  // conversation, not the board.
  const suggestions =
    messages.length === 0 && !loading
      ? suggestPrompts(
          {
            view,
            task: (detailOpen && findTask(selectedTaskId)) || null,
            project: projects.find((p) => p.id === selectedProjectId) ?? null,
            tasks,
            doingTasks,
            archivedCount: archivedTasks.length,
            wipLimit,
            today: new Date().toISOString().slice(0, 10),
            trackerReady,
            recentPrompts,
            appTipIndex,
          },
          t,
        )
      : [];

  /// Steps as the user reads them: past tense once done, present while running.
  const activity = (steps.length > 0
    ? steps
    : [{ seq: -1, phase: "thinking" as const, tool: null, variant: null, detail: null }]
  ).map((step, i, all) => {
    const done = i < all.length - 1;
    if (step.phase !== "tool" || !step.tool) {
      return { key: `${step.seq}`, text: t.agentThinking };
    }
    const label = t.agentStep(step.tool, step.variant, done);
    return { key: `${step.seq}`, text: step.detail ? `${label} · ${step.detail}` : label };
  });

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
        sx={{
          position: "fixed", bottom: 16, right: 16,
          bgcolor: "background.paper", color: "primary.main",
          boxShadow: "var(--card-shadow)",
          transition: "background-color 0.15s, transform 0.15s",
          "&:hover": { bgcolor: "background.paper", transform: "translateY(-1px)" },
        }}
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
              onClick={async () => {
                if (loading) await handleStop();
                await openSession(s.id);
                setShowHistory(false);
              }}
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
                {suggestions.length > 0 && (
                  <Box
                    sx={{
                      mt: 2,
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 0.75,
                      justifyContent: "center",
                    }}
                  >
                    {suggestions.map((suggestion) => (
                      <Chip
                        key={suggestion.id}
                        label={suggestion.label}
                        size="small"
                        variant="outlined"
                        clickable
                        title={suggestion.prompt}
                        onClick={() => {
                          // Put it in the field rather than send it: a hint is a
                          // starting point the user can edit before committing.
                          setInput(suggestion.prompt);
                          inputRef.current?.focus();
                        }}
                        sx={{ fontSize: 11, height: 24, borderColor: "var(--overlay-3)" }}
                      />
                    ))}
                  </Box>
                )}
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
                      "& code": { bgcolor: "var(--overlay-2)", px: 0.5, borderRadius: 0.5, fontSize: 12 },
                      "& pre": { bgcolor: "var(--overlay-2)", p: 1, borderRadius: 1, overflow: "auto", mb: 0.5 },
                      "& strong": { fontWeight: 600 },
                      "& a": { color: "primary.main", textDecoration: "underline", textDecorationStyle: "dotted", cursor: "pointer" },
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
                          ? "success.main"
                          : msg.confirmation_status === "cancelled"
                            ? "var(--overlay-2)"
                            : "warning.main",
                        bgcolor: msg.confirmation_status === "confirmed"
                          ? "var(--overlay-1)"
                          : msg.confirmation_status === "cancelled"
                            ? "var(--overlay-1)"
                            : "var(--overlay-2)",
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
              <Box sx={{ mb: 1.5, display: "flex", gap: 1, alignItems: "flex-start" }}>
                <SmartToyIcon sx={{ fontSize: 16, color: "primary.main", mt: "2px", flexShrink: 0 }} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  {activity.map((line, i) => {
                    const isCurrent = i === activity.length - 1;
                    return (
                      <Box
                        key={line.key}
                        sx={{ display: "flex", alignItems: "center", gap: 0.75, minHeight: 18 }}
                      >
                        {isCurrent ? (
                          <CircularProgress size={10} thickness={6} sx={{ flexShrink: 0 }} />
                        ) : (
                          <CheckIcon sx={{ fontSize: 12, opacity: 0.4, flexShrink: 0 }} />
                        )}
                        <Typography
                          noWrap
                          sx={
                            isCurrent
                              ? (theme) => ({
                                  fontSize: 12,
                                  fontWeight: 500,
                                  // Sweeping highlight: the line reads as alive
                                  // even while nothing else on screen moves.
                                  backgroundImage: `linear-gradient(90deg, ${theme.palette.text.secondary} 0%, ${theme.palette.text.primary} 45%, ${theme.palette.text.secondary} 90%)`,
                                  backgroundSize: "220% 100%",
                                  WebkitBackgroundClip: "text",
                                  backgroundClip: "text",
                                  color: "transparent",
                                  WebkitTextFillColor: "transparent",
                                  animation: "agent-activity-sweep 1.8s linear infinite",
                                  "@keyframes agent-activity-sweep": {
                                    from: { backgroundPosition: "140% 0" },
                                    to: { backgroundPosition: "-140% 0" },
                                  },
                                })
                              : { fontSize: 12, opacity: 0.45 }
                          }
                        >
                          {line.text}
                        </Typography>
                        {isCurrent && elapsed >= 2 && (
                          <Typography sx={{ fontSize: 11, opacity: 0.3, flexShrink: 0 }}>
                            {t.agentElapsed(elapsed)}
                          </Typography>
                        )}
                      </Box>
                    );
                  })}
                </Box>
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
                  // Pulled out by the icon button's own padding, so the glyph
                  // sits as far from the right edge as the text does from the
                  // left — measured, not guessed — while the click target keeps
                  // its full size.
                  <InputAdornment position="end" sx={{ mr: "-5px" }}>
                    {loading ? (
                      <IconButton
                        size="small"
                        onClick={handleStop}
                        title={t.agentStop}
                        sx={{ color: "error.main" }}
                      >
                        <StopCircleIcon fontSize="small" />
                      </IconButton>
                    ) : (
                      <IconButton size="small" onClick={handleSubmit} disabled={!input.trim()}>
                        <SendIcon fontSize="small" />
                      </IconButton>
                    )}
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

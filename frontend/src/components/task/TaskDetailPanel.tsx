import { useEffect, useState, useCallback } from "react";
import {
  Box,
  Typography,
  TextField,
  ToggleButtonGroup,
  ToggleButton,
  IconButton,
  Chip,
  Divider,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  CircularProgress,
  Autocomplete,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import CheckBoxOutlineBlankIcon from "@mui/icons-material/CheckBoxOutlineBlank";
import CheckBoxIcon from "@mui/icons-material/CheckBox";
import { useUiStore } from "@/stores/uiStore";
import { useTaskStore } from "@/stores/taskStore";
import { useProjectStore } from "@/stores/projectStore";
import { useHistoryStore } from "@/stores/historyStore";
import { statusLabel, priorityLabel, PRIORITIES } from "@/utils/constants";
import { useI18n } from "@/i18n";
import { useAiAutocomplete } from "@/hooks/useAiAutocomplete";
import { getPromisedToOptions, getEstimateOptions } from "@/utils/tauri";
import type { TaskStatus } from "@/utils/tauri";

interface ChecklistItem {
  text: string;
  done: boolean;
}

interface AiFieldProps {
  label: string;
  fieldName: string;
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
  multiline?: boolean;
  rows?: number;
  suggestion: string | null;
  loading: boolean;
  activeField: string | null;
  onKeyDown: (e: React.KeyboardEvent, fieldName: string, value: string, setValue: (v: string) => void) => void;
  onChangeAi: (fieldName: string, value: string) => void;
}

function AiTextField({ label, fieldName, value, onChange, onBlur, multiline, rows, suggestion, loading, activeField, onKeyDown, onChangeAi }: AiFieldProps) {
  const showSuggestion = activeField === fieldName && suggestion;

  return (
    <Box sx={{ position: "relative" }}>
      <TextField
        fullWidth
        size="small"
        label={label}
        multiline={multiline}
        rows={rows}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          onChangeAi(fieldName, e.target.value);
        }}
        onBlur={onBlur}
        onKeyDown={(e) => onKeyDown(e, fieldName, value, onChange)}

        sx={{ "& .MuiInputBase-input": { fontSize: 13 } }}
      />
      {loading && activeField === fieldName && (
        <CircularProgress size={14} sx={{ position: "absolute", right: 12, top: 12 }} />
      )}
      {showSuggestion && (
        <Box
          sx={{
            mt: 0.5,
            p: 1,
            bgcolor: "rgba(46,125,111,0.1)",
            border: "1px solid rgba(46,125,111,0.3)",
            borderRadius: 1,
            fontSize: 12,
            color: "text.secondary",
            cursor: "pointer",
          }}
          onClick={() => onChange(suggestion)}
        >
          <Typography variant="caption" sx={{ opacity: 0.6, display: "block", mb: 0.25 }}>
            Tab ↹
          </Typography>
          {suggestion}
        </Box>
      )}
    </Box>
  );
}

export default function TaskDetailPanel() {
  const { selectedTaskId, closeDetail } = useUiStore();
  const { tasks, update, remove } = useTaskStore();
  const { projects } = useProjectStore();
  const { refresh } = useHistoryStore();
  const { t } = useI18n();

  const task = tasks.find((t) => t.id === selectedTaskId);

  const [title, setTitle] = useState("");
  const [dod, setDod] = useState("");
  const [due, setDue] = useState("");
  const [timeEstimate, setTimeEstimate] = useState("");
  const [promisedTo, setPromisedTo] = useState("");
  const [promisedToOptions, setPromisedToOptions] = useState<string[]>([]);
  const [estimateOptions, setEstimateOptions] = useState<string[]>([]);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [newStep, setNewStep] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 3000);
      return;
    }
    if (!selectedTaskId) return;
    closeDetail();
    await remove(selectedTaskId);
    await refresh();
  };

  const {
    suggestion,
    loading: aiLoading,
    activeField,
    handleKeyDown: aiKeyDown,
    handleChange: aiChange,
    dismiss: aiDismiss,
  } = useAiAutocomplete(selectedTaskId);

  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setDod(task.dod ?? "");
      setDue(task.due ?? "");
      setTimeEstimate(task.time_estimate ?? "");
      setPromisedTo(task.promised_to ?? "");
      let items: ChecklistItem[] = [];
      try { items = JSON.parse(task.checklist || "[]"); } catch { /* */ }
      // Migrate legacy next_step into checklist
      if (items.length === 0 && task.next_step) {
        items = [{ text: task.next_step, done: false }];
        update(task.id, { checklist: JSON.stringify(items), next_step: "" });
      }
      setChecklist(items);
      aiDismiss();
    }
  }, [task, aiDismiss]);

  useEffect(() => {
    getPromisedToOptions().then(setPromisedToOptions).catch(() => {});
    getEstimateOptions().then(setEstimateOptions).catch(() => {});
  }, []);

  const save = useCallback(
    async (field: string, value: string | null) => {
      if (!selectedTaskId) return;
      await update(selectedTaskId, { [field]: value });
      await refresh();
    },
    [selectedTaskId, update, refresh]
  );

  const saveChecklist = useCallback(
    (items: ChecklistItem[]) => {
      setChecklist(items);
      save("checklist", JSON.stringify(items));
    },
    [save]
  );

  const addStep = () => {
    if (!newStep.trim()) return;
    saveChecklist([...checklist, { text: newStep.trim(), done: false }]);
    setNewStep("");
  };

  const toggleStep = (index: number) => {
    const next = checklist.map((item, i) =>
      i === index ? { ...item, done: !item.done } : item
    );
    saveChecklist(next);
  };

  const removeStep = (index: number) => {
    saveChecklist(checklist.filter((_, i) => i !== index));
  };

  if (!task) {
    return (
      <Box sx={{ p: 2 }}>
        <Typography color="text.secondary">{t.noTaskSelected}</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 2, display: "flex", flexDirection: "column", gap: 2 }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Chip
          label={statusLabel(t, task.status as TaskStatus)}
          size="small"
          color={task.status === "doing" ? "warning" : "default"}
        />
        <Box>
          <IconButton size="small" onClick={handleDelete} title={t.delete} sx={confirmDelete ? { color: "error.main" } : { opacity: 0.4, "&:hover": { opacity: 1 } }}>
            <DeleteOutlineIcon fontSize="small" />
          </IconButton>
          <IconButton size="small" onClick={closeDetail}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
      </Box>

      <TextField
        fullWidth
        variant="standard"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => {
          if (title.trim() && title !== task.title) save("title", title.trim());
        }}
        InputProps={{ sx: { fontSize: 16, fontWeight: 600 } }}
      />

      <FormControl size="small" fullWidth>
        <InputLabel sx={{ fontSize: 13 }}>{t.project}</InputLabel>
        <Select
          value={task.project_id ?? ""}
          label={t.project}
          onChange={(e) => save("project_id", e.target.value)}
          sx={{ fontSize: 13 }}
        >
          <MenuItem value="">
            <em>{t.none}</em>
          </MenuItem>
          {projects.map((p) => (
            <MenuItem key={p.id} value={p.id} sx={{ fontSize: 13 }}>
              {p.name}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <Box>
        <Typography variant="caption" color="text.secondary">
          {t.priority}
        </Typography>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={task.priority}
          onChange={(_e, val) => save("priority", val)}
          sx={{ display: "flex", mt: 0.5 }}
        >
          {PRIORITIES.map((p) => (
            <ToggleButton key={p} value={p} sx={{ flex: 1, fontSize: 11, py: 0.5 }}>
              {priorityLabel(t, p)}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Box>

      <Autocomplete
        freeSolo
        size="small"
        options={[...new Set(["30м", "1ч", "2ч", "4ч", "1д", "2д", "3д", "1н", "2н", ...estimateOptions])]}
        value={timeEstimate}
        onInputChange={(_e, val) => setTimeEstimate(val)}
        onBlur={() => {
          const val = timeEstimate.trim();
          if (val !== (task.time_estimate ?? "")) {
            save("time_estimate", val);
            if (val && !estimateOptions.includes(val)) {
              setEstimateOptions((prev) => [...new Set([...prev, val])]);
            }
          }
        }}
        renderInput={(params) => (
          <TextField
            {...params}
            label={t.estimate}
            sx={{ "& .MuiInputBase-input": { fontSize: 13 } }}
          />
        )}
      />

      <TextField
        fullWidth
        size="small"
        label={t.dueDate}
        type="date"
        value={due}
        onChange={(e) => setDue(e.target.value)}
        onBlur={() => save("due", due)}
        InputLabelProps={{ shrink: true }}
        sx={{ "& .MuiInputBase-input": { fontSize: 13 } }}
      />

      <Autocomplete
        freeSolo
        size="small"
        options={promisedToOptions}
        value={promisedTo}
        onInputChange={(_e, val) => setPromisedTo(val)}
        onBlur={() => {
          const val = promisedTo.trim();
          if (val !== (task.promised_to ?? "")) {
            save("promised_to", val || null);
            if (val && !promisedToOptions.includes(val)) {
              setPromisedToOptions((prev) => [val, ...prev]);
            }
          }
        }}
        renderInput={(params) => (
          <TextField
            {...params}
            label={t.promisedTo}
            sx={{ "& .MuiInputBase-input": { fontSize: 13 } }}
          />
        )}
      />

      <Divider />

      <AiTextField
        label={t.definitionOfDone}
        fieldName="dod"
        value={dod}
        onChange={setDod}
        onBlur={() => save("dod", dod)}
        multiline
        rows={2}
        suggestion={suggestion}
        loading={aiLoading}
        activeField={activeField}
        onKeyDown={aiKeyDown}
        onChangeAi={aiChange}
      />

      <Box>
        <Typography variant="caption" color="text.secondary">
          {t.steps}
          {checklist.length > 0 && (
            <Typography component="span" variant="caption" color="text.secondary">
              {" "}({checklist.filter((i) => i.done).length}/{checklist.length})
            </Typography>
          )}
        </Typography>
        {checklist.length > 0 && (() => {
          const nextIdx = checklist.findIndex((i) => !i.done);
          return (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, mt: 0.5 }}>
              {checklist.map((item, i) => {
                const isNext = i === nextIdx;
                return (
                  <Box
                    key={i}
                    onClick={() => toggleStep(i)}
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 1,
                      py: 0.75,
                      px: 1,
                      borderRadius: 1,
                      cursor: "pointer",
                      "&:hover .step-delete": { opacity: 0.5 },
                      ...(isNext && { bgcolor: "rgba(46,125,111,0.10)" }),
                    }}
                  >
                    {item.done
                      ? <CheckBoxIcon sx={{ fontSize: 18, flexShrink: 0, color: "primary.main" }} />
                      : <CheckBoxOutlineBlankIcon sx={{ fontSize: 18, flexShrink: 0, opacity: 0.5 }} />
                    }
                    <Typography
                      sx={{
                        flex: 1,
                        fontSize: 13,
                        lineHeight: 1.5,
                        ...(isNext && { fontWeight: 600 }),
                        ...(item.done && { textDecoration: "line-through", opacity: 0.4 }),
                      }}
                    >
                      {item.text}
                    </Typography>
                    <CloseIcon
                      className="step-delete"
                      onClick={(e) => { e.stopPropagation(); removeStep(i); }}
                      sx={{ fontSize: 14, flexShrink: 0, opacity: 0, cursor: "pointer" }}
                    />
                  </Box>
                );
              })}
            </Box>
          );
        })()}
        <Box sx={{ mt: 1, position: "relative" }}>
          <TextField
            fullWidth
            size="small"
            label={checklist.length === 0 ? t.firstStep : undefined}
            placeholder={checklist.length > 0 ? t.addStep : undefined}
            value={newStep}
            onChange={(e) => {
              setNewStep(e.target.value);
              aiChange("next_step", e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); addStep(); return; }
              aiKeyDown(e, "next_step", newStep, setNewStep);
            }}
            sx={{ "& .MuiInputBase-input": { fontSize: 13 } }}
          />
          {aiLoading && activeField === "next_step" && (
            <CircularProgress size={14} sx={{ position: "absolute", right: 12, top: 12 }} />
          )}
        </Box>
        {activeField === "next_step" && suggestion && (
          <Box
            sx={{
              mt: 0.5,
              p: 1,
              bgcolor: "rgba(46,125,111,0.1)",
              border: "1px solid rgba(46,125,111,0.3)",
              borderRadius: 1,
              fontSize: 12,
              color: "text.secondary",
              cursor: "pointer",
            }}
            onClick={() => setNewStep(suggestion)}
          >
            <Typography variant="caption" sx={{ opacity: 0.6, display: "block", mb: 0.25 }}>
              Tab ↹
            </Typography>
            {suggestion}
          </Box>
        )}
      </Box>

      {task.return_ref && (
        <>
          <Divider />
          <Box>
            <Typography variant="caption" color="text.secondary">
              {t.returnContext}
            </Typography>
            <Typography variant="body2" sx={{ fontSize: 12, mt: 0.5 }}>
              {(() => {
                try {
                  const ctx = JSON.parse(task.return_ref);
                  return `${ctx.app || "?"} — ${ctx.window_title || ""}`;
                } catch {
                  return task.return_ref;
                }
              })()}
            </Typography>
          </Box>
        </>
      )}
    </Box>
  );
}

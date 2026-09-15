import { Fragment, useEffect, useState, useCallback, useRef } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
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
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import Inventory2OutlinedIcon from "@mui/icons-material/Inventory2Outlined";
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
import * as api from "@/utils/tauri";
import { appLog } from "@/stores/logStore";
import { useTaskFieldStore } from "@/stores/taskFieldStore";
import CustomFieldEditor from "@/components/task/fields/CustomFieldEditor";
import { useAiFillStore } from "@/stores/aiFillStore";
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

function SortableStep({ id, item, index, isNext, onToggle, onRemove, onEditText }: {
  id: string;
  item: ChecklistItem;
  index: number;
  isNext: boolean;
  onToggle: (i: number) => void;
  onRemove: (i: number) => void;
  onEditText: (i: number, text: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(item.text);
  const inputRef = useRef<HTMLInputElement>(null);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? undefined : transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const commitEdit = () => {
    setEditing(false);
    if (editText.trim() && editText.trim() !== item.text) {
      onEditText(index, editText.trim());
    } else {
      setEditText(item.text);
    }
  };

  return (
    <Box
      ref={setNodeRef}
      style={style}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.5,
        py: 0.5,
        px: 0.5,
        borderRadius: 1,
        "&:hover .step-actions": { opacity: 0.5 },
        ...(isNext && { bgcolor: "rgba(46,125,111,0.10)" }),
      }}
    >
      <Box {...attributes} {...listeners} sx={{ cursor: "grab", display: "flex", opacity: 0.2, "&:hover": { opacity: 0.5 }, flexShrink: 0 }}>
        <DragIndicatorIcon sx={{ fontSize: 16 }} />
      </Box>
      <Box onClick={() => onToggle(index)} sx={{ cursor: "pointer", flexShrink: 0, display: "flex" }}>
        {item.done
          ? <CheckBoxIcon sx={{ fontSize: 18, color: "primary.main" }} />
          : <CheckBoxOutlineBlankIcon sx={{ fontSize: 18, opacity: 0.5 }} />
        }
      </Box>
      {editing ? (
        <TextField
          inputRef={inputRef}
          autoFocus
          fullWidth
          size="small"
          variant="standard"
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitEdit();
            if (e.key === "Escape") { setEditText(item.text); setEditing(false); }
          }}
          InputProps={{ sx: { fontSize: 13 } }}
        />
      ) : (
        <Typography
          onDoubleClick={() => { setEditing(true); setEditText(item.text); }}
          sx={{
            flex: 1,
            fontSize: 13,
            lineHeight: 1.5,
            cursor: "default",
            ...(isNext && { fontWeight: 600 }),
            ...(item.done && { textDecoration: "line-through", opacity: 0.4 }),
          }}
        >
          {item.text}
        </Typography>
      )}
      <CloseIcon
        className="step-actions"
        onClick={(e) => { e.stopPropagation(); onRemove(index); }}
        sx={{ fontSize: 14, flexShrink: 0, opacity: 0, cursor: "pointer" }}
      />
    </Box>
  );
}

function ChecklistSortable({ items, onReorder, onToggle, onRemove, onEditText }: {
  items: ChecklistItem[];
  onReorder: (items: ChecklistItem[]) => void;
  onToggle: (i: number) => void;
  onRemove: (i: number) => void;
  onEditText: (i: number, text: string) => void;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  // Use text hash as stable ID so reorder doesn't confuse DnD
  const ids = items.map((item, i) => `${i}-${item.text.slice(0, 20)}`);
  const nextIdx = items.findIndex((i) => !i.done);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = ids.indexOf(active.id as string);
    const newIndex = ids.indexOf(over.id as string);
    if (oldIndex !== -1 && newIndex !== -1) {
      onReorder(arrayMove(items, oldIndex, newIndex));
    }
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25, mt: 0.5 }}>
          {items.map((item, i) => (
            <SortableStep
              key={ids[i]}
              id={ids[i]}
              item={item}
              index={i}
              isNext={i === nextIdx}
              onToggle={onToggle}
              onRemove={onRemove}
              onEditText={onEditText}
            />
          ))}
        </Box>
      </SortableContext>
    </DndContext>
  );
}

export default function TaskDetailPanel() {
  const fields = useTaskFieldStore((s) => s.fields);
  const loadFields = useTaskFieldStore((s) => s.load);
  const fieldsLoaded = useTaskFieldStore((s) => s.loaded);
  // What this task holds in fields the user added, keyed by field id.
  const [customValues, setCustomValues] = useState<Record<string, unknown>>({});

  const { selectedTaskId, closeDetail } = useUiStore();
  const { update, findTask } = useTaskStore();
  const { projects } = useProjectStore();
  const { refresh } = useHistoryStore();
  const { t, locale } = useI18n();

  const task = findTask(selectedTaskId);

  const [title, setTitle] = useState("");
  const [dod, setDod] = useState("");
  const [due, setDue] = useState("");
  const [timeEstimate, setTimeEstimate] = useState("");
  const [promisedTo, setPromisedTo] = useState("");
  const [comment, setComment] = useState("");
  const [trackerUrl, setTrackerUrl] = useState("");
  const [promisedToOptions, setPromisedToOptions] = useState<string[]>([]);
  const [estimateOptions, setEstimateOptions] = useState<string[]>([]);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [newStep, setNewStep] = useState("");

  // Whether the assistant is working on *this* task. A fill outlives the panel
  // it started from, so the flag has to be keyed by task: switching to another
  // task must not show its spinner or freeze its fields.
  const startAiFill = useAiFillStore((s) => s.fill);
  const aiFilling = useAiFillStore(
    (s) => !!selectedTaskId && s.filling.includes(selectedTaskId),
  );

  const handleAiFill = () => {
    if (!selectedTaskId) return;
    void startAiFill(selectedTaskId);
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
      setComment(task.comment ?? "");
      setTrackerUrl(task.tracker_url ?? "");
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

  // The list of fields is the same for every task, so it is fetched once.
  useEffect(() => {
    if (!fieldsLoaded) void loadFields().catch(() => {});
  }, [fieldsLoaded, loadFields]);

  // What this task holds in them is not: it comes with the task.
  useEffect(() => {
    if (!selectedTaskId) return;
    let cancelled = false;
    api
      .taskFieldValues(selectedTaskId)
      .then((values) => {
        if (!cancelled) setCustomValues(values);
      })
      .catch(() => {
        if (!cancelled) setCustomValues({});
      });
    return () => {
      cancelled = true;
    };
  }, [selectedTaskId]);

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

  /**
   * A built-in field, drawn by its own editor.
   *
   * The registry decides whether a field appears and where; it does not decide
   * how it looks. Priority is still a row of buttons, the due date is still
   * chips, the checklist is still the checklist — nothing turned into a generic
   * text box for the sake of being configurable.
   */
  const builtinField = (key: string) => {
    switch (key) {
      case "project_id":
        return (
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
        );
      case "priority":
        return (
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
        );
      case "energy":
        return (
          <Box>
          <Typography variant="caption" color="text.secondary">
            {t.energy}
          </Typography>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mt: 0.5 }}>
            <Typography sx={{ fontSize: 14, lineHeight: 1 }}>😴</Typography>
            <Box sx={{ display: "flex", flex: 1, height: 24, borderRadius: 1, overflow: "hidden", cursor: "pointer" }}>
              {(["low", "medium", "high"] as const).map((level, i) => {
                const colors = ["#5b7fa6", "#6da87a", "#d4a843"];
                const selected = task.energy === level;
                return (
                  <Box
                    key={level}
                    onClick={() => save("energy", task.energy === level ? null : level)}
                    sx={{
                      flex: 1,
                      bgcolor: colors[i],
                      opacity: selected ? 1 : task.energy ? 0.2 : 0.4,
                      transition: "opacity 0.15s",
                      "&:hover": { opacity: selected ? 1 : 0.6 },
                    }}
                  />
                );
              })}
            </Box>
            <Typography sx={{ fontSize: 14, lineHeight: 1 }}>⚡</Typography>
          </Box>
        </Box>
        );
      case "time_estimate":
        return (
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
        );
      case "due":
        return (
          <Box>
          <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: "block" }}>
            {t.dueDate}
          </Typography>
          <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap", alignItems: "center" }}>
            {[
              { label: locale === "ru" ? "Сегодня" : "Today", days: 0 },
              { label: locale === "ru" ? "Завтра" : "Tomorrow", days: 1 },
              { label: locale === "ru" ? "+3д" : "+3d", days: 3 },
              { label: locale === "ru" ? "+1н" : "+1w", days: 7 },
            ].map(({ label, days }) => {
              const d = new Date();
              d.setDate(d.getDate() + days);
              const val = d.toISOString().slice(0, 10);
              return (
                <Typography
                  key={days}
                  onClick={() => { setDue(val); save("due", val); }}
                  sx={{
                    fontSize: 11, px: 1, py: 0.4, borderRadius: 1, cursor: "pointer",
                    bgcolor: due === val ? "primary.main" : "var(--overlay-2)",
                    color: due === val ? "white" : "text.secondary",
                    "&:hover": { bgcolor: due === val ? "primary.main" : "var(--overlay-3)" },
                  }}
                >
                  {label}
                </Typography>
              );
            })}
            <Box component="label" sx={{
              fontSize: 11, px: 1, py: 0.4, borderRadius: 1, cursor: "pointer",
              bgcolor: due && ![0,1,3,7].some(days => { const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString().slice(0,10) === due; }) ? "primary.main" : "var(--overlay-2)",
              color: due && ![0,1,3,7].some(days => { const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString().slice(0,10) === due; }) ? "white" : "text.secondary",
              "&:hover": { bgcolor: "var(--overlay-3)" },
              position: "relative",
            }}>
              {due && ![0,1,3,7].some(days => { const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString().slice(0,10) === due; }) ? due : "📅"}
              <input
                type="date"
                value={due}
                onChange={(e) => { setDue(e.target.value); save("due", e.target.value); }}
                style={{ position: "absolute", opacity: 0, width: 0, height: 0, overflow: "hidden" }}
              />
            </Box>
            {due && (
              <Typography
                onClick={() => { setDue(""); save("due", ""); }}
                sx={{ fontSize: 11, px: 0.5, cursor: "pointer", color: "text.secondary", opacity: 0.4, "&:hover": { opacity: 1 } }}
              >
                ✕
              </Typography>
            )}
          </Box>
        </Box>
        );
      case "promised_to":
        return (
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
        );
      case "dod":
        return (
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
        );
      case "checklist":
        return (
          <Box>
          <Typography variant="caption" color="text.secondary">
            {t.steps}
            {checklist.length > 0 && (
              <Typography component="span" variant="caption" color="text.secondary">
                {" "}({checklist.filter((i) => i.done).length}/{checklist.length})
              </Typography>
            )}
          </Typography>
          {checklist.length > 0 && (
            <ChecklistSortable
              items={checklist}
              onReorder={(items) => saveChecklist(items)}
              onToggle={toggleStep}
              onRemove={removeStep}
              onEditText={(index, text) => {
                const updated = checklist.map((item, i) => i === index ? { ...item, text } : item);
                saveChecklist(updated);
              }}
            />
          )}
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
        );
      case "tracker_url":
        return (
          <Box sx={{ display: "flex", gap: 0.5, alignItems: "center" }}>
          <TextField
            fullWidth
            size="small"
            label={t.trackerUrl}
            placeholder={t.issueUrlPlaceholder}
            value={trackerUrl}
            onChange={(e) => setTrackerUrl(e.target.value)}
            onBlur={() => save("tracker_url", trackerUrl || null)}
            sx={{ "& .MuiInputBase-input": { fontSize: 13 } }}
            InputLabelProps={{ sx: { fontSize: 13 } }}
          />
          {trackerUrl && (
            <IconButton size="small" onClick={async () => {
              const url = trackerUrl.startsWith("http") ? trackerUrl : `https://${trackerUrl}`;
              try {
                const { open } = await import("@tauri-apps/plugin-shell");
                await open(url);
              } catch {
                window.open(url, "_blank");
              }
            }} sx={{ flexShrink: 0, opacity: 0.5 }}>
              <span style={{ fontSize: 14 }}>↗</span>
            </IconButton>
          )}
        </Box>
        );
      case "comment":
        return (
          <TextField
          fullWidth
          size="small"
          label={t.comment}
          multiline
          minRows={3}
          maxRows={20}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          onBlur={() => save("comment", comment || null)}
          sx={{ "& .MuiInputBase-input": { fontSize: 13 } }}
          InputLabelProps={{ sx: { fontSize: 13 } }}
        />
        );
      default:
        return null;
    }
  };

  const orderedFields = fields.filter((field) => field.enabled);

  /**
   * A value the user typed into a field of their own.
   *
   * Written through at once and kept on screen optimistically: these are
   * ordinary edits, and waiting for a round trip to see your own text is how an
   * app feels slow.
   */
  const saveCustomValue = async (fieldId: string, value: unknown) => {
    if (!task) return;
    setCustomValues((current) => ({ ...current, [fieldId]: value }));
    try {
      await api.setTaskFieldValue(task.id, fieldId, value ?? null);
    } catch (e) {
      appLog.error(`[task-fields] ${String(e)}`);
      // Put back whatever the database actually has.
      await api.taskFieldValues(task.id).then(setCustomValues).catch(() => {});
    }
  };

  return (
    <Box sx={{ p: 2, display: "flex", flexDirection: "column", gap: 2 }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Box sx={{ display: "flex", gap: 0.5, alignItems: "center" }}>
          <Chip
            label={statusLabel(t, task.status as TaskStatus)}
            size="small"
            variant="outlined"
            color={task.status === "doing" ? "warning" : task.status === "done" ? "success" : "default"}
          />
          {task.archived_at && (
            <Chip
              icon={<Inventory2OutlinedIcon sx={{ fontSize: 12 }} />}
              label={t.archive}
              size="small"
              variant="outlined"
              sx={{ opacity: 0.6 }}
            />
          )}
        </Box>
        <Box>
          <IconButton
            size="small"
            onClick={handleAiFill}
            disabled={aiFilling}
            title={aiFilling ? t.aiFilling : t.aiFillHint}
            sx={{ color: "#F2A900", "&:hover": { color: "#FFD54F" } }}
          >
            {aiFilling ? (
              <CircularProgress size={16} sx={{ color: "#F2A900" }} />
            ) : (
              <AutoAwesomeIcon fontSize="small" />
            )}
          </IconButton>
          <IconButton size="small" onClick={closeDetail}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
      </Box>

      {/* Everything the assistant may rewrite. While it works, the whole form is
          inert: `disabled` on the fieldset stops the keyboard, `pointerEvents`
          stops the mouse on MUI's div-based controls (Select, date picker), and
          the header above stays live so the panel can still be closed. */}
      <Box
        component="fieldset"
        disabled={aiFilling}
        aria-busy={aiFilling}
        sx={{
          border: 0,
          p: 0,
          m: 0,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          gap: 2,
          opacity: aiFilling ? 0.45 : 1,
          pointerEvents: aiFilling ? "none" : undefined,
          transition: "opacity 0.15s",
        }}
      >

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

        {orderedFields.map((field) => (
          <Fragment key={field.id}>
            {field.builtin ? (
              builtinField(field.key)
            ) : (
              <CustomFieldEditor
                field={field}
                value={customValues[field.id]}
                onChange={(value) => saveCustomValue(field.id, value)}
              />
            )}
          </Fragment>
        ))}

        {task.return_ref && (() => {
          try {
            const ctx = JSON.parse(task.return_ref);
            const app = ctx.app || "";
            const title = ctx.window_title || "";
            // Hide if useless (captured self or empty)
            if (!app || app.toLowerCase() === "wipster" || (!app && !title)) return null;
            return (
              <>
                <Divider />
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    {t.returnContext}
                  </Typography>
                  <Typography variant="body2" sx={{ fontSize: 12, mt: 0.5 }}>
                    {app}{title ? ` — ${title}` : ""}
                  </Typography>
                </Box>
              </>
            );
          } catch {
            return null;
          }
        })()}

      </Box>

    </Box>
  );
}

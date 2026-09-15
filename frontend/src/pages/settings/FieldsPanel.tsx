import { useEffect, useState } from "react";
import {
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import AddIcon from "@mui/icons-material/Add";
import UndoIcon from "@mui/icons-material/Undo";
import VerticalSplitOutlinedIcon from "@mui/icons-material/VerticalSplitOutlined";
import NotesOutlinedIcon from "@mui/icons-material/NotesOutlined";
import { useI18n } from "@/i18n";
import { useTaskFieldStore } from "@/stores/taskFieldStore";
import { fieldLabel, kindLabel } from "@/utils/taskFields";
import { columnOf } from "@/utils/fieldColumns";
import type { FieldKind, TaskField } from "@/utils/tauri";
import SettingsGroup from "./SettingsGroup";

/** The types a custom field can have, in the order the picker offers them. */
const KINDS: FieldKind[] = [
  "text",
  "long_text",
  "markdown",
  "number",
  "date",
  "checkbox",
  "select",
  "url",
  "url_list",
  "file_list",
  "text_list",
];

function FieldRow({ field, onRemove }: { field: TaskField; onRemove: (field: TaskField) => void }) {
  const { t } = useI18n();
  const update = useTaskFieldStore((s) => s.update);
  const [name, setName] = useState(field.label ?? "");

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: field.id,
  });
  const column = columnOf(field);

  return (
    <Box
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1,
        py: 0.5,
        px: 0.5,
        borderRadius: 1,
        opacity: isDragging ? 0.4 : field.enabled ? 1 : 0.55,
        bgcolor: isDragging ? "var(--overlay-2)" : "transparent",
        "&:hover": { bgcolor: "var(--overlay-1)" },
        "&:hover .row-actions": { opacity: 1 },
      }}
    >
      <Box
        {...attributes}
        {...listeners}
        sx={{ display: "flex", cursor: "grab", opacity: 0.35, "&:active": { cursor: "grabbing" } }}
      >
        <DragIndicatorIcon sx={{ fontSize: 16 }} />
      </Box>

      <Checkbox
        size="small"
        checked={field.enabled}
        onChange={(e) => update(field.id, { enabled: e.target.checked })}
        sx={{ p: 0.25 }}
      />

      {field.builtin ? (
        <Typography sx={{ fontSize: 13, flex: 1 }}>{fieldLabel(field, t)}</Typography>
      ) : (
        <TextField
          variant="standard"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            const next = name.trim();
            if (next && next !== field.label) update(field.id, { label: next });
            else setName(field.label ?? "");
          }}
          InputProps={{ disableUnderline: true, sx: { fontSize: 13 } }}
          sx={{ flex: 1 }}
        />
      )}

      {/* Which column it sits in when a task fills the window. The type decides
          until the user decides otherwise, and this is where they do. */}
      <Tooltip title={column === "side" ? t.moveFieldToMain : t.moveFieldToSide}>
        <IconButton
          size="small"
          onClick={() => update(field.id, { columnSide: column === "side" ? "main" : "side" })}
          sx={{ opacity: 0.55, "&:hover": { opacity: 1 } }}
        >
          {column === "side" ? (
            <VerticalSplitOutlinedIcon sx={{ fontSize: 15 }} />
          ) : (
            <NotesOutlinedIcon sx={{ fontSize: 15 }} />
          )}
        </IconButton>
      </Tooltip>

      <Chip
        label={kindLabel(field.kind, t)}
        size="small"
        variant="outlined"
        sx={{ height: 20, fontSize: 10 }}
      />
      {field.builtin && (
        <Chip label={t.builtinField} size="small" sx={{ height: 20, fontSize: 10, opacity: 0.6 }} />
      )}

      <Box className="row-actions" sx={{ opacity: 0, transition: "opacity 0.15s", width: 28 }}>
        {!field.builtin && (
          <Tooltip title={t.delete}>
            <IconButton size="small" onClick={() => onRemove(field)} sx={{ opacity: 0.6 }}>
              <DeleteOutlineIcon sx={{ fontSize: 15 }} />
            </IconButton>
          </Tooltip>
        )}
      </Box>
    </Box>
  );
}

function AddField({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const create = useTaskFieldStore((s) => s.create);
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<FieldKind>("text");
  const [options, setOptions] = useState("");

  const ready = label.trim().length > 0 && (kind !== "select" || options.trim().length > 0);

  const submit = async () => {
    if (!ready) return;
    await create(
      label.trim(),
      kind,
      options
        .split("\n")
        .map((o) => o.trim())
        .filter(Boolean),
    );
    onDone();
  };

  return (
    <SettingsGroup title={t.addField}>
      <TextField
        autoFocus
        fullWidth
        size="small"
        label={t.fieldName}
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && kind !== "select") void submit();
          if (e.key === "Escape") onDone();
        }}
        InputProps={{ sx: { fontSize: 13 } }}
        InputLabelProps={{ sx: { fontSize: 13 } }}
      />

      <TextField
        select
        fullWidth
        size="small"
        label={t.fieldType}
        value={kind}
        onChange={(e) => setKind(e.target.value as FieldKind)}
        InputProps={{ sx: { fontSize: 13 } }}
        InputLabelProps={{ sx: { fontSize: 13 } }}
      >
        {KINDS.map((k) => (
          <MenuItem key={k} value={k} sx={{ fontSize: 13 }}>
            {kindLabel(k, t)}
          </MenuItem>
        ))}
      </TextField>

      {kind === "select" && (
        <TextField
          fullWidth
          size="small"
          multiline
          minRows={3}
          label={t.fieldOptions}
          helperText={t.fieldOptionsHint}
          value={options}
          onChange={(e) => setOptions(e.target.value)}
          InputProps={{ sx: { fontSize: 13 } }}
          InputLabelProps={{ sx: { fontSize: 13 } }}
          FormHelperTextProps={{ sx: { fontSize: 11 } }}
        />
      )}

      <Box sx={{ display: "flex", gap: 1 }}>
        <Button size="small" variant="contained" disabled={!ready} onClick={submit} sx={{ px: 2 }}>
          {t.addField}
        </Button>
        <Button size="small" onClick={onDone}>
          {t.cancel}
        </Button>
      </Box>
    </SettingsGroup>
  );
}

/**
 * Which fields a task has.
 *
 * A checkbox decides whether a field shows, dragging decides where, and a
 * custom one can be anything from a number to a list of files. Nothing here
 * deletes what was typed: switching a field off hides it, and removing a custom
 * one keeps its values for the day it comes back.
 */
export default function FieldsPanel() {
  const { t } = useI18n();
  const { fields, removed, load, reorder, restore, remove } = useTaskFieldStore();
  const [adding, setAdding] = useState(false);
  // Removing a field is asked about in a dialog of the app's own, the way
  // deleting a project is — never in a browser's alert box.
  const [pendingRemoval, setPendingRemoval] = useState<TaskField | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  useEffect(() => {
    void load().catch(() => {});
  }, [load]);

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = fields.map((f) => f.id);
    const next = arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
    void reorder(next);
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2, maxWidth: 620 }}>
      <Typography variant="body2" color="text.secondary">
        {t.taskFieldsHint}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {t.taskFieldsColumnHint}
      </Typography>

      <SettingsGroup>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={fields.map((f) => f.id)} strategy={verticalListSortingStrategy}>
            <Box sx={{ display: "flex", flexDirection: "column" }}>
              {fields.map((field) => (
                <FieldRow key={field.id} field={field} onRemove={setPendingRemoval} />
              ))}
            </Box>
          </SortableContext>
        </DndContext>
      </SettingsGroup>

      {adding ? (
        <AddField onDone={() => setAdding(false)} />
      ) : (
        <Button
          size="small"
          variant="outlined"
          startIcon={<AddIcon sx={{ fontSize: 16 }} />}
          onClick={() => setAdding(true)}
          sx={{ alignSelf: "flex-start", px: 2 }}
        >
          {t.addField}
        </Button>
      )}

      <Dialog open={!!pendingRemoval} onClose={() => setPendingRemoval(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: 15 }}>
          {pendingRemoval ? fieldLabel(pendingRemoval, t) : ""}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            {pendingRemoval ? t.removeFieldConfirm(fieldLabel(pendingRemoval, t)) : ""}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button size="small" onClick={() => setPendingRemoval(null)}>
            {t.cancel}
          </Button>
          <Button
            size="small"
            color="error"
            variant="contained"
            onClick={() => {
              if (pendingRemoval) void remove(pendingRemoval.id);
              setPendingRemoval(null);
            }}
          >
            {t.delete}
          </Button>
        </DialogActions>
      </Dialog>

      {removed.length > 0 && (
        <SettingsGroup title={t.removedFields} caption={t.removedFieldsHint}>
          {removed.map((field) => (
            <Box key={field.id} sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <Typography sx={{ fontSize: 13, flex: 1 }}>{fieldLabel(field, t)}</Typography>
              <Chip
                label={kindLabel(field.kind, t)}
                size="small"
                variant="outlined"
                sx={{ height: 20, fontSize: 10 }}
              />
              <Button
                size="small"
                startIcon={<UndoIcon sx={{ fontSize: 14 }} />}
                onClick={() => restore(field.id)}
                sx={{ fontSize: 12 }}
              >
                {t.restoreField}
              </Button>
            </Box>
          ))}
        </SettingsGroup>
      )}
    </Box>
  );
}

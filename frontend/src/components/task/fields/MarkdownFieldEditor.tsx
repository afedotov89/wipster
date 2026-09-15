import { useEffect, useRef, useState } from "react";
import { Box, Button, IconButton, TextField, Tooltip, Typography } from "@mui/material";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import { useI18n } from "@/i18n";
import Markdown from "@/components/common/Markdown";

interface Props {
  value: string;
  onChange: (value: string | null) => void;
  /** The task fills the window: the writing area can be worth the room. */
  expanded?: boolean;
}

/**
 * Text with formatting: read as it will look, edited as it is written.
 *
 * Two modes rather than a live preview, because a live preview costs half the
 * width and a task is mostly read. Reading is the resting state; the pencil, a
 * double-click or an empty field's own invitation starts editing, ⌘↩ or moving
 * on ends it, and Escape leaves what was there alone.
 */
export default function MarkdownFieldEditor({ value, onChange, expanded }: Props) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => setDraft(value), [value]);

  const startEditing = () => {
    setDraft(value);
    setEditing(true);
    // After the field exists, with the caret where the writing stopped.
    setTimeout(() => {
      const element = area.current;
      if (!element) return;
      element.focus();
      element.setSelectionRange(element.value.length, element.value.length);
    }, 0);
  };

  const commit = () => {
    setEditing(false);
    if (draft !== value) onChange(draft.trim() ? draft : null);
  };

  if (editing) {
    return (
      <Box>
        <TextField
          inputRef={area}
          fullWidth
          size="small"
          multiline
          minRows={expanded ? 10 : 5}
          maxRows={40}
          value={draft}
          placeholder={t.markdownPlaceholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setDraft(value);
              setEditing(false);
            }
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              commit();
            }
          }}
          onBlur={commit}
          InputProps={{
            sx: {
              fontSize: 13,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              lineHeight: 1.55,
            },
          }}
        />
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 0.5 }}>
          <Button size="small" variant="outlined" onMouseDown={(e) => e.preventDefault()} onClick={commit} sx={{ fontSize: 12 }}>
            {t.done}
          </Button>
          <Typography variant="caption" color="text.secondary">
            {t.markdownHint}
          </Typography>
        </Box>
      </Box>
    );
  }

  return (
    <Box
      onDoubleClick={startEditing}
      sx={{
        position: "relative",
        px: 1.25,
        py: value.trim() ? 1 : 1.25,
        borderRadius: 1.5,
        bgcolor: "var(--overlay-1)",
        cursor: "text",
        "&:hover .edit-action": { opacity: 1 },
      }}
    >
      {value.trim() ? (
        <Markdown>{value}</Markdown>
      ) : (
        <Typography
          variant="body2"
          color="text.secondary"
          onClick={startEditing}
          sx={{ fontSize: 13, opacity: 0.7 }}
        >
          {t.markdownEmpty}
        </Typography>
      )}

      <Tooltip title={t.edit}>
        <IconButton
          className="edit-action"
          size="small"
          onClick={startEditing}
          sx={{
            position: "absolute",
            top: 4,
            right: 4,
            opacity: 0,
            transition: "opacity 0.15s",
            bgcolor: "var(--overlay-2)",
            "&:hover": { bgcolor: "var(--overlay-3)" },
          }}
        >
          <EditOutlinedIcon sx={{ fontSize: 14 }} />
        </IconButton>
      </Tooltip>
    </Box>
  );
}

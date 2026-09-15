import { useEffect, useState } from "react";
import {
  Box,
  IconButton,
  MenuItem,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
} from "@mui/material";
import LaunchIcon from "@mui/icons-material/Launch";
import type { TaskField } from "@/utils/tauri";
import { useI18n } from "@/i18n";
import { openTarget } from "@/utils/open";
import FieldFrame from "./FieldFrame";
import ListFieldEditor from "./ListFieldEditor";
import FileListEditor from "./FileListEditor";
import MarkdownFieldEditor from "./MarkdownFieldEditor";

const asText = (value: unknown) => (typeof value === "string" ? value : value == null ? "" : String(value));
const asList = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(asText).filter(Boolean) : asText(value) ? [asText(value)] : [];

interface Props {
  field: TaskField;
  value: unknown;
  /** The task fills the window: text has room to be read, not just stored. */
  expanded?: boolean;
  onChange: (value: unknown) => void;
}

/**
 * A field the user invented, edited the way its type deserves.
 *
 * Every type gets a real editor rather than a text box with a label: a date is
 * a date picker, a choice is a set of buttons, a list of files is a list of
 * files you can open. A generic "custom field" that is always a string is how
 * these features usually end, and it is why nobody uses them.
 */
export default function CustomFieldEditor({ field, value, expanded, onChange }: Props) {
  const { t } = useI18n();
  const label = field.label ?? field.key;

  // Text-ish editors keep a local draft so typing is not a round trip per key.
  const [draft, setDraft] = useState(asText(value));
  useEffect(() => setDraft(asText(value)), [value, field.id]);

  switch (field.kind) {
    case "markdown":
      return (
        <FieldFrame label={label}>
          <MarkdownFieldEditor
            value={asText(value)}
            expanded={expanded}
            onChange={(next) => onChange(next)}
          />
        </FieldFrame>
      );

    case "long_text":
      return (
        <FieldFrame label={label}>
          <TextField
            fullWidth
            size="small"
            multiline
            minRows={expanded ? 6 : 3}
            maxRows={expanded ? 30 : 16}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => draft !== asText(value) && onChange(draft)}
            sx={{ "& .MuiInputBase-input": { fontSize: 13 } }}
          />
        </FieldFrame>
      );

    case "number":
      return (
        <FieldFrame label={label}>
          <TextField
            size="small"
            value={draft}
            // No spinner arrows: they are a browser artefact, and this is an app.
            inputProps={{ inputMode: "decimal", style: { fontSize: 13 } }}
            onChange={(e) => setDraft(e.target.value.replace(/[^\d.,-]/g, ""))}
            onBlur={() => {
              const text = draft.trim().replace(",", ".");
              if (text === "") return onChange(null);
              const parsed = Number(text);
              if (!Number.isNaN(parsed)) onChange(parsed);
              else setDraft(asText(value));
            }}
            sx={{ width: 160 }}
          />
        </FieldFrame>
      );

    case "date":
      return (
        <FieldFrame label={label}>
          <TextField
            size="small"
            type="date"
            value={asText(value)}
            onChange={(e) => onChange(e.target.value || null)}
            inputProps={{ style: { fontSize: 13 } }}
            sx={{ width: 190 }}
          />
        </FieldFrame>
      );

    case "checkbox":
      return (
        <FieldFrame label={label}>
          <Switch
            size="small"
            checked={value === true}
            onChange={(e) => onChange(e.target.checked)}
          />
        </FieldFrame>
      );

    case "select": {
      const selected = asText(value);
      // Up to four choices fit as buttons, which is one click instead of two;
      // more than that becomes a menu rather than a wall.
      return (
        <FieldFrame label={label}>
          {field.options.length <= 4 ? (
            <ToggleButtonGroup
              exclusive
              size="small"
              value={selected || null}
              onChange={(_e, next) => onChange(next)}
              sx={{ display: "flex" }}
            >
              {field.options.map((option) => (
                <ToggleButton key={option} value={option} sx={{ flex: 1, fontSize: 11, py: 0.5 }}>
                  {option}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          ) : (
            <TextField
              select
              fullWidth
              size="small"
              value={selected}
              onChange={(e) => onChange(e.target.value || null)}
              sx={{ "& .MuiInputBase-input": { fontSize: 13 } }}
            >
              <MenuItem value="" sx={{ fontSize: 13 }}>
                <em>{t.none}</em>
              </MenuItem>
              {field.options.map((option) => (
                <MenuItem key={option} value={option} sx={{ fontSize: 13 }}>
                  {option}
                </MenuItem>
              ))}
            </TextField>
          )}
        </FieldFrame>
      );
    }

    case "url":
      return (
        <FieldFrame label={label}>
          <Box sx={{ display: "flex", gap: 0.5, alignItems: "center" }}>
            <TextField
              fullWidth
              size="small"
              value={draft}
              placeholder="https://"
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => draft !== asText(value) && onChange(draft || null)}
              sx={{ "& .MuiInputBase-input": { fontSize: 13 } }}
            />
            {draft && (
              <Tooltip title={t.openLink}>
                <IconButton
                  size="small"
                  sx={{ flexShrink: 0, opacity: 0.5 }}
                  onClick={() => void openTarget(draft)}
                >
                  <LaunchIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Tooltip>
            )}
          </Box>
        </FieldFrame>
      );

    case "url_list":
      return (
        <FieldFrame label={label}>
          <ListFieldEditor
            items={asList(value)}
            onChange={onChange}
            links
            placeholder={t.addLink}
          />
        </FieldFrame>
      );

    case "text_list":
      return (
        <FieldFrame label={label}>
          <ListFieldEditor items={asList(value)} onChange={onChange} placeholder={t.addLine} />
        </FieldFrame>
      );

    case "file_list":
      return (
        <FieldFrame label={label}>
          <FileListEditor id={field.id} paths={asList(value)} onChange={onChange} />
        </FieldFrame>
      );

    default:
      return (
        <FieldFrame label={label}>
          <TextField
            fullWidth
            size="small"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => draft !== asText(value) && onChange(draft || null)}
            sx={{ "& .MuiInputBase-input": { fontSize: 13 } }}
          />
        </FieldFrame>
      );
  }
}

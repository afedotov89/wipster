import { useUiStore } from "@/stores/uiStore";
import { useValueDraft } from "@/hooks/useValueDraft";
import {
  Box,
  Alert,
  Button,
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
  onChange: (value: unknown, expected: unknown) => Promise<{ applied: boolean; value: unknown }>;
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

  const selectedTaskId = useUiStore(s=>s.selectedTaskId);
  const buffer = useValueDraft(value, onChange, selectedTaskId+":custom:"+field.id);
  const draft = asText(buffer.value);
  const setDraft = buffer.change;
  const send = (next: unknown) => { buffer.change(next); void buffer.commit(next); };
  const renderEditor = () => {
    switch (field.kind) {
      case "markdown":
        return (
          <FieldFrame label={label}>
            <MarkdownFieldEditor
              value={asText(buffer.value)}
              expanded={expanded}
              onChange={send}
              onDraftChange={buffer.change}
              onCancel={buffer.discard}
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
              onBlur={() => void buffer.commit(draft)}
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
                if (text === "") return send(null);
                const parsed = Number(text);
                if (!Number.isNaN(parsed)) send(parsed);
                else buffer.discard();
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
              value={asText(buffer.value)}
              onChange={(e) => send(e.target.value || null)}
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
              checked={buffer.value === true}
              onChange={(e) => send(e.target.checked)}
            />
          </FieldFrame>
        );

      case "select": {
        const selected = asText(buffer.value);
        // Up to four choices fit as buttons, which is one click instead of two;
        // more than that becomes a menu rather than a wall.
        return (
          <FieldFrame label={label}>
            {field.options.length <= 4 ? (
              <ToggleButtonGroup
                exclusive
                size="small"
                value={selected || null}
                onChange={(_e, next) => send(next)}
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
                onChange={(e) => send(e.target.value || null)}
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
                onBlur={() => void buffer.commit(draft || null)}
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
              items={asList(buffer.value)}
              onChange={send}
              links
              placeholder={t.addLink}
            />
          </FieldFrame>
        );

      case "text_list":
        return (
          <FieldFrame label={label}>
            <ListFieldEditor items={asList(buffer.value)} onChange={send} placeholder={t.addLine} />
          </FieldFrame>
        );

      case "file_list":
        return (
          <FieldFrame label={label}>
            <FileListEditor id={field.id} paths={asList(buffer.value)} onChange={send} />
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
              onBlur={() => void buffer.commit(draft || null)}
              sx={{ "& .MuiInputBase-input": { fontSize: 13 } }}
            />
          </FieldFrame>
        );
    }
  };
  return <Box>
    {buffer.conflict && <Alert severity="warning">
      {field.label ?? field.key}: {t.draftConflict} — {String(value ?? '').slice(0, 180)}
      <Button onMouseDown={e => e.preventDefault()} onClick={buffer.discard}>{t.draftUseUpdated}</Button>
      <Button onMouseDown={e => e.preventDefault()} onClick={() => void buffer.commit(buffer.value, true)}>{t.draftKeepMine}</Button>
    </Alert>}
    {renderEditor()}
  </Box>;

}

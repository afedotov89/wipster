import { useState } from "react";
import { Box, IconButton, TextField, Tooltip } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import LaunchIcon from "@mui/icons-material/Launch";
import { useI18n } from "@/i18n";
import { openTarget } from "@/utils/open";

interface Props {
  items: string[];
  onChange: (items: string[]) => void;
  /** Links get an open button and a different placeholder. */
  links?: boolean;
  placeholder: string;
}

/**
 * A list of lines — links, or just text.
 *
 * Adding is typing and pressing Enter, and pasting several lines adds several
 * rows rather than one long one, because that is how a list of links arrives:
 * copied in a block from somewhere else.
 */
export default function ListFieldEditor({ items, onChange, links, placeholder }: Props) {
  const { t } = useI18n();
  const [draft, setDraft] = useState("");

  const add = (text: string) => {
    const lines = text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0) return;
    onChange([...items, ...lines]);
    setDraft("");
  };

  const editAt = (index: number, text: string) =>
    onChange(items.map((item, i) => (i === index ? text : item)));

  const removeAt = (index: number) => onChange(items.filter((_, i) => i !== index));

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
      {items.map((item, index) => (
        <Box
          key={index}
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0.25,
            "&:hover .row-actions": { opacity: 1 },
          }}
        >
          <TextField
            fullWidth
            size="small"
            value={item}
            onChange={(e) => editAt(index, e.target.value)}
            onBlur={() => {
              if (!item.trim()) removeAt(index);
            }}
            sx={{ "& .MuiInputBase-input": { fontSize: 13 } }}
          />
          <Box className="row-actions" sx={{ display: "flex", opacity: 0, transition: "opacity 0.15s" }}>
            {links && (
              <Tooltip title={t.openLink}>
                <IconButton size="small" onClick={() => void openTarget(item)} sx={{ opacity: 0.6 }}>
                  <LaunchIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Tooltip>
            )}
            <Tooltip title={t.remove}>
              <IconButton size="small" onClick={() => removeAt(index)} sx={{ opacity: 0.6 }}>
                <CloseIcon sx={{ fontSize: 14 }} />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>
      ))}

      <TextField
        fullWidth
        size="small"
        placeholder={placeholder}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onPaste={(e) => {
          const text = e.clipboardData.getData("text");
          if (text.includes("\n")) {
            e.preventDefault();
            add(text);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add(draft);
          }
        }}
        onBlur={() => add(draft)}
        sx={{ "& .MuiInputBase-input": { fontSize: 13 } }}
      />
    </Box>
  );
}

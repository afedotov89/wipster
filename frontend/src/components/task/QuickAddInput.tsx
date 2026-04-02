import { useState, useRef, useEffect } from "react";
import { Box, TextField, InputAdornment } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import { useTaskStore } from "@/stores/taskStore";
import { useProjectStore } from "@/stores/projectStore";
import { useHistoryStore } from "@/stores/historyStore";
import { useI18n } from "@/i18n";

export default function QuickAddInput() {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const { add } = useTaskStore();
  const { selectedProjectId } = useProjectStore();
  const { refresh } = useHistoryStore();
  const { t } = useI18n();

  // Auto-focus when project changes
  useEffect(() => {
    if (selectedProjectId) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [selectedProjectId]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "n") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const handleSubmit = async () => {
    const title = value.trim();
    if (!title) return;

    await add(title, selectedProjectId ?? undefined);
    setValue("");
    await refresh();
  };

  return (
    <Box sx={{ px: 2, py: 1 }}>
      <TextField
        inputRef={inputRef}
        fullWidth
        size="small"
        placeholder={t.addTaskPlaceholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSubmit();
        }}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <AddIcon fontSize="small" sx={{ opacity: 0.5 }} />
            </InputAdornment>
          ),
          sx: { fontSize: 13 },
        }}
      />
    </Box>
  );
}

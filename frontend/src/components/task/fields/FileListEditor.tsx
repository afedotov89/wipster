import { useCallback } from "react";
import { Box, Button, IconButton, Tooltip, Typography } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";
import { useI18n } from "@/i18n";
import * as api from "@/utils/tauri";
import { useFileDrop } from "@/hooks/useFileDrop";

/** The file's own name, and the folder it sits in — shown separately. */
function split(path: string): { name: string; folder: string } {
  const clean = path.replace(/\/+$/, "");
  const cut = clean.lastIndexOf("/");
  return cut < 0
    ? { name: clean, folder: "" }
    : { name: clean.slice(cut + 1), folder: clean.slice(0, cut) };
}

/** Show the file in Finder, selected — the point of the button. */
const reveal = (target: string) => api.revealPath(target).catch(() => {});

/** Open it with whatever normally opens it. */
const openFile = (target: string) => api.openPath(target).catch(() => {});

interface Props {
  /** Unique on screen: the drop finds its field by it. */
  id: string;
  paths: string[];
  onChange: (paths: string[]) => void;
}

/**
 * Files that belong to a task, by path.
 *
 * Paths, not copies: the file stays where the user keeps it, and the task
 * remembers the way back. Each row opens the file or the folder holding it,
 * because "where was that again" is the whole reason the field exists.
 */
export default function FileListEditor({ id, paths, onChange }: Props) {
  const { t } = useI18n();
  const addPaths = useCallback(
    (added: string[]) => onChange([...paths, ...added.filter((p) => !paths.includes(p))]),
    [paths, onChange],
  );
  // Dragging a file out of Finder and onto the field is how anyone would
  // expect to attach one.
  const dragging = useFileDrop(id, addPaths);

  const pick = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({ multiple: true, title: t.chooseFiles });
      if (!picked) return;
      addPaths(Array.isArray(picked) ? picked : [picked]);
    } catch {
      // No picker available — the field still takes paths that are pasted in.
    }
  };

  const removeAt = (index: number) => onChange(paths.filter((_, i) => i !== index));

  return (
    <Box
      data-file-drop={id}
      sx={{
        display: "flex",
        flexDirection: "column",
        gap: 0.5,
        p: 0.5,
        m: -0.5,
        borderRadius: 1.5,
        outline: dragging ? "2px dashed" : "2px dashed transparent",
        outlineColor: dragging ? "primary.main" : "transparent",
        bgcolor: dragging ? "var(--overlay-1)" : "transparent",
        transition: "background-color 120ms ease, outline-color 120ms ease",
      }}
    >
      {paths.map((path, index) => {
        const { name, folder } = split(path);
        return (
          <Box
            key={`${path}-${index}`}
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 0.75,
              px: 1,
              py: 0.5,
              borderRadius: 1,
              bgcolor: "var(--overlay-1)",
              "&:hover .row-actions": { opacity: 1 },
            }}
          >
            <InsertDriveFileOutlinedIcon sx={{ fontSize: 16, opacity: 0.55, flexShrink: 0 }} />
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography
                sx={{ fontSize: 13, cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                onClick={() => openFile(path)}
                title={path}
              >
                {name}
              </Typography>
              {folder && (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: "block", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >
                  {folder}
                </Typography>
              )}
            </Box>
            <Box className="row-actions" sx={{ display: "flex", opacity: 0, transition: "opacity 0.15s" }}>
              <Tooltip title={t.showInFolder}>
                <IconButton size="small" onClick={() => reveal(path)} sx={{ opacity: 0.6 }}>
                  <FolderOpenIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Tooltip>
              <Tooltip title={t.remove}>
                <IconButton size="small" onClick={() => removeAt(index)} sx={{ opacity: 0.6 }}>
                  <CloseIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Tooltip>
            </Box>
          </Box>
        );
      })}

      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <Button
          size="small"
          variant="outlined"
          onClick={pick}
          sx={{ fontSize: 12, px: 1.5 }}
        >
          {t.chooseFiles}
        </Button>
        <Typography variant="caption" color="text.secondary" sx={{ opacity: dragging ? 1 : 0.6 }}>
          {t.dropFilesHint}
        </Typography>
      </Box>
    </Box>
  );
}

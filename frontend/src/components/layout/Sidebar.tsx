import { useEffect, useState } from "react";
import {
  Box,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  TextField,
  IconButton,
  Typography,
  Divider,
  Menu,
  MenuItem as MuiMenuItem,
  ListItemIcon as MenuItemIcon,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import PlayCircleIcon from "@mui/icons-material/PlayCircle";
import EditIcon from "@mui/icons-material/Edit";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import PaletteIcon from "@mui/icons-material/Palette";
import SettingsIcon from "@mui/icons-material/Settings";
import { useProjectStore } from "@/stores/projectStore";
import { useUiStore } from "@/stores/uiStore";
import { useI18n } from "@/i18n";
import { getProjectTaskCounts, type ProjectTaskCounts } from "@/utils/tauri";
import ProjectAppearancePicker, { getProjectIcon } from "./ProjectAppearancePicker";

export default function Sidebar() {
  const { projects, selectedProjectId, load, select, add, update, remove } =
    useProjectStore();
  const { view, setView } = useUiStore();
  const { t } = useI18n();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    mouseX: number;
    mouseY: number;
    projectId: string;
  } | null>(null);

  // Appearance picker state
  const [appearanceProjectId, setAppearanceProjectId] = useState<string | null>(null);

  // Task counts per project
  const [counts, setCounts] = useState<ProjectTaskCounts[]>([]);

  useEffect(() => {
    load().then(() => {
      const lastId = localStorage.getItem("wipster-last-project");
      if (lastId && useProjectStore.getState().selectedProjectId) {
        setView("project");
      }
    });
  }, [load, setView]);

  useEffect(() => {
    const loadCounts = () => {
      getProjectTaskCounts().then(setCounts).catch(() => {});
    };
    loadCounts();
    const interval = setInterval(loadCounts, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleAdd = async () => {
    if (!newName.trim()) {
      setAdding(false);
      return;
    }
    const project = await add(newName.trim());
    setNewName("");
    setAdding(false);
    select(project.id);
    setView("project");
  };

  const handleContextMenu = (e: React.MouseEvent, projectId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ mouseX: e.clientX, mouseY: e.clientY, projectId });
  };

  const handleRename = () => {
    if (!contextMenu) return;
    const project = projects.find((p) => p.id === contextMenu.projectId);
    if (project) {
      setEditingId(project.id);
      setEditName(project.name);
    }
    setContextMenu(null);
  };

  const handleDelete = () => {
    if (!contextMenu) return;
    remove(contextMenu.projectId);
    setContextMenu(null);
  };

  const handleAppearance = () => {
    if (!contextMenu) return;
    setAppearanceProjectId(contextMenu.projectId);
    setContextMenu(null);
  };

  const commitRename = (id: string, originalName: string) => {
    if (editName.trim() && editName.trim() !== originalName) {
      update(id, { name: editName.trim() });
    }
    setEditingId(null);
  };

  return (
    <Box
      sx={{
        width: 240,
        height: "100%",
        borderRight: 1,
        borderColor: "divider",
        display: "flex",
        flexDirection: "column",
        bgcolor: "background.default",
      }}
    >
      <Box sx={{ p: 2, pb: 1 }}>
        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
          {t.appName}
        </Typography>
      </Box>

      <List dense disablePadding>
        <ListItemButton
          selected={view === "all-doing"}
          onClick={() => {
            setView("all-doing");
            select(null);
          }}
          sx={{ mx: 1, borderRadius: 1 }}
        >
          <ListItemIcon sx={{ minWidth: 32 }}>
            <PlayCircleIcon fontSize="small" sx={{ color: "#F2A900" }} />
          </ListItemIcon>
          <ListItemText
            primary={t.allDoing}
            primaryTypographyProps={{ fontSize: 13, fontWeight: 600 }}
          />
        </ListItemButton>
      </List>

      <Divider sx={{ my: 1 }} />

      <Box
        sx={{
          px: 2,
          py: 0.5,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Typography variant="caption" color="text.secondary">
          {t.projects}
        </Typography>
        <IconButton size="small" onClick={() => setAdding(true)}>
          <AddIcon fontSize="small" />
        </IconButton>
      </Box>

      <List dense disablePadding sx={{ flex: 1, overflow: "auto" }}>
        {projects.map((p) =>
          editingId === p.id ? (
            <Box key={p.id} sx={{ px: 2, py: 0.5 }}>
              <TextField
                autoFocus
                fullWidth
                size="small"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename(p.id, p.name);
                  if (e.key === "Escape") setEditingId(null);
                }}
                onBlur={() => commitRename(p.id, p.name)}
                sx={{ "& .MuiInputBase-input": { fontSize: 13 } }}
              />
            </Box>
          ) : (
            <ListItemButton
              key={p.id}
              selected={view === "project" && selectedProjectId === p.id}
              onClick={() => {
                select(p.id);
                setView("project");
              }}
              onDoubleClick={() => {
                setEditingId(p.id);
                setEditName(p.name);
              }}
              onContextMenu={(e) => handleContextMenu(e, p.id)}
              sx={{ mx: 1, borderRadius: 1 }}
            >
              <ListItemIcon sx={{ minWidth: 32 }}>
                {(() => { const Icon = getProjectIcon(p.icon); return <Icon fontSize="small" sx={{ color: p.color || undefined }} />; })()}
              </ListItemIcon>
              <ListItemText
                primary={p.name}
                primaryTypographyProps={{ fontSize: 13, noWrap: true }}
              />
              {(() => {
                const c = counts.find((x) => x.project_id === p.id);
                const total = c ? c.queue + c.doing : 0;
                return total > 0 ? (
                  <Typography variant="caption" sx={{ fontSize: 11, opacity: 0.5, ml: 0.5, flexShrink: 0 }}>
                    {total}
                  </Typography>
                ) : null;
              })()}
            </ListItemButton>
          )
        )}

        {adding && (
          <Box sx={{ px: 2, py: 0.5 }}>
            <TextField
              autoFocus
              fullWidth
              size="small"
              placeholder={t.projectName}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAdd();
                if (e.key === "Escape") {
                  setAdding(false);
                  setNewName("");
                }
              }}
              onBlur={handleAdd}
              sx={{ "& .MuiInputBase-input": { fontSize: 13 } }}
            />
          </Box>
        )}
      </List>

      {/* Context menu for projects */}
      <Menu
        open={contextMenu !== null}
        onClose={() => setContextMenu(null)}
        anchorReference="anchorPosition"
        anchorPosition={
          contextMenu ? { top: contextMenu.mouseY, left: contextMenu.mouseX } : undefined
        }
        slotProps={{ paper: { sx: { minWidth: 160 } } }}
      >
        <MuiMenuItem onClick={handleRename} sx={{ fontSize: 13 }}>
          <MenuItemIcon sx={{ minWidth: 28 }}>
            <EditIcon fontSize="small" />
          </MenuItemIcon>
          {t.rename}
        </MuiMenuItem>
        <MuiMenuItem onClick={handleAppearance} sx={{ fontSize: 13 }}>
          <MenuItemIcon sx={{ minWidth: 28 }}>
            <PaletteIcon fontSize="small" />
          </MenuItemIcon>
          {t.appearance}
        </MuiMenuItem>
        <MuiMenuItem onClick={handleDelete} sx={{ fontSize: 13, color: "error.main" }}>
          <MenuItemIcon sx={{ minWidth: 28 }}>
            <DeleteOutlineIcon fontSize="small" color="error" />
          </MenuItemIcon>
          {t.delete}
        </MuiMenuItem>
      </Menu>

      <List dense disablePadding sx={{ borderTop: 1, borderColor: "divider" }}>
        <ListItemButton
          selected={view === "settings"}
          onClick={() => setView("settings")}
        >
          <ListItemIcon sx={{ minWidth: 32 }}>
            <SettingsIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText
            primary={t.settings}
            primaryTypographyProps={{ fontSize: 13 }}
          />
        </ListItemButton>
      </List>

      {appearanceProjectId && (() => {
        const ap = projects.find((p) => p.id === appearanceProjectId);
        if (!ap) return null;
        return (
          <ProjectAppearancePicker
            open
            onClose={() => setAppearanceProjectId(null)}
            currentIcon={ap.icon}
            currentColor={ap.color}
            onChangeIcon={(icon) => update(ap.id, { icon })}
            onChangeColor={(color) => update(ap.id, { color })}
          />
        );
      })()}
    </Box>
  );
}

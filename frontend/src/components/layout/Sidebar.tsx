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
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import PlayCircleIcon from "@mui/icons-material/PlayCircle";
import Inventory2OutlinedIcon from "@mui/icons-material/Inventory2Outlined";
import EditIcon from "@mui/icons-material/Edit";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import PaletteIcon from "@mui/icons-material/Palette";
import SettingsIcon from "@mui/icons-material/Settings";
import SubdirectoryArrowRightIcon from "@mui/icons-material/SubdirectoryArrowRight";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import { useProjectStore } from "@/stores/projectStore";
import { useTaskStore } from "@/stores/taskStore";
import { useUiStore } from "@/stores/uiStore";
import { useI18n } from "@/i18n";
import { getProjectTaskCounts, projectDeleteImpact, type ProjectTaskCounts,
  type ProjectDeleteImpact } from "@/utils/tauri";
import ProjectAppearancePicker from "./ProjectAppearancePicker";
import ProjectIcon from "./ProjectIcon";
import ProjectDropRow from "./ProjectDropRow";

/**
 * Width of the expand/collapse slot, reserved on every top-level row.
 *
 * It sits in the row's own left padding rather than after it, so a project's
 * icon lines up with the icons of "In progress", "Archive" and "Settings", and
 * the nesting has room to be visible.
 */
const CHEVRON_SLOT = 16;

/** How far a sub-project sits inside its parent. */
const NESTING_INDENT = 2.5;
import { HEADER_BAND_HEIGHT, TRAFFIC_LIGHTS_WIDTH } from "@/utils/constants";

export default function Sidebar({ titlebarInset }: { titlebarInset: number }) {
  const { projects, selectedProjectId, load, select, add, update, remove } =
    useProjectStore();
  const { view, setView } = useUiStore();
  const { archivedTasks, loadArchived, load: loadTasks } = useTaskStore();
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

  // Which parent is having a sub-project typed into it, and which parents are
  // collapsed. Collapse is remembered so the sidebar looks the same next launch.
  // Deleting a project takes its sub-projects and archives its tasks, so the
  // confirmation states the real numbers before anything happens.
  const [pendingDelete, setPendingDelete] = useState<
    { id: string; name: string; impact: ProjectDeleteImpact } | null
  >(null);

  const [addingChildOf, setAddingChildOf] = useState<string | null>(null);
  const [childName, setChildName] = useState("");
  const [collapsed, setCollapsed] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("wipster-collapsed-projects") || "[]");
    } catch {
      return [];
    }
  });

  const toggleCollapsed = (id: string) => {
    setCollapsed((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      try {
        localStorage.setItem("wipster-collapsed-projects", JSON.stringify(next));
      } catch {
        // A remembered collapse is a convenience, never a requirement.
      }
      return next;
    });
  };

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
      loadArchived();
    };
    loadCounts();
    const interval = setInterval(loadCounts, 3000);
    return () => clearInterval(interval);
  }, [loadArchived]);

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

  const handleAddChild = async (parentId: string) => {
    const name = childName.trim();
    setAddingChildOf(null);
    setChildName("");
    if (!name) return;
    const project = await add(name, parentId);
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

  const handleDelete = async () => {
    if (!contextMenu) return;
    const projectId = contextMenu.projectId;
    const project = projects.find((p) => p.id === projectId);
    setContextMenu(null);
    if (!project) return;

    const impact = await projectDeleteImpact(projectId).catch(() => null);
    // An empty project has nothing to warn about — deleting it stays one click.
    if (!impact || (impact.sub_projects === 0 && impact.tasks === 0)) {
      await remove(projectId);
      return;
    }
    setPendingDelete({ id: projectId, name: project.name, impact });
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    await remove(pendingDelete.id);
    setPendingDelete(null);
    // The board may still be showing tasks that just went to the archive.
    const stillSelected = useProjectStore.getState().selectedProjectId;
    if (stillSelected) await loadTasks(stillSelected);
    await loadArchived();
  };

  const handleAddSubProject = () => {
    if (!contextMenu) return;
    setAddingChildOf(contextMenu.projectId);
    setChildName("");
    setCollapsed((prev) => prev.filter((id) => id !== contextMenu.projectId));
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

  // The sidebar shows one level of nesting, but the data model allows any, so a
  // grandchild is listed alongside the children rather than disappearing.
  const roots = projects.filter((p) => !p.parent_id || !projects.some((x) => x.id === p.parent_id));
  const descendantsOf = (rootId: string) => {
    const found: typeof projects = [];
    const queue = [rootId];
    while (queue.length > 0) {
      const parentId = queue.shift()!;
      for (const p of projects) {
        if (p.parent_id === parentId && !found.includes(p)) {
          found.push(p);
          queue.push(p.id);
        }
      }
    }
    return found;
  };

  /// Open work on a project, counting everything nested under it — the same
  /// rule the board uses, so the badge matches what the board will show.
  const openCount = (projectId: string) =>
    [projectId, ...descendantsOf(projectId).map((p) => p.id)].reduce((total, id) => {
      const c = counts.find((x) => x.project_id === id);
      return total + (c ? c.queue + c.doing : 0);
    }, 0);

  const renderProject = (
    p: (typeof projects)[number],
    isChild: boolean,
    hasChildren: boolean,
    isCollapsed: boolean,
  ) => {
    if (editingId === p.id) {
      return (
        <Box key={p.id} sx={{ pl: isChild ? NESTING_INDENT + 2 : 2, pr: 2, py: 0.5 }}>
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
      );
    }

    const total = openCount(p.id);
    return (
      <ProjectDropRow key={p.id} projectId={p.id}>
      <ListItemButton
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
        sx={{ borderRadius: 1, pl: isChild ? NESTING_INDENT : 0 }}
      >
        {/* One slot of a fixed width on every row: the chevron on a parent, the
            nesting mark on a child, empty otherwise. Same width either way, so
            a row that can be expanded does not sit a few pixels left of one
            that cannot. The chevron is the only thing on the row that does not
            mean "open this project", so it stops the click reaching the row. */}
        <Box
          sx={{
            width: CHEVRON_SLOT,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {isChild ? (
            <SubdirectoryArrowRightIcon sx={{ fontSize: 14, opacity: 0.35 }} />
          ) : (
            hasChildren && (
              <IconButton
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleCollapsed(p.id);
                }}
                sx={{ p: 0, opacity: 0.5 }}
              >
                {isCollapsed ? (
                  <ChevronRightIcon sx={{ fontSize: 16 }} />
                ) : (
                  <ExpandMoreIcon sx={{ fontSize: 16 }} />
                )}
              </IconButton>
            )
          )}
        </Box>
        {/* A sub-project keeps its own icon and colour: nesting is shown by the
            indent and the mark, not by taking its identity away. */}
        <ListItemIcon sx={{ minWidth: 32 }}>
          <ProjectIcon project={p} />
        </ListItemIcon>
        <ListItemText
          primary={p.name}
          primaryTypographyProps={{ fontSize: 13, noWrap: true, ...(isChild && { opacity: 0.85 }) }}
        />
        {total > 0 && (
          <Typography variant="caption" sx={{ fontSize: 11, opacity: 0.5, ml: 0.5, flexShrink: 0 }}>
            {total}
          </Typography>
        )}
      </ListItemButton>
      </ProjectDropRow>
    );
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
        bgcolor: "var(--sidebar-tint)",
      }}
    >
      {/* The app's name sits in the titlebar band, to the right of the traffic
          lights that float over it. When the update banner has taken that band
          the buttons are no longer here, and the name goes back to the edge. */}
      <Box
        data-tauri-drag-region
        sx={{
          pl: titlebarInset > 0 ? `${TRAFFIC_LIGHTS_WIDTH}px` : 2,
          pr: 2,
          height: HEADER_BAND_HEIGHT,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
        }}
      >
        <Typography variant="subtitle2" color="text.secondary">
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
        {roots.map((root) => {
          const children = descendantsOf(root.id);
          const isCollapsed = collapsed.includes(root.id);
          return (
            <Box key={root.id}>
              {renderProject(root, false, children.length > 0, isCollapsed)}
              {!isCollapsed && children.map((child) => renderProject(child, true, false, false))}
              {addingChildOf === root.id && (
                <Box sx={{ pl: 4, pr: 2, py: 0.5 }}>
                  <TextField
                    autoFocus
                    fullWidth
                    size="small"
                    placeholder={t.subProjectName}
                    value={childName}
                    onChange={(e) => setChildName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleAddChild(root.id);
                      if (e.key === "Escape") {
                        setAddingChildOf(null);
                        setChildName("");
                      }
                    }}
                    onBlur={() => handleAddChild(root.id)}
                    sx={{ "& .MuiInputBase-input": { fontSize: 13 } }}
                  />
                </Box>
              )}
            </Box>
          );
        })}

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
        // Rename and "add sub-project" open an inline field that focuses itself
        // while the menu is still closing. An open menu keeps focus inside
        // itself and hands it back on close — either one blurs that field the
        // instant it appears, and its blur handler closes it, so the click
        // looked like it did nothing at all.
        disableEnforceFocus
        disableRestoreFocus
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
        {contextMenu && !projects.find((p) => p.id === contextMenu.projectId)?.parent_id && (
          <MuiMenuItem onClick={handleAddSubProject} sx={{ fontSize: 13 }}>
            <MenuItemIcon sx={{ minWidth: 28 }}>
              <SubdirectoryArrowRightIcon fontSize="small" />
            </MenuItemIcon>
            {t.addSubProject}
          </MuiMenuItem>
        )}
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

      <Dialog open={pendingDelete !== null} onClose={() => setPendingDelete(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: 16 }}>
          {pendingDelete ? t.deleteProjectTitle(pendingDelete.name) : ""}
        </DialogTitle>
        <DialogContent>
          {pendingDelete && pendingDelete.impact.sub_projects > 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              {t.deleteProjectSubProjects(pendingDelete.impact.sub_projects)}
            </Typography>
          )}
          {pendingDelete && pendingDelete.impact.tasks > 0 && (
            <Typography variant="body2" color="text.secondary">
              {t.deleteProjectTasks(pendingDelete.impact.tasks)}
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button size="small" onClick={() => setPendingDelete(null)}>
            {t.cancel}
          </Button>
          <Button size="small" color="error" variant="contained" onClick={confirmDelete}>
            {t.delete}
          </Button>
        </DialogActions>
      </Dialog>

      <List dense disablePadding sx={{ borderTop: 1, borderColor: "divider" }}>
        <ListItemButton
          selected={view === "archive"}
          onClick={() => {
            setView("archive");
            select(null);
          }}
          sx={{ mx: 1, borderRadius: 1 }}
        >
          <ListItemIcon sx={{ minWidth: 32 }}>
            <Inventory2OutlinedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText
            primary={t.archive}
            primaryTypographyProps={{ fontSize: 13 }}
          />
          {archivedTasks.length > 0 && (
            <Typography variant="caption" sx={{ fontSize: 11, opacity: 0.5, ml: 0.5, flexShrink: 0 }}>
              {archivedTasks.length}
            </Typography>
          )}
        </ListItemButton>
        <ListItemButton
          selected={view === "settings"}
          onClick={() => setView("settings")}
          sx={{ mx: 1, borderRadius: 1 }}
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
            project={ap}
            onChange={(patch) => update(ap.id, patch)}
          />
        );
      })()}
    </Box>
  );
}

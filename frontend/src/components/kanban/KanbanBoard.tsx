import { useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { Tabs, Tab, useMediaQuery, Box } from "@mui/material";
import KanbanColumn from "./KanbanColumn";
import { useTaskStore } from "@/stores/taskStore";
import { useWipGuard } from "@/hooks/useWipGuard";
import { statusLabel } from "@/utils/constants";
import { useI18n } from "@/i18n";
import type { TaskStatus } from "@/utils/tauri";
import { STATUS_COLUMNS } from "@/utils/constants";

export default function KanbanBoard() {
  const mobile = useMediaQuery("(max-width:899px)") && !isTauri();
  const [column, setColumn] = useState<TaskStatus>("queue");
  const { t } = useI18n();
  const { tasks } = useTaskStore();
  // Dragging is wired up by the shell, which spans the sidebar too; the board
  // only needs the button-driven move.
  const { safeMove } = useWipGuard();

  return (
    <Box sx={{ display: "flex", flexDirection: mobile ? "column" : "row", gap: mobile ? 0 : 2, height: "100%", p: mobile ? 1 : 2 }}>
      {mobile && <Tabs value={column} onChange={(_,v) => setColumn(v)} variant="fullWidth" aria-label="Статус задач">{STATUS_COLUMNS.map(status => <Tab key={status} value={status} label={`${statusLabel(t,status)} ${tasks.filter(t=>t.status===status).length}`} sx={{minWidth:0,px:0.5}} />)}</Tabs>}
      {(mobile ? [column] : STATUS_COLUMNS).map((status) => (
        <KanbanColumn
          key={status}
          status={status}
          tasks={tasks.filter((t) => t.status === status)}
          onMove={safeMove}
        />
      ))}
    </Box>
  );
}

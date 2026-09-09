import { Box } from "@mui/material";
import KanbanColumn from "./KanbanColumn";
import { useTaskStore } from "@/stores/taskStore";
import { useWipGuard } from "@/hooks/useWipGuard";
import { STATUS_COLUMNS } from "@/utils/constants";

export default function KanbanBoard() {
  const { tasks } = useTaskStore();
  // Dragging is wired up by the shell, which spans the sidebar too; the board
  // only needs the button-driven move.
  const { safeMove } = useWipGuard();

  return (
    <Box sx={{ display: "flex", gap: 2, height: "100%", p: 2 }}>
      {STATUS_COLUMNS.map((status) => (
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

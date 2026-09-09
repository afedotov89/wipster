import { Box } from "@mui/material";
import { useDroppable } from "@dnd-kit/core";
import { projectDropId } from "@/hooks/useBoardDnd";

/**
 * A sidebar row that accepts a task dragged from the board.
 *
 * Dropping hands the task to that project — the way to move work between
 * projects, since a board only ever shows one of them at a time. The row is
 * wrapped rather than modified so its layout and click behaviour stay exactly
 * as they were when nothing is being dragged.
 */
export default function ProjectDropRow({
  projectId,
  children,
}: {
  projectId: string;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver, active } = useDroppable({ id: projectDropId(projectId) });
  const dragging = active !== null;

  return (
    <Box
      ref={setNodeRef}
      sx={{
        borderRadius: 1,
        mx: 1,
        // Visible only while something is being dragged: an outline that shows
        // up on hover alone would read as a click target.
        ...(dragging && {
          outline: isOver ? "2px solid" : "1px dashed",
          outlineColor: isOver ? "primary.main" : "var(--overlay-3)",
          outlineOffset: -2,
          bgcolor: isOver ? "action.hover" : undefined,
        }),
      }}
    >
      {children}
    </Box>
  );
}

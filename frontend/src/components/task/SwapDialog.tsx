import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  List,
  ListItemButton,
  ListItemText,
  Typography,
} from "@mui/material";
import { useUiStore } from "@/stores/uiStore";
import { useTaskStore } from "@/stores/taskStore";
import { useHistoryStore } from "@/stores/historyStore";
import { useI18n } from "@/i18n";

export default function SwapDialog() {
  const { swapDialogOpen, swapPendingTaskId, closeSwapDialog } = useUiStore();
  const { doingTasks, move: moveTask, loadDoing } = useTaskStore();
  const { refresh } = useHistoryStore();
  const { t } = useI18n();

  const handleSwap = async (swapTaskId: string) => {
    if (!swapPendingTaskId) return;
    await moveTask(swapPendingTaskId, "doing", swapTaskId);
    await loadDoing();
    await refresh();
    closeSwapDialog();
  };

  return (
    <Dialog
      open={swapDialogOpen}
      onClose={closeSwapDialog}
      maxWidth="xs"
      fullWidth
    >
      <DialogTitle sx={{ fontSize: 16 }}>{t.wipLimitReached}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t.wipLimitDescription}
        </Typography>
        <List dense>
          {doingTasks.map((task) => (
            <ListItemButton
              key={task.id}
              onClick={() => handleSwap(task.id)}
              sx={{ borderRadius: 1 }}
            >
              <ListItemText
                primary={task.title}
                primaryTypographyProps={{ fontSize: 13 }}
              />
            </ListItemButton>
          ))}
        </List>
      </DialogContent>
      <DialogActions>
        <Button onClick={closeSwapDialog} size="small">
          {t.keepInQueue}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

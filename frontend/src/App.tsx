import { ThemeProvider, CssBaseline } from "@mui/material";
import { theme } from "./theme";
import AppShell from "./components/layout/AppShell";
import { useUndoRedo } from "./hooks/useUndoRedo";

function AppContent() {
  useUndoRedo();
  return <AppShell />;
}

export default function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AppContent />
    </ThemeProvider>
  );
}

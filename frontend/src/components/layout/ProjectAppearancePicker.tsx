import { useState } from "react";
import {
  Box,
  Dialog,
  DialogTitle,
  DialogContent,
  IconButton,
  Typography,
} from "@mui/material";
import FolderIcon from "@mui/icons-material/Folder";
import WorkIcon from "@mui/icons-material/Work";
import CodeIcon from "@mui/icons-material/Code";
import ScienceIcon from "@mui/icons-material/Science";
import SchoolIcon from "@mui/icons-material/School";
import BrushIcon from "@mui/icons-material/Brush";
import MusicNoteIcon from "@mui/icons-material/MusicNote";
import SportsSoccerIcon from "@mui/icons-material/SportsSoccer";
import HomeIcon from "@mui/icons-material/Home";
import FavoriteIcon from "@mui/icons-material/Favorite";
import StarIcon from "@mui/icons-material/Star";
import RocketLaunchIcon from "@mui/icons-material/RocketLaunch";
import BugReportIcon from "@mui/icons-material/BugReport";
import BuildIcon from "@mui/icons-material/Build";
import CameraAltIcon from "@mui/icons-material/CameraAlt";
import MenuBookIcon from "@mui/icons-material/MenuBook";
import LightbulbIcon from "@mui/icons-material/Lightbulb";
import ShoppingCartIcon from "@mui/icons-material/ShoppingCart";
import FitnessCenterIcon from "@mui/icons-material/FitnessCenter";
import PaletteIcon from "@mui/icons-material/Palette";
import type { SvgIconComponent } from "@mui/icons-material";
import { useI18n } from "@/i18n";

export const PROJECT_ICONS: Record<string, SvgIconComponent> = {
  folder: FolderIcon,
  work: WorkIcon,
  code: CodeIcon,
  science: ScienceIcon,
  school: SchoolIcon,
  brush: BrushIcon,
  music: MusicNoteIcon,
  sports: SportsSoccerIcon,
  home: HomeIcon,
  favorite: FavoriteIcon,
  star: StarIcon,
  rocket: RocketLaunchIcon,
  bug: BugReportIcon,
  build: BuildIcon,
  camera: CameraAltIcon,
  book: MenuBookIcon,
  lightbulb: LightbulbIcon,
  cart: ShoppingCartIcon,
  fitness: FitnessCenterIcon,
  palette: PaletteIcon,
};

export const PROJECT_COLORS = [
  "#95a5a6", // grey (default)
  "#3498db", // blue
  "#2ecc71", // green
  "#e67e22", // orange
  "#e74c3c", // red
  "#9b59b6", // purple
  "#1abc9c", // teal
  "#f1c40f", // yellow
  "#e91e63", // pink
  "#00bcd4", // cyan
  "#8bc34a", // lime
  "#ff5722", // deep orange
];

export function getProjectIcon(iconKey: string | null): SvgIconComponent {
  return (iconKey && PROJECT_ICONS[iconKey]) || FolderIcon;
}

interface Props {
  open: boolean;
  onClose: () => void;
  currentIcon: string | null;
  currentColor: string | null;
  onChangeIcon: (icon: string) => void;
  onChangeColor: (color: string) => void;
}

export default function ProjectAppearancePicker({
  open,
  onClose,
  currentIcon,
  currentColor,
  onChangeIcon,
  onChangeColor,
}: Props) {
  const { t } = useI18n();
  const [selectedIcon, setSelectedIcon] = useState(currentIcon || "folder");
  const [selectedColor, setSelectedColor] = useState(currentColor || PROJECT_COLORS[0]);

  const handleIconClick = (key: string) => {
    setSelectedIcon(key);
    onChangeIcon(key);
  };

  const handleColorClick = (color: string) => {
    setSelectedColor(color);
    onChangeColor(color);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontSize: 14, pb: 1 }}>{t.appearance}</DialogTitle>
      <DialogContent>
        <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: "block" }}>
          {t.icon}
        </Typography>
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mb: 2 }}>
          {Object.entries(PROJECT_ICONS).map(([key, Icon]) => (
            <IconButton
              key={key}
              size="small"
              onClick={() => handleIconClick(key)}
              sx={{
                border: 2,
                borderColor: selectedIcon === key ? "primary.main" : "transparent",
                borderRadius: 1,
                color: selectedColor,
              }}
            >
              <Icon fontSize="small" />
            </IconButton>
          ))}
        </Box>

        <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: "block" }}>
          {t.color}
        </Typography>
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
          {PROJECT_COLORS.map((color) => (
            <IconButton
              key={color}
              size="small"
              onClick={() => handleColorClick(color)}
              sx={{
                width: 28,
                height: 28,
                bgcolor: color,
                border: 2,
                borderColor: selectedColor === color ? "common.white" : "transparent",
                borderRadius: 1,
                "&:hover": { bgcolor: color, opacity: 0.8 },
              }}
            />
          ))}
        </Box>
      </DialogContent>
    </Dialog>
  );
}

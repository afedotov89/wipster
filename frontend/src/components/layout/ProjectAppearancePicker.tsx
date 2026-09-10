import { useRef, useState } from "react";
import {
  Box,
  Dialog,
  DialogTitle,
  DialogContent,
  IconButton,
  Switch,
  Tooltip,
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
import CloseIcon from "@mui/icons-material/Close";
import AddPhotoAlternateOutlinedIcon from "@mui/icons-material/AddPhotoAlternateOutlined";
import type { SvgIconComponent } from "@mui/icons-material";
import { useI18n } from "@/i18n";
import type { Project, UpdateProjectInput } from "@/utils/tauri";
import { normalizeIcon } from "@/utils/projectIcon";
import ProjectIcon from "./ProjectIcon";

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

/** Icons per row: 20 built-in ones plus the upload tile land in exactly two. */
const ICON_COLUMNS = 11;

/** One cell of the icon grid — square, and the same size whatever is in it. */
const ICON_TILE = {
  width: "100%",
  aspectRatio: "1 / 1",
  p: 0,
  border: 2,
  borderRadius: 1,
} as const;

export function getProjectIcon(iconKey: string | null): SvgIconComponent {
  return (iconKey && PROJECT_ICONS[iconKey]) || FolderIcon;
}

interface Props {
  open: boolean;
  onClose: () => void;
  project: Project;
  onChange: (patch: UpdateProjectInput) => void;
}

export default function ProjectAppearancePicker({ open, onClose, project, onChange }: Props) {
  const { t } = useI18n();
  const [selectedIcon, setSelectedIcon] = useState(project.icon || "folder");
  const [selectedColor, setSelectedColor] = useState(project.color || PROJECT_COLORS[0]);
  const [customIcon, setCustomIcon] = useState<string | null>(project.icon_image);
  const [mono, setMono] = useState(project.icon_mono);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const handleIconClick = (key: string) => {
    setSelectedIcon(key);
    setCustomIcon(null);
    setError("");
    // Choosing a built-in icon is also how a custom one is dropped.
    onChange({ icon: key, icon_image: null });
  };

  const handleColorClick = (color: string) => {
    setSelectedColor(color);
    onChange({ color });
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setError("");
    try {
      const dataUrl = await normalizeIcon(file);
      setCustomIcon(dataUrl);
      onChange({ icon_image: dataUrl, icon_mono: mono });
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
  };

  const handleMono = (value: boolean) => {
    setMono(value);
    onChange({ icon_mono: value });
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xs"
      fullWidth
      // Cmd+V with a picture in the clipboard is the shortest path from "I have
      // a logo" to "the project wears it".
      onPaste={(e) => {
        const file = e.clipboardData?.files?.[0];
        if (file) {
          e.preventDefault();
          void handleFile(file);
        }
      }}
    >
      <DialogTitle sx={{ fontSize: 14, pb: 1, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        {t.appearance}
        <IconButton size="small" onClick={onClose}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: "block" }}>
          {t.icon}
        </Typography>
        <Box
          sx={{
            display: "grid",
            // Room for every built-in icon plus the upload tile in two rows —
            // wrapping left the upload tile stranded on a third row, three
            // pixels short of fitting.
            gridTemplateColumns: `repeat(${ICON_COLUMNS}, minmax(0, 1fr))`,
            gap: 0.5,
            mb: customIcon ? 1 : 2,
          }}
        >
          {Object.entries(PROJECT_ICONS).map(([key, Icon]) => (
            <IconButton
              key={key}
              size="small"
              onClick={() => handleIconClick(key)}
              sx={{
                ...ICON_TILE,
                borderColor: !customIcon && selectedIcon === key ? "primary.main" : "transparent",
                color: selectedColor,
              }}
            >
              <Icon fontSize="small" />
            </IconButton>
          ))}

          {/* The user's own icon sits in the same grid as the rest — one place
              to choose from, and the upload tile is the only thing added. */}
          {customIcon && (
            <IconButton
              size="small"
              onClick={() => fileRef.current?.click()}
              sx={{ ...ICON_TILE, borderColor: "primary.main" }}
            >
              <ProjectIcon
                project={{
                  icon: null,
                  icon_image: customIcon,
                  icon_mono: mono,
                  color: selectedColor,
                }}
              />
            </IconButton>
          )}

          <Tooltip title={t.uploadIcon}>
            <IconButton
              size="small"
              onClick={() => fileRef.current?.click()}
              sx={{
                ...ICON_TILE,
                // Pinned to the last column: the upload tile is not one of the
                // icons, so it sits at the edge instead of trailing the row.
                gridColumn: ICON_COLUMNS,
                borderStyle: "dashed",
                borderColor: "divider",
                color: "text.secondary",
              }}
            >
              <AddPhotoAlternateOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
            hidden
            onChange={(e) => {
              void handleFile(e.target.files?.[0]);
              // Let the same file be picked again after a failed attempt.
              e.target.value = "";
            }}
          />
        </Box>

        {/* Only meaningful for a picture: a built-in glyph always takes the
            project's colour anyway. */}
        {customIcon && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 2 }}>
            <Switch size="small" checked={mono} onChange={(e) => handleMono(e.target.checked)} />
            <Typography variant="caption" color="text.secondary">
              {t.monoIcon}
            </Typography>
          </Box>
        )}

        {error && (
          <Typography variant="caption" color="error" sx={{ display: "block", mb: 2 }}>
            {error === "TOO_LARGE" ? t.iconTooLarge : t.iconNotAnImage}
          </Typography>
        )}

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

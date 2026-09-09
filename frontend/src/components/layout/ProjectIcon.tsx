import { Box } from "@mui/material";
import type { Project } from "@/utils/tauri";
import { getProjectIcon } from "./ProjectAppearancePicker";

/**
 * A project's icon, wherever it is shown.
 *
 * Three cases behind one component so the sidebar, the board header and the
 * archive can never drift apart: a built-in glyph, a user's picture as it is,
 * or a user's single-colour glyph painted in the project's colour. The last one
 * is done with a CSS mask — the image supplies the shape, the colour comes from
 * the project, so a black logo stays visible on a dark sidebar.
 */
export default function ProjectIcon({
  project,
  size = 20,
}: {
  project: Pick<Project, "icon" | "icon_image" | "icon_mono" | "color">;
  size?: number;
}) {
  const color = project.color || undefined;

  if (project.icon_image) {
    if (project.icon_mono) {
      return (
        <Box
          sx={{
            width: size,
            height: size,
            flexShrink: 0,
            bgcolor: color ?? "text.primary",
            WebkitMaskImage: `url("${project.icon_image}")`,
            maskImage: `url("${project.icon_image}")`,
            WebkitMaskSize: "contain",
            maskSize: "contain",
            WebkitMaskRepeat: "no-repeat",
            maskRepeat: "no-repeat",
            WebkitMaskPosition: "center",
            maskPosition: "center",
          }}
        />
      );
    }
    return (
      <Box
        component="img"
        src={project.icon_image}
        alt=""
        sx={{ width: size, height: size, flexShrink: 0, objectFit: "contain", display: "block" }}
      />
    );
  }

  const Icon = getProjectIcon(project.icon);
  return <Icon sx={{ fontSize: size, color, flexShrink: 0 }} />;
}

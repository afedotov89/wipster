import { useEffect, useState } from "react";
import { Box } from "@mui/material";
import type { Project } from "@/utils/tauri";
import { cachedSilhouette, silhouette } from "@/utils/projectIcon";
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
  const image = project.icon_image;
  // App logos come as full-bleed squares and look pasted-on with sharp corners.
  // Rounding is proportional so it reads the same at every size, and it costs
  // nothing for a glyph on a transparent background: there is no paint in the
  // corners to clip.
  const radius = `${Math.round(size * 0.22)}px`;
  const mono = image ? project.icon_mono : false;

  // The shape to paint. Derived once per picture and cached across the app, so
  // the sidebar, the board header and the archive share the work — and an image
  // seen before is ready on the first render, without a flash of the original.
  const [mask, setMask] = useState(() => (image && mono ? cachedSilhouette(image) : undefined));
  useEffect(() => {
    if (!image || !mono) return;
    let current = true;
    void silhouette(image).then((shape) => {
      if (current) setMask(shape);
    });
    return () => {
      current = false;
    };
  }, [image, mono]);

  if (image) {
    if (mono) {
      const shape = mask ?? image;
      return (
        <Box
          sx={{
            width: size,
            height: size,
            flexShrink: 0,
            bgcolor: color ?? "text.primary",
            borderRadius: radius,
            WebkitMaskImage: `url("${shape}")`,
            maskImage: `url("${shape}")`,
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
        src={image}
        alt=""
        sx={{
          width: size,
          height: size,
          flexShrink: 0,
          objectFit: "contain",
          display: "block",
          borderRadius: radius,
        }}
      />
    );
  }

  const Icon = getProjectIcon(project.icon);
  return <Icon sx={{ fontSize: size, color, flexShrink: 0 }} />;
}

import type { ReactNode } from "react";
import { Box, Typography } from "@mui/material";

interface Props {
  /** What this group of controls is about. Omitted when the section name says it. */
  title?: ReactNode;
  /** The sentence that belongs under the controls, not beside them. */
  caption?: ReactNode;
  children: ReactNode;
}

/**
 * One group of settings, in a container of its own.
 *
 * Every section is built out of these, so related controls read as belonging
 * together and two unrelated ones never blur into a single column of fields.
 */
export default function SettingsGroup({ title, caption, children }: Props) {
  return (
    <Box
      sx={{
        bgcolor: "var(--overlay-1)",
        borderRadius: 2,
        p: 2,
        display: "flex",
        flexDirection: "column",
        gap: 2,
      }}
    >
      {title && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          {typeof title === "string" ? (
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {title}
            </Typography>
          ) : (
            title
          )}
        </Box>
      )}
      {children}
      {caption && (
        <Typography variant="caption" color="text.secondary">
          {caption}
        </Typography>
      )}
    </Box>
  );
}

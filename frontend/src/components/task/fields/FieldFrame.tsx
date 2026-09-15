import type { ReactNode } from "react";
import { Box, Typography } from "@mui/material";

/**
 * The frame every field shares: its name above, its editor below.
 *
 * Built-in fields have looked like this since the first version; a custom field
 * has no business looking different just because the user added it.
 */
export default function FieldFrame({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
        {label}
        {hint && (
          <Typography component="span" variant="caption" color="text.secondary" sx={{ opacity: 0.7 }}>
            {" "}
            {hint}
          </Typography>
        )}
      </Typography>
      {children}
    </Box>
  );
}

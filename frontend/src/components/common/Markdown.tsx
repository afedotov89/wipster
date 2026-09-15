import { Box, type SxProps, type Theme } from "@mui/material";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Markdown as this app renders it.
 *
 * The assistant's answers and the release notes are both written in markdown
 * and both have to read like the rest of the interface, so the rules live here
 * once instead of being copied into whichever component needed them next.
 */
export const MARKDOWN_SX = {
  fontSize: 13,
  lineHeight: 1.5,
  "& p": { m: 0, mb: 0.5 },
  "& ul, & ol": { m: 0, pl: 2, mb: 0.5 },
  "& li": { mb: 0.25 },
  "& li > p": { mb: 0 },
  "& code": { bgcolor: "var(--overlay-2)", px: 0.5, borderRadius: 0.5, fontSize: 12 },
  "& pre": { bgcolor: "var(--overlay-2)", p: 1, borderRadius: 1, overflow: "auto", mb: 0.5 },
  "& pre code": { bgcolor: "transparent", p: 0, fontSize: 11.5, lineHeight: 1.45 },
  "& strong": { fontWeight: 600 },
  "& a": {
    color: "primary.main",
    textDecoration: "underline",
    textDecorationStyle: "dotted",
    cursor: "pointer",
  },

  // Headings: a step up in weight, not in size — anything larger fights the
  // chat for attention.
  "& h1, & h2, & h3, & h4, & h5, & h6": {
    m: 0,
    mt: 1,
    mb: 0.5,
    fontSize: 13,
    fontWeight: 700,
    lineHeight: 1.4,
    "&:first-of-type": { mt: 0 },
  },
  "& h1, & h2": { fontSize: 14 },

  // Tables: the panel is narrow, so a wide one scrolls sideways rather than
  // squeezing its columns into single letters.
  "& table": {
    width: "100%",
    my: 0.75,
    borderCollapse: "collapse",
    fontSize: 12,
    display: "block",
    overflowX: "auto",
  },
  "& th, & td": {
    textAlign: "left",
    verticalAlign: "top",
    px: 0.75,
    py: 0.5,
    borderBottom: "1px solid",
    borderColor: "var(--overlay-2)",
  },
  "& th": {
    fontWeight: 600,
    whiteSpace: "nowrap",
    color: "text.secondary",
    borderBottomColor: "var(--overlay-3)",
  },
  "& tbody tr:last-of-type td": { borderBottom: "none" },
  "& td:first-of-type": { pl: 0 },
  "& th:first-of-type": { pl: 0 },

  "& blockquote": {
    m: 0,
    mb: 0.5,
    pl: 1,
    borderLeft: "2px solid",
    borderColor: "var(--overlay-3)",
    color: "text.secondary",
  },
  "& hr": {
    border: 0,
    borderTop: "1px solid",
    borderColor: "var(--overlay-2)",
    my: 1,
  },
  "& img": { maxWidth: "100%", borderRadius: 1 },
} as const;

interface Props {
  children: string;
  /** Extra styling for the block — density, width, a scroll of its own. */
  sx?: SxProps<Theme>;
}

export default function Markdown({ children, sx }: Props) {
  return (
    <Box sx={{ ...MARKDOWN_SX, ...(sx as object) }}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </Box>
  );
}

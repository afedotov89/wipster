import { List, ListItemButton, ListItemIcon, ListItemText } from "@mui/material";
import { useI18n } from "@/i18n";
import { SETTINGS_SECTIONS, type SettingsSectionId } from "./sections";

export const settingsTabId = (id: SettingsSectionId) => `settings-tab-${id}`;

interface Props {
  current: SettingsSectionId;
  onSelect: (id: SettingsSectionId) => void;
}

/**
 * The rooms of the settings, as rows in the sidebar.
 *
 * A tab list rather than a list of links: only one section is on screen, the
 * arrow keys walk it the way every macOS sidebar does, and a screen reader is
 * told which panel each row governs.
 */
export default function SettingsNav({ current, onSelect }: Props) {
  const { t } = useI18n();

  const step = (delta: number) => {
    const index = SETTINGS_SECTIONS.findIndex((s) => s.id === current);
    const count = SETTINGS_SECTIONS.length;
    const next = SETTINGS_SECTIONS[(index + delta + count) % count];
    onSelect(next.id);
    document.getElementById(settingsTabId(next.id))?.focus();
  };

  const jump = (id: SettingsSectionId) => {
    onSelect(id);
    document.getElementById(settingsTabId(id))?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") step(1);
    else if (e.key === "ArrowUp") step(-1);
    else if (e.key === "Home") jump(SETTINGS_SECTIONS[0].id);
    else if (e.key === "End") jump(SETTINGS_SECTIONS[SETTINGS_SECTIONS.length - 1].id);
    else return;
    e.preventDefault();
  };

  return (
    <List
      role="tablist"
      aria-orientation="vertical"
      onKeyDown={handleKeyDown}
      dense
      disablePadding
      sx={{ flex: 1, overflow: "auto", pb: 0.5 }}
    >
      {SETTINGS_SECTIONS.map(({ id, Icon, title }) => (
        <ListItemButton
          key={id}
          id={settingsTabId(id)}
          role="tab"
          aria-selected={id === current}
          aria-controls="settings-panel"
          tabIndex={id === current ? 0 : -1}
          selected={id === current}
          onClick={() => onSelect(id)}
          sx={{ mx: 1, borderRadius: 1 }}
        >
          <ListItemIcon sx={{ minWidth: 32 }}>
            <Icon sx={{ fontSize: 18 }} />
          </ListItemIcon>
          <ListItemText primary={title(t)} primaryTypographyProps={{ fontSize: 13, noWrap: true }} />
        </ListItemButton>
      ))}
    </List>
  );
}

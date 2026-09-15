import type { ComponentType } from "react";
import type { SvgIconComponent } from "@mui/icons-material";
import TuneIcon from "@mui/icons-material/Tune";
import PaletteOutlinedIcon from "@mui/icons-material/PaletteOutlined";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import HubOutlinedIcon from "@mui/icons-material/HubOutlined";
import TerminalIcon from "@mui/icons-material/Terminal";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import type { Translations } from "@/i18n";
import GeneralPanel from "./GeneralPanel";
import AppearancePanel from "./AppearancePanel";
import AssistantPanel from "./AssistantPanel";
import IntegrationsPanel from "./IntegrationsPanel";
import LogsPanel from "./LogsPanel";
import AboutPanel from "./AboutPanel";

export interface SettingsSection {
  id: string;
  Icon: SvgIconComponent;
  /** The section's name — it titles both the row and the window band. */
  title: (t: Translations) => string;
  Panel: ComponentType;
}

/**
 * The settings, as a list of places rather than one long page.
 *
 * This array is the single source of truth: it renders the navigation, it
 * decides what the window band says, and it is published to the assistant, so a
 * section can never exist in one of those and be missing from another.
 */
export const SETTINGS_SECTIONS = [
  { id: "general", Icon: TuneIcon, title: (t) => t.settingsGeneral, Panel: GeneralPanel },
  { id: "appearance", Icon: PaletteOutlinedIcon, title: (t) => t.settingsAppearance, Panel: AppearancePanel },
  { id: "assistant", Icon: AutoAwesomeIcon, title: (t) => t.aiConnector, Panel: AssistantPanel },
  { id: "integrations", Icon: HubOutlinedIcon, title: (t) => t.integrations, Panel: IntegrationsPanel },
  { id: "logs", Icon: TerminalIcon, title: (t) => t.settingsLogs, Panel: LogsPanel },
  { id: "about", Icon: InfoOutlinedIcon, title: (t) => t.about, Panel: AboutPanel },
] as const satisfies readonly SettingsSection[];

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]["id"];

export const DEFAULT_SETTINGS_SECTION: SettingsSectionId = "general";

export function isSettingsSectionId(value: unknown): value is SettingsSectionId {
  return typeof value === "string" && SETTINGS_SECTIONS.some((s) => s.id === value);
}

export function settingsSection(id: SettingsSectionId): SettingsSection {
  return SETTINGS_SECTIONS.find((s) => s.id === id) ?? SETTINGS_SECTIONS[0];
}

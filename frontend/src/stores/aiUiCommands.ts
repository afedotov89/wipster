import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { THEMES, type Mode } from "@/theme/themes";
import { useThemeStore } from "@/theme/store";
import { useUiStore } from "@/stores/uiStore";
import { useProjectStore } from "@/stores/projectStore";
import { useI18n, type Locale } from "@/i18n";
import { useSettingsStore } from "@/stores/settingsStore";
import { SETTINGS_SECTIONS, isSettingsSectionId } from "@/pages/settings/sections";
import { setSetting } from "@/utils/tauri";
import { appLog } from "@/stores/logStore";

/**
 * The interface's half of the assistant's toolbox.
 *
 * Anything the assistant can ask the window to do arrives here as one event and
 * is applied to the stores. The action names are the ones declared on the Rust
 * side (`Handler::Ui(...)`), and a test there checks that every one of them is
 * answered in this file — so a tool can never be offered to the model without
 * something here to carry it out.
 */
export function applyAiUiCommand(action: string, params: Record<string, unknown>): void {
  switch (action) {
    case "set_appearance": {
      const themeId = typeof params.theme_id === "string" ? params.theme_id : null;
      const mode = typeof params.mode === "string" ? (params.mode as Mode) : null;
      const theme = themeId ? THEMES.find((t) => t.id === themeId) : undefined;
      if (theme) {
        if (theme.mode === "dark") useThemeStore.getState().setDarkTheme(theme.id);
        else useThemeStore.getState().setLightTheme(theme.id);
        // Picking a theme means wanting to see it, not "some day when it is dark".
        useThemeStore.getState().setMode(theme.mode);
      }
      if (mode) useThemeStore.getState().setMode(mode);
      return;
    }
    case "set_language": {
      const locale = params.locale === "en" || params.locale === "ru" ? (params.locale as Locale) : null;
      if (locale) useI18n.getState().setLocale(locale);
      return;
    }
    case "open_view": {
      const view = params.view;
      if (view === "project") {
        const projectId = typeof params.project_id === "string" ? params.project_id : null;
        if (projectId) useProjectStore.getState().select(projectId);
        useUiStore.getState().setView("project");
      } else if (view === "settings") {
        // Settings are a set of rooms: naming one takes the user straight to it
        // instead of leaving them to find it.
        useUiStore
          .getState()
          .openSettings(isSettingsSectionId(params.section) ? params.section : undefined);
      } else if (view === "all-doing" || view === "archive") {
        useUiStore.getState().setView(view);
      }
      return;
    }
    case "set_task_detail_mode": {
      const mode = params.mode === "wide" || params.mode === "panel" ? params.mode : null;
      if (mode) void useSettingsStore.getState().setTaskDetailMode(mode);
      return;
    }
    case "open_task": {
      const taskId = typeof params.task_id === "string" ? params.task_id : null;
      if (taskId) useUiStore.getState().openDetail(taskId);
      return;
    }
    default:
      appLog.warn(`[ai-ui] unknown action from a tool: ${action}`);
  }
}

/**
 * Publish what the interface can do, so the assistant can name a theme instead
 * of guessing one. The catalogue lives here because this is where it is true.
 */
async function publishCatalog(): Promise<void> {
  const catalog = {
    themes: THEMES.map((t) => ({ id: t.id, mode: t.mode, name: t.name.en, mood: t.mood })),
    modes: ["dark", "light", "auto"],
    views: ["project", "all-doing", "archive", "settings"],
    settings_sections: SETTINGS_SECTIONS.map((s) => s.id),
    locales: ["ru", "en"],
  };
  await setSetting("ui_catalog", JSON.stringify(catalog));
}

export function useAiUiCommands(): void {
  useEffect(() => {
    void publishCatalog().catch(() => {
      // The assistant falls back to saying it does not know the options yet.
    });

    const unlisten = listen<{ action: string; params: Record<string, unknown> }>(
      "ai-ui-command",
      (event) => {
        appLog.info(`[ai-ui] ${event.payload.action}`);
        applyAiUiCommand(event.payload.action, event.payload.params ?? {});
      },
    );
    return () => {
      void unlisten.then((off) => off());
    };
  }, []);
}

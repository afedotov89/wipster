export type ThemeMode = "dark" | "light";

export interface ThemeDef {
  id: string;
  mode: ThemeMode;
  name: { ru: string; en: string };
  description: { ru: string; en: string };
  mood: string;
  primary: string;
  secondary: string;
  bgDefault: string;
  bgPaper: string;
  ambient: string;
  /** Overlay alphas: subtle / soft / medium / strong / text-strong */
  overlay: [string, string, string, string, string];
}

const radial = (size: string, pos: string, rgb: string, inner: number, mid: number, outer: number) =>
  `radial-gradient(ellipse ${size} at ${pos}, rgba(${rgb},${inner}) 0%, rgba(${rgb},${mid}) 40%, transparent ${outer}%)`;

const darkOverlay: ThemeDef["overlay"] = [
  "rgba(255,255,255,0.03)",
  "rgba(255,255,255,0.06)",
  "rgba(255,255,255,0.12)",
  "rgba(255,255,255,0.25)",
  "rgba(255,255,255,0.55)",
];

const lightOverlay: ThemeDef["overlay"] = [
  "rgba(0,0,0,0.025)",
  "rgba(0,0,0,0.045)",
  "rgba(0,0,0,0.08)",
  "rgba(0,0,0,0.14)",
  "rgba(0,0,0,0.65)",
];

// =============== DARK THEMES ===============

const mintAmb = [
  radial("120% 80%", "15% 25%", "46,125,111", 0.09, 0.03, 70),
  radial("100% 100%", "85% 15%", "74,140,110", 0.06, 0.02, 65),
  radial("130% 90%", "55% 85%", "40,110,90", 0.08, 0.02, 75),
  radial("90% 120%", "5% 65%", "30,80,65", 0.1, 0.03, 70),
].join(", ");

const midnightAmb = [
  radial("130% 90%", "20% 20%", "124,158,255", 0.08, 0.02, 70),
  radial("100% 110%", "85% 80%", "70,90,170", 0.07, 0.02, 65),
  radial("80% 80%", "5% 90%", "50,60,130", 0.09, 0.02, 70),
  radial("120% 70%", "70% 10%", "160,180,255", 0.04, 0.01, 55),
].join(", ");

const forestAmb = [
  radial("140% 90%", "20% 30%", "136,181,116", 0.07, 0.02, 70),
  radial("110% 100%", "80% 70%", "80,120,70", 0.08, 0.02, 65),
  radial("90% 130%", "10% 85%", "60,100,55", 0.09, 0.02, 70),
].join(", ");

const sunsetAmb = [
  radial("130% 100%", "80% 80%", "245,160,92", 0.12, 0.03, 75),
  radial("110% 90%", "20% 60%", "200,80,80", 0.08, 0.02, 70),
  radial("90% 110%", "60% 10%", "180,100,140", 0.06, 0.02, 65),
].join(", ");

const auroraAmb = [
  radial("120% 90%", "20% 30%", "167,139,250", 0.1, 0.03, 70),
  radial("100% 110%", "80% 70%", "110,180,200", 0.08, 0.02, 65),
  radial("90% 80%", "50% 95%", "220,140,200", 0.07, 0.02, 70),
  radial("130% 70%", "95% 10%", "100,200,180", 0.06, 0.02, 60),
].join(", ");

const graphiteAmb = radial("150% 100%", "50% 50%", "255,255,255", 0.025, 0.005, 80);

const oceanAmb = [
  radial("130% 100%", "30% 20%", "77,208,225", 0.09, 0.02, 70),
  radial("100% 120%", "85% 75%", "40,120,160", 0.08, 0.02, 70),
  radial("90% 80%", "10% 90%", "20,80,120", 0.1, 0.03, 70),
].join(", ");

const candleAmb = [
  radial("100% 90%", "50% 90%", "249,189,106", 0.14, 0.04, 70),
  radial("120% 100%", "20% 30%", "200,100,40", 0.06, 0.02, 65),
  radial("90% 110%", "80% 20%", "180,80,40", 0.05, 0.01, 60),
].join(", ");

// =============== LIGHT THEMES ===============

const paperAmb = [
  radial("130% 90%", "20% 25%", "120,140,130", 0.04, 0.01, 70),
  radial("100% 100%", "80% 75%", "150,160,140", 0.03, 0.01, 65),
].join(", ");

const morningAmb = [
  radial("130% 100%", "75% 25%", "245,180,120", 0.09, 0.025, 70),
  radial("110% 110%", "20% 80%", "245,200,180", 0.07, 0.02, 65),
  radial("90% 100%", "60% 95%", "250,220,200", 0.05, 0.015, 70),
].join(", ");

const linenAmb = [
  radial("140% 100%", "25% 25%", "180,150,110", 0.07, 0.02, 70),
  radial("110% 100%", "80% 75%", "200,170,130", 0.05, 0.015, 65),
  radial("90% 110%", "60% 95%", "160,140,100", 0.04, 0.01, 60),
].join(", ");

const sakuraAmb = [
  radial("130% 100%", "20% 30%", "230,160,200", 0.07, 0.02, 70),
  radial("100% 110%", "80% 70%", "200,170,230", 0.06, 0.015, 65),
  radial("90% 100%", "55% 95%", "240,200,220", 0.06, 0.015, 70),
].join(", ");

const skyAmb = [
  radial("130% 100%", "25% 25%", "120,180,240", 0.08, 0.02, 70),
  radial("100% 110%", "85% 75%", "180,210,240", 0.06, 0.015, 65),
  radial("90% 100%", "50% 95%", "200,225,245", 0.05, 0.01, 70),
].join(", ");

const chalkAmb = radial("150% 100%", "50% 50%", "0,0,0", 0.025, 0.005, 80);

// =============== REGISTRY ===============

export const THEMES: ThemeDef[] = [
  // ---- DARK ----
  {
    id: "mint", mode: "dark", mood: "🌿",
    name: { ru: "Мята", en: "Mint" },
    description: { ru: "Стабильный фокус", en: "Steady focus" },
    primary: "#2E7D6F", secondary: "#4A8C6E",
    bgDefault: "#0f1a17", bgPaper: "#162220",
    ambient: mintAmb, overlay: darkOverlay,
  },
  {
    id: "midnight", mode: "dark", mood: "🌙",
    name: { ru: "Полночь", en: "Midnight" },
    description: { ru: "Глубокая ночь", en: "Deep night work" },
    primary: "#7C9EFF", secondary: "#5B7AD9",
    bgDefault: "#0a0e1a", bgPaper: "#131826",
    ambient: midnightAmb, overlay: darkOverlay,
  },
  {
    id: "forest", mode: "dark", mood: "🌲",
    name: { ru: "Лес", en: "Forest" },
    description: { ru: "Заземление", en: "Grounding" },
    primary: "#88B574", secondary: "#6E9A5C",
    bgDefault: "#0f1410", bgPaper: "#18211a",
    ambient: forestAmb, overlay: darkOverlay,
  },
  {
    id: "sunset", mode: "dark", mood: "🌅",
    name: { ru: "Закат", en: "Sunset" },
    description: { ru: "Вечерняя рефлексия", en: "Evening reflection" },
    primary: "#F5A05C", secondary: "#D9824A",
    bgDefault: "#1a100d", bgPaper: "#221814",
    ambient: sunsetAmb, overlay: darkOverlay,
  },
  {
    id: "aurora", mode: "dark", mood: "✨",
    name: { ru: "Сияние", en: "Aurora" },
    description: { ru: "Креатив и идеи", en: "Creative flow" },
    primary: "#A78BFA", secondary: "#8B6FD9",
    bgDefault: "#0d0c1a", bgPaper: "#161427",
    ambient: auroraAmb, overlay: darkOverlay,
  },
  {
    id: "graphite", mode: "dark", mood: "◼",
    name: { ru: "Графит", en: "Graphite" },
    description: { ru: "Максимальный фокус", en: "Zero distractions" },
    primary: "#D6D6D6", secondary: "#A0A0A0",
    bgDefault: "#131313", bgPaper: "#1c1c1c",
    ambient: graphiteAmb, overlay: darkOverlay,
  },
  {
    id: "ocean", mode: "dark", mood: "🌊",
    name: { ru: "Океан", en: "Ocean" },
    description: { ru: "Глубина", en: "Depth" },
    primary: "#4DD0E1", secondary: "#26A6B8",
    bgDefault: "#0a1418", bgPaper: "#122027",
    ambient: oceanAmb, overlay: darkOverlay,
  },
  {
    id: "candle", mode: "dark", mood: "🕯",
    name: { ru: "Свеча", en: "Candle" },
    description: { ru: "Уютный вечер", en: "Cozy evening" },
    primary: "#F9BD6A", secondary: "#D99B4A",
    bgDefault: "#15100a", bgPaper: "#1e1610",
    ambient: candleAmb, overlay: darkOverlay,
  },

  // ---- LIGHT ----
  {
    id: "paper", mode: "light", mood: "📄",
    name: { ru: "Бумага", en: "Paper" },
    description: { ru: "Чистая страница", en: "Blank page" },
    primary: "#2E7D6F", secondary: "#3E8A78",
    bgDefault: "#fafaf7", bgPaper: "#ffffff",
    ambient: paperAmb, overlay: lightOverlay,
  },
  {
    id: "morning", mode: "light", mood: "☀️",
    name: { ru: "Утро", en: "Morning" },
    description: { ru: "Тёплый старт", en: "Warm start" },
    primary: "#D9772E", secondary: "#BF6624",
    bgDefault: "#fef6ef", bgPaper: "#ffffff",
    ambient: morningAmb, overlay: lightOverlay,
  },
  {
    id: "linen", mode: "light", mood: "🌾",
    name: { ru: "Лён", en: "Linen" },
    description: { ru: "Натуральный покой", en: "Natural calm" },
    primary: "#8A7250", secondary: "#6F5B3F",
    bgDefault: "#f4ede0", bgPaper: "#fcf8f0",
    ambient: linenAmb, overlay: lightOverlay,
  },
  {
    id: "sakura", mode: "light", mood: "🌸",
    name: { ru: "Сакура", en: "Sakura" },
    description: { ru: "Нежность", en: "Tenderness" },
    primary: "#B66B8A", secondary: "#9C5675",
    bgDefault: "#faf3f6", bgPaper: "#ffffff",
    ambient: sakuraAmb, overlay: lightOverlay,
  },
  {
    id: "sky", mode: "light", mood: "☁",
    name: { ru: "Небо", en: "Sky" },
    description: { ru: "Открытость", en: "Openness" },
    primary: "#4A7AB5", secondary: "#3E6699",
    bgDefault: "#eff5fb", bgPaper: "#ffffff",
    ambient: skyAmb, overlay: lightOverlay,
  },
  {
    id: "chalk", mode: "light", mood: "🧊",
    name: { ru: "Мел", en: "Chalk" },
    description: { ru: "Без отвлечений", en: "No distractions" },
    primary: "#2A2A2A", secondary: "#4A4A4A",
    bgDefault: "#f4f4f4", bgPaper: "#ffffff",
    ambient: chalkAmb, overlay: lightOverlay,
  },
];

export const DEFAULT_DARK_ID = "mint";
export const DEFAULT_LIGHT_ID = "paper";

export type Mode = "light" | "dark" | "auto";
export const DEFAULT_MODE: Mode = "dark";

export const darkThemes = () => THEMES.filter((t) => t.mode === "dark");
export const lightThemes = () => THEMES.filter((t) => t.mode === "light");

export const getThemeById = (id: string): ThemeDef | undefined =>
  THEMES.find((t) => t.id === id);

export function resolveMode(mode: Mode): "light" | "dark" {
  if (mode !== "auto") return mode;
  if (typeof window === "undefined") return "dark";
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function resolveCurrentTheme(
  darkId: string, lightId: string, mode: Mode,
): ThemeDef {
  const resolved = resolveMode(mode);
  const id = resolved === "dark" ? darkId : lightId;
  return getThemeById(id) ?? getThemeById(resolved === "dark" ? DEFAULT_DARK_ID : DEFAULT_LIGHT_ID)!;
}

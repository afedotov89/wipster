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
  /**
   * Ambient gradient layers, topmost first. Kept as separate entries rather than
   * one joined string so `builder.ts` can pair each with its own
   * position/size/repeat — a single joined string would desync those lists and
   * CSS would silently cycle a pattern's tile size onto a gradient.
   */
  ambient: string[];
  /** Overlay alphas: subtle / soft / medium / strong / text-strong */
  overlay: [string, string, string, string, string];
}

const radial = (size: string, pos: string, rgb: string, inner: number, mid: number, outer: number) =>
  `radial-gradient(ellipse ${size} at ${pos}, rgba(${rgb},${inner}) 0%, rgba(${rgb},${mid}) 40%, transparent ${outer}%)`;

/**
 * A tighter, more saturated bloom. The wide `radial` washes set the overall
 * tint; these are what actually make the surface move — without them a theme
 * reads as one flat colour. Sized in px so the colour shifts across the window
 * at any zoom instead of stretching with it.
 */
const spot = (px: number, pos: string, rgb: string, alpha: number) =>
  `radial-gradient(circle ${px}px at ${pos}, rgba(${rgb},${alpha}) 0%, rgba(${rgb},${(alpha * 0.35).toFixed(3)}) 45%, transparent 72%)`;

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
  spot(360, "28% 22%", "90,200,170", 0.13),
  spot(300, "78% 62%", "40,140,120", 0.12),
  spot(240, "58% 12%", "120,220,190", 0.07),
  radial("120% 80%", "15% 25%", "46,125,111", 0.09, 0.03, 70),
  radial("100% 100%", "85% 15%", "74,140,110", 0.06, 0.02, 65),
  radial("130% 90%", "55% 85%", "40,110,90", 0.08, 0.02, 75),
  radial("90% 120%", "5% 65%", "30,80,65", 0.1, 0.03, 70),
];

const midnightAmb = [
  spot(380, "22% 18%", "124,158,255", 0.14),
  spot(320, "82% 72%", "90,110,220", 0.13),
  spot(260, "52% 42%", "170,190,255", 0.06),
  radial("130% 90%", "20% 20%", "124,158,255", 0.08, 0.02, 70),
  radial("100% 110%", "85% 80%", "70,90,170", 0.07, 0.02, 65),
  radial("80% 80%", "5% 90%", "50,60,130", 0.09, 0.02, 70),
  radial("120% 70%", "70% 10%", "160,180,255", 0.04, 0.01, 55),
];

const forestAmb = [
  spot(360, "25% 28%", "150,200,130", 0.12),
  spot(300, "80% 66%", "90,140,80", 0.13),
  spot(240, "50% 8%", "180,220,150", 0.06),
  radial("140% 90%", "20% 30%", "136,181,116", 0.07, 0.02, 70),
  radial("110% 100%", "80% 70%", "80,120,70", 0.08, 0.02, 65),
  radial("90% 130%", "10% 85%", "60,100,55", 0.09, 0.02, 70),
];

const sunsetAmb = [
  spot(380, "78% 74%", "255,175,105", 0.16),
  spot(300, "4% 52%", "235,130,95", 0.15),
  spot(320, "22% 52%", "215,90,90", 0.13),
  spot(260, "58% 14%", "195,110,155", 0.09),
  radial("130% 100%", "80% 80%", "245,160,92", 0.12, 0.03, 75),
  radial("110% 90%", "20% 60%", "200,80,80", 0.08, 0.02, 70),
  radial("90% 110%", "60% 10%", "180,100,140", 0.06, 0.02, 65),
];

const auroraAmb = [
  spot(380, "24% 26%", "175,145,255", 0.16),
  spot(300, "2% 60%", "150,130,235", 0.15),
  spot(330, "76% 66%", "115,195,215", 0.14),
  spot(280, "52% 92%", "230,150,210", 0.11),
  radial("120% 90%", "20% 30%", "167,139,250", 0.1, 0.03, 70),
  radial("100% 110%", "80% 70%", "110,180,200", 0.08, 0.02, 65),
  radial("90% 80%", "50% 95%", "220,140,200", 0.07, 0.02, 70),
  radial("130% 70%", "95% 10%", "100,200,180", 0.06, 0.02, 60),
];

// "Zero distractions" — the one theme that stays deliberately quiet
const graphiteAmb = [
  spot(420, "30% 25%", "255,255,255", 0.035),
  spot(340, "75% 70%", "255,255,255", 0.028),
  radial("150% 100%", "50% 50%", "255,255,255", 0.025, 0.005, 80),
];

const oceanAmb = [
  spot(380, "30% 20%", "95,225,240", 0.14),
  spot(320, "80% 68%", "45,135,180", 0.14),
  spot(260, "12% 88%", "25,95,140", 0.11),
  radial("130% 100%", "30% 20%", "77,208,225", 0.09, 0.02, 70),
  radial("100% 120%", "85% 75%", "40,120,160", 0.08, 0.02, 70),
  radial("90% 80%", "10% 90%", "20,80,120", 0.1, 0.03, 70),
];

const candleAmb = [
  spot(360, "50% 88%", "255,200,120", 0.18),
  spot(300, "3% 70%", "230,150,80", 0.15),
  spot(320, "20% 28%", "215,115,50", 0.11),
  spot(260, "82% 22%", "195,90,50", 0.09),
  radial("100% 90%", "50% 90%", "249,189,106", 0.14, 0.04, 70),
  radial("120% 100%", "20% 30%", "200,100,40", 0.06, 0.02, 65),
  radial("90% 110%", "80% 20%", "180,80,40", 0.05, 0.01, 60),
];

// =============== LIGHT THEMES ===============

const paperAmb = [
  spot(400, "26% 22%", "196,168,124", 0.16),
  spot(330, "78% 68%", "176,150,112", 0.15),
  spot(260, "56% 96%", "150,126,92", 0.10),
  radial("130% 90%", "20% 25%", "200,180,150", 0.10, 0.03, 70),
  radial("100% 100%", "80% 75%", "210,190,160", 0.07, 0.02, 65),
  radial("90% 110%", "55% 95%", "180,160,130", 0.05, 0.015, 70),
];

const freshAmb = [
  spot(400, "24% 22%", "96,186,146", 0.20),
  spot(340, "80% 70%", "70,164,128", 0.18),
  spot(260, "56% 4%", "150,214,180", 0.12),
  radial("130% 90%", "20% 25%", "140,200,170", 0.12, 0.03, 70),
  radial("100% 100%", "80% 75%", "120,190,160", 0.10, 0.025, 65),
  radial("90% 110%", "55% 95%", "100,180,150", 0.08, 0.02, 70),
];

const morningAmb = [
  spot(420, "74% 22%", "250,166,88", 0.24),
  spot(340, "20% 76%", "244,158,124", 0.19),
  spot(260, "52% 46%", "255,206,150", 0.12),
  radial("130% 100%", "75% 25%", "245,170,100", 0.18, 0.05, 70),
  radial("110% 110%", "20% 80%", "245,180,150", 0.14, 0.04, 65),
  radial("90% 100%", "60% 95%", "250,200,170", 0.10, 0.03, 70),
  radial("80% 80%", "10% 20%", "240,150,90", 0.08, 0.02, 60),
];

const linenAmb = [
  spot(400, "24% 24%", "176,132,74", 0.20),
  spot(340, "80% 70%", "202,160,104", 0.18),
  spot(260, "58% 96%", "146,112,64", 0.13),
  radial("140% 100%", "25% 25%", "180,140,90", 0.14, 0.04, 70),
  radial("110% 100%", "80% 75%", "210,170,120", 0.11, 0.03, 65),
  radial("90% 110%", "60% 95%", "150,120,80", 0.09, 0.025, 60),
  radial("80% 90%", "10% 5%", "200,160,100", 0.07, 0.02, 55),
];

const sakuraAmb = [
  spot(400, "22% 26%", "232,128,182", 0.20),
  spot(340, "78% 68%", "178,134,226", 0.18),
  spot(260, "54% 96%", "244,170,204", 0.13),
  radial("130% 100%", "20% 30%", "230,140,190", 0.14, 0.04, 70),
  radial("100% 110%", "80% 70%", "190,150,230", 0.12, 0.035, 65),
  radial("90% 100%", "55% 95%", "240,180,210", 0.10, 0.03, 70),
  radial("80% 80%", "95% 10%", "220,200,240", 0.08, 0.025, 60),
];

const skyAmb = [
  spot(420, "24% 22%", "84,162,236", 0.30),
  spot(340, "82% 70%", "120,184,238", 0.26),
  spot(260, "50% 96%", "168,214,246", 0.13),
  radial("130% 100%", "25% 25%", "100,170,235", 0.16, 0.045, 70),
  radial("100% 110%", "85% 75%", "150,200,240", 0.12, 0.035, 65),
  radial("90% 100%", "50% 95%", "180,220,245", 0.10, 0.03, 70),
  radial("80% 80%", "5% 95%", "120,190,235", 0.08, 0.025, 60),
];

const chalkAmb = [
  spot(400, "28% 26%", "70,70,96", 0.09),
  spot(340, "80% 70%", "88,88,112", 0.07),
  spot(260, "52% 96%", "50,50,72", 0.06),
  radial("130% 100%", "30% 30%", "60,60,80", 0.05, 0.015, 70),
  radial("100% 100%", "80% 75%", "80,80,100", 0.04, 0.01, 65),
  radial("80% 110%", "50% 95%", "40,40,60", 0.04, 0.01, 70),
];

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
    primary: "#5a5550", secondary: "#3a3530",
    bgDefault: "#f5f1e8", bgPaper: "#fffdf6",
    ambient: paperAmb, overlay: lightOverlay,
  },
  {
    id: "fresh", mode: "light", mood: "🍃",
    name: { ru: "Свежесть", en: "Fresh" },
    description: { ru: "Утренняя зелень", en: "Morning greens" },
    primary: "#2E7D6F", secondary: "#3E8A78",
    bgDefault: "#e6efe8", bgPaper: "#f7fbf8",
    ambient: freshAmb, overlay: lightOverlay,
  },
  {
    id: "morning", mode: "light", mood: "☀️",
    name: { ru: "Утро", en: "Morning" },
    description: { ru: "Тёплый старт", en: "Warm start" },
    primary: "#C46A22", secondary: "#A85618",
    bgDefault: "#fce5ce", bgPaper: "#fff8f0",
    ambient: morningAmb, overlay: lightOverlay,
  },
  {
    id: "linen", mode: "light", mood: "🌾",
    name: { ru: "Лён", en: "Linen" },
    description: { ru: "Натуральный покой", en: "Natural calm" },
    primary: "#8A7250", secondary: "#6F5B3F",
    bgDefault: "#f0e8d6", bgPaper: "#fcf8ed",
    ambient: linenAmb, overlay: lightOverlay,
  },
  {
    id: "sakura", mode: "light", mood: "🌸",
    name: { ru: "Сакура", en: "Sakura" },
    description: { ru: "Нежность", en: "Tenderness" },
    primary: "#A85578", secondary: "#8F4564",
    bgDefault: "#f1e2ea", bgPaper: "#fdf6f9",
    ambient: sakuraAmb, overlay: lightOverlay,
  },
  {
    id: "sky", mode: "light", mood: "☁",
    name: { ru: "Небо", en: "Sky" },
    description: { ru: "Открытость", en: "Openness" },
    primary: "#3D6BA8", secondary: "#305790",
    bgDefault: "#d9e6f6", bgPaper: "#f6fafe",
    ambient: skyAmb, overlay: lightOverlay,
  },
  {
    id: "chalk", mode: "light", mood: "🧊",
    name: { ru: "Мел", en: "Chalk" },
    description: { ru: "Без отвлечений", en: "No distractions" },
    primary: "#2A2A2A", secondary: "#4A4A4A",
    bgDefault: "#e8e8e8", bgPaper: "#f8f8f8",
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

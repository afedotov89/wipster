/**
 * Per-theme scene compositions: hand-curated SVG vignettes that combine with
 * ambient gradients to evoke a specific atmosphere. Each scene is an ordered
 * list of layers (topmost first) merged into the body background-image stack
 * on top of the ambient gradients.
 */

export interface SceneLayer {
  /** Full `url("data:image/svg+xml,...")` value */
  image: string;
  /** CSS background-position (default 'center') */
  position?: string;
  /** CSS background-size (default 'cover') */
  size?: string;
  /** CSS background-repeat (default 'no-repeat') */
  repeat?: string;
}

function svgUrl(svg: string): string {
  const min = svg.replace(/\n+/g, " ").replace(/\s{2,}/g, " ").trim();
  return `url("data:image/svg+xml,${encodeURIComponent(min)}")`;
}

// ============================================================
// No perfect repeats
//
// Every texture here is built from noise, including the man-made ones. A
// mathematically even grid is the single clearest tell of a fake material:
// real cloth has threads of uneven thickness that wander and bunch, real paper
// has fibres that clump, a real board has been wiped unevenly. A CSS
// `repeating-linear-gradient` weave rendered at 11px read as graph paper, not
// linen, however faint it was made.
//
// Realism therefore comes from the noise TYPE and its anisotropy: "turbulence"
// creases at every zero crossing and so gives filaments (threads, scratches),
// while "fractalNoise" stays smooth and gives masses (clouds, dapple, haze).
// ============================================================

/**
 * Procedural noise texture, rendered as ONE full-viewport layer (like the scene
 * SVGs) — never tiled.
 *
 * - `freq` sets the form, per axis. Equal values give blobs; x≪y gives
 *   horizontal banding, x≫y vertical streaks. Values are in the 1600×1000
 *   userspace, so 0.004 ≈ 250-unit features and 1.0 ≈ single-pixel grain.
 * - `octaves` adds fractal detail (fewer = smoother, cloudier).
 * - `contrast` shapes the distribution: below ~0.8 it stays a soft even wash,
 *   above ~1.5 the troughs clip away and only peaks survive as distinct masses.
 * - `strength` is the PEAK opacity and a hard ceiling — the texture can never
 *   render stronger than this, whatever the contrast. Capping the peak rather
 *   than the mean is the whole point: with a mean-based knob, raising contrast
 *   quietly pushed peaks toward full opacity and turned quiet textures into
 *   camouflage.
 * - `bias` is where the noise sits before contrast spreads it, and therefore how
 *   MUCH of the field is covered. 0.5 (default) covers about half — an even
 *   wash. Lower values cover less: 0.28 gives a partly-clouded sky, and a
 *   negative bias leaves only the far tail visible, which is how a sparse
 *   starfield is made rather than a field of grey crumbs.
 * - `fade` masks the layer out towards one edge, so a texture can sit where its
 *   subject belongs (clouds up in the sky, ripples away from the horizon).
 *
 * Why full-viewport instead of a repeating tile: WebKit (Tauri's WKWebView)
 * does not honour `stitchTiles="stitch"` reliably, so any tiled feTurbulence
 * shows seams. A single non-repeating layer has no seams by construction.
 */
function noiseTexture(o: {
  freq: number | string; octaves: number;
  r: number; g: number; b: number;
  strength: number; contrast?: number; bias?: number; seed?: number;
  fade?: "top" | "bottom";
  /**
   * "fractalNoise" (default) is smooth and cloud-like. "turbulence" is the
   * absolute value of the same field, so it creases sharply at every zero
   * crossing — that filamentary structure is what makes threads and scratches
   * read as fibres instead of as a soft gradient.
   */
  type?: "fractalNoise" | "turbulence";
}): string {
  const c = o.contrast ?? 0.7;
  // Re-centre the summed channels on `bias` before the rect's own opacity scales
  // the range down to `strength`. The two noise types sit at different means:
  // fractalNoise averages ~0.5 per channel (sum 1.5), while turbulence is the
  // absolute value of the same field and so averages only ~0.25 (sum 0.75).
  // Using one constant for both drove every turbulence layer below zero, i.e.
  // fully transparent.
  const mean = o.type === "turbulence" ? 0.75 : 1.5;
  const offset = ((o.bias ?? 0.5) - mean * c).toFixed(3);
  const mask = o.fade
    ? `<mask id="f"><linearGradient id="fg" x1="0" y1="0" x2="0" y2="1">
         <stop offset="0%" stop-color="${o.fade === "top" ? "#fff" : "#000"}"/>
         <stop offset="100%" stop-color="${o.fade === "top" ? "#000" : "#fff"}"/>
       </linearGradient><rect width="1600" height="1000" fill="url(#fg)"/></mask>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">
    <defs>${mask}</defs>
    <!--
      color-interpolation-filters must be pinned. The SVG default is linearRGB,
      and WebKit and Blink disagree on how a filter-generated layer lands in it:
      the identical texture rendered as a pale cream weave in Chrome and a
      near-opaque dark olive one in WebKit, which is what Tauri actually runs.
      Forcing sRGB makes the two engines agree, so calibration transfers.
    -->
    <filter id="n" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
      <feTurbulence type="${o.type ?? "fractalNoise"}" baseFrequency="${o.freq}" numOctaves="${o.octaves}" seed="${o.seed ?? 2}"/>
      <feColorMatrix type="matrix" values="
        0 0 0 0 ${o.r}
        0 0 0 0 ${o.g}
        0 0 0 0 ${o.b}
        ${c} ${c} ${c} 0 ${offset}
      "/>
    </filter>
    <rect width="1600" height="1000" filter="url(#n)" opacity="${o.strength}"${o.fade ? ' mask="url(#f)"' : ""}/>
  </svg>`;
}

// ============================================================
// DARK SCENES
// ============================================================

/** Midnight — moon glow with faint star dust, blurred well below "countable" */
const midnightSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">
  <defs>
    <radialGradient id="moon" cx="0.85" cy="0.18" r="0.3">
      <stop offset="0%" stop-color="#c8d4ff" stop-opacity="0.22"/>
      <stop offset="40%" stop-color="#a0b0e8" stop-opacity="0.08"/>
      <stop offset="100%" stop-color="#a0b0e8" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="distant" cx="0.2" cy="0.85" r="0.45">
      <stop offset="0%" stop-color="#7c9eff" stop-opacity="0.08"/>
      <stop offset="100%" stop-color="#7c9eff" stop-opacity="0"/>
    </radialGradient>
    <filter id="starBlur"><feGaussianBlur stdDeviation="4"/></filter>
  </defs>
  <rect width="1600" height="1000" fill="url(#moon)"/>
  <rect width="1600" height="1000" fill="url(#distant)"/>
  <g fill="#cfd8ff" filter="url(#starBlur)" opacity="0.22">
    <circle cx="180" cy="80" r="2"/>
    <circle cx="340" cy="160" r="2.5"/>
    <circle cx="500" cy="100" r="2"/>
    <circle cx="660" cy="220" r="2.5"/>
    <circle cx="820" cy="120" r="2"/>
    <circle cx="980" cy="200" r="2.5"/>
    <circle cx="1140" cy="80" r="2"/>
    <circle cx="1300" cy="180" r="2.5"/>
    <circle cx="240" cy="320" r="2"/>
    <circle cx="440" cy="400" r="2.5"/>
    <circle cx="620" cy="350" r="2"/>
    <circle cx="800" cy="430" r="2"/>
    <circle cx="980" cy="380" r="2.5"/>
    <circle cx="1180" cy="450" r="2"/>
    <circle cx="1360" cy="340" r="2.5"/>
  </g>
</svg>`;

/** Forest — soft dark depth at bottom, no objects */
const forestSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMax slice">
  <defs>
    <linearGradient id="depth" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0a1b0e" stop-opacity="0"/>
      <stop offset="60%" stop-color="#0a1b0e" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#0a1b0e" stop-opacity="0.55"/>
    </linearGradient>
    <radialGradient id="canopy" cx="0.5" cy="0.4" r="0.55">
      <stop offset="0%" stop-color="#5e8c4a" stop-opacity="0.12"/>
      <stop offset="100%" stop-color="#5e8c4a" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1600" height="1000" fill="url(#canopy)"/>
  <rect width="1600" height="1000" fill="url(#depth)"/>
</svg>`;

/** Sunset — warm horizontal band, no objects */
const sunsetSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">
  <defs>
    <radialGradient id="warmBand" cx="0.5" cy="0.7" r="0.5">
      <stop offset="0%" stop-color="#ffb070" stop-opacity="0.32"/>
      <stop offset="50%" stop-color="#d9824a" stop-opacity="0.14"/>
      <stop offset="100%" stop-color="#d9824a" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="seaDepth" x1="0" y1="0.7" x2="0" y2="1">
      <stop offset="0%" stop-color="#1a0d0a" stop-opacity="0"/>
      <stop offset="100%" stop-color="#1a0d0a" stop-opacity="0.45"/>
    </linearGradient>
  </defs>
  <rect width="1600" height="1000" fill="url(#warmBand)"/>
  <rect width="1600" height="1000" fill="url(#seaDepth)"/>
</svg>`;

/** Aurora — flowing curtain of color */
const auroraSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">
  <defs>
    <linearGradient id="auroraA" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#a78bfa" stop-opacity="0"/>
      <stop offset="35%" stop-color="#a78bfa" stop-opacity="0.35"/>
      <stop offset="65%" stop-color="#7dd3fc" stop-opacity="0.25"/>
      <stop offset="100%" stop-color="#7dd3fc" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="auroraB" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#c084fc" stop-opacity="0"/>
      <stop offset="40%" stop-color="#c084fc" stop-opacity="0.3"/>
      <stop offset="80%" stop-color="#5eead4" stop-opacity="0.2"/>
      <stop offset="100%" stop-color="#5eead4" stop-opacity="0"/>
    </linearGradient>
    <filter id="softBlur" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="40"/>
    </filter>
  </defs>
  <g filter="url(#softBlur)">
    <path d="M -50,0 Q 200,200 300,400 T 250,800 L 450,800 Q 500,600 400,400 T 250,0 Z" fill="url(#auroraA)"/>
    <path d="M 700,0 Q 900,300 850,500 T 950,900 L 1150,900 Q 1100,600 1050,400 T 900,0 Z" fill="url(#auroraB)"/>
    <path d="M 1300,0 Q 1450,250 1400,500 T 1500,1000 L 1650,1000 Q 1620,600 1550,300 T 1500,0 Z" fill="url(#auroraA)"/>
  </g>
</svg>`;

/** Ocean — soft depth gradient + faint wave hints */
const oceanSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">
  <defs>
    <linearGradient id="depth" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#4dd0e1" stop-opacity="0.18"/>
      <stop offset="40%" stop-color="#26a6b8" stop-opacity="0.08"/>
      <stop offset="100%" stop-color="#0a1f2e" stop-opacity="0.4"/>
    </linearGradient>
    <radialGradient id="lightShaft" cx="0.5" cy="0" r="0.6">
      <stop offset="0%" stop-color="#a8e8f0" stop-opacity="0.25"/>
      <stop offset="100%" stop-color="#a8e8f0" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1600" height="1000" fill="url(#depth)"/>
  <rect width="1600" height="600" fill="url(#lightShaft)"/>
  <g stroke="#a8e8f0" fill="none" stroke-width="0.6" opacity="0.06">
    <path d="M 0,380 Q 400,395 800,385 T 1600,385"/>
    <path d="M 0,540 Q 400,530 800,540 T 1600,540"/>
    <path d="M 0,700 Q 400,715 800,705 T 1600,705"/>
  </g>
</svg>`;

/** Candle — warm pool of light from below, no candle object */
const candleSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMax slice">
  <defs>
    <radialGradient id="pool" cx="0.5" cy="1" r="0.55">
      <stop offset="0%" stop-color="#ffcc70" stop-opacity="0.32"/>
      <stop offset="35%" stop-color="#f9bd6a" stop-opacity="0.14"/>
      <stop offset="100%" stop-color="#f9bd6a" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="poolCore" cx="0.5" cy="0.98" r="0.25">
      <stop offset="0%" stop-color="#ffe0a0" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="#ffe0a0" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="vignette" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0a0604" stop-opacity="0.4"/>
      <stop offset="50%" stop-color="#0a0604" stop-opacity="0.05"/>
      <stop offset="100%" stop-color="#0a0604" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="1600" height="1000" fill="url(#vignette)"/>
  <rect width="1600" height="1000" fill="url(#pool)"/>
  <rect width="1600" height="1000" fill="url(#poolCore)"/>
</svg>`;

/** Mint — soft dappled light through canopy */
const mintSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">
  <defs>
    <radialGradient id="dappleA" cx="0.3" cy="0.35" r="0.45">
      <stop offset="0%" stop-color="#7ec896" stop-opacity="0.14"/>
      <stop offset="100%" stop-color="#7ec896" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="dappleB" cx="0.75" cy="0.65" r="0.4">
      <stop offset="0%" stop-color="#a8d8b8" stop-opacity="0.1"/>
      <stop offset="100%" stop-color="#a8d8b8" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1600" height="1000" fill="url(#dappleA)"/>
  <rect width="1600" height="1000" fill="url(#dappleB)"/>
</svg>`;

/** Graphite — pure focus spot, no decoration */
const graphiteSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">
  <defs>
    <radialGradient id="spot" cx="0.5" cy="0.5" r="0.45">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.025"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1600" height="1000" fill="url(#spot)"/>
</svg>`;

// ============================================================
// LIGHT SCENES
// ============================================================

/** Paper — warm glow only; the sheet's character comes from its fibre layers */
const paperLightSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">
  <defs>
    <radialGradient id="warmth" cx="0.7" cy="0.3" r="0.6">
      <stop offset="0%" stop-color="#c8a878" stop-opacity="0.10"/>
      <stop offset="100%" stop-color="#c8a878" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1600" height="1000" fill="url(#warmth)"/>
</svg>`;

/** Fresh — green dappled glow */
const freshLightSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">
  <defs>
    <radialGradient id="freshA" cx="0.3" cy="0.3" r="0.55">
      <stop offset="0%" stop-color="#7ec896" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#7ec896" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="freshB" cx="0.75" cy="0.7" r="0.5">
      <stop offset="0%" stop-color="#a8d8b8" stop-opacity="0.16"/>
      <stop offset="100%" stop-color="#a8d8b8" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1600" height="1000" fill="url(#freshA)"/>
  <rect width="1600" height="1000" fill="url(#freshB)"/>
</svg>`;

/** Morning — soft warm glow from upper-left corner */
const morningLightSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">
  <defs>
    <radialGradient id="sunGlow" cx="0.15" cy="0.05" r="0.55">
      <stop offset="0%" stop-color="#ffeac0" stop-opacity="0.55"/>
      <stop offset="40%" stop-color="#f5c890" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="#f5c890" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="warmFar" cx="0.85" cy="0.85" r="0.4">
      <stop offset="0%" stop-color="#f5b078" stop-opacity="0.15"/>
      <stop offset="100%" stop-color="#f5b078" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1600" height="1000" fill="url(#sunGlow)"/>
  <rect width="1600" height="1000" fill="url(#warmFar)"/>
</svg>`;

/** Morning — soft diagonal sun-rays fanning from the upper-left corner */
const sunRaysSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">
  <defs>
    <linearGradient id="ray" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#fff1d4" stop-opacity="0.85"/>
      <stop offset="75%" stop-color="#ffe3b0" stop-opacity="0.12"/>
      <stop offset="100%" stop-color="#ffe3b0" stop-opacity="0"/>
    </linearGradient>
    <filter id="rayBlur" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="26"/>
    </filter>
  </defs>
  <g filter="url(#rayBlur)" opacity="0.7">
    <polygon points="60,-40 300,1000 540,1000" fill="url(#ray)"/>
    <polygon points="60,-40 720,1000 1000,1000" fill="url(#ray)"/>
    <polygon points="60,-40 1180,1000 1480,1000" fill="url(#ray)"/>
    <polygon points="60,-40 1600,320 1600,560" fill="url(#ray)"/>
    <polygon points="60,-40 1600,680 1600,920" fill="url(#ray)"/>
  </g>
</svg>`;

// Sakura — a soft rose mottle instead of individual petals: large, low-contrast
// blotches that read as a warm wash of colour, never as a shape to look at.
const sakuraMist = noiseTexture({ freq: 0.004, octaves: 3, r: 0.72, g: 0.38, b: 0.55, strength: 0.13, contrast: 0.9, seed: 13 });

// Linen — a real weave, built the way cloth is actually made.
//
// `turbulence` gives each thread a crisp edge and, crucially, an uneven
// thickness along its length: that is the slub that separates linen from graph
// paper. Warp runs vertical (fine detail across x, smooth along y), weft is the
// mirror, and a slow density field on top makes the cloth bunch in patches the
// way a woven bolt does.
const linenWarp = noiseTexture({ freq: "0.45 0.007", octaves: 1, type: "turbulence", r: 0.42, g: 0.32, b: 0.18, strength: 0.20, contrast: 1.25, bias: 0.30, seed: 3 });
const linenWeft = noiseTexture({ freq: "0.007 0.45", octaves: 1, type: "turbulence", r: 0.42, g: 0.32, b: 0.18, strength: 0.20, contrast: 1.25, bias: 0.30, seed: 8 });
const linenSlub = noiseTexture({ freq: "0.02 0.016", octaves: 2, r: 0.5, g: 0.4, b: 0.24, strength: 0.07, contrast: 0.9, seed: 9 });

/** Sakura — soft pink-lavender wash */
const sakuraLightSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">
  <defs>
    <radialGradient id="rose" cx="0.3" cy="0.3" r="0.55">
      <stop offset="0%" stop-color="#e8a8c0" stop-opacity="0.16"/>
      <stop offset="100%" stop-color="#e8a8c0" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="lavender" cx="0.75" cy="0.7" r="0.5">
      <stop offset="0%" stop-color="#c8b0e0" stop-opacity="0.14"/>
      <stop offset="100%" stop-color="#c8b0e0" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1600" height="1000" fill="url(#rose)"/>
  <rect width="1600" height="1000" fill="url(#lavender)"/>
</svg>`;

/** Sky — light hazing out towards the top, no cloud shapes */
const skyLightSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMin slice">
  <defs>
    <linearGradient id="haze" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.12"/>
      <stop offset="45%" stop-color="#ffffff" stop-opacity="0.04"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="1600" height="1000" fill="url(#haze)"/>
</svg>`;

// ============================================================
// Organic textures — the natural themes' answer to a pattern
//
// Each is fractal noise shaped into the subject of its theme. Two dials do the
// work: FREQUENCY per axis sets the form (equal = blobs, x≪y = horizontal
// banding, x≫y = vertical streaks) and CONTRAST sets how hard it reads (below
// ~0.8 the noise stays a soft wash; above ~1.4 the low end clips to transparent
// and the peaks survive as distinct soft masses — which is exactly how clouds
// are rendered procedurally).
// ============================================================

/**
 * Billowing cloud banks: high contrast makes the troughs fall away entirely and
 * leaves puffy masses with feathered edges — clouds, not haze, and with no
 * countable silhouette because they merge into one another.
 */
const clouds = (freq: string, strength: number, bias: number, seed: number) =>
  noiseTexture({ freq, octaves: 4, r: 1, g: 1, b: 1, strength, contrast: 2.0, bias, seed });

/**
 * Sky — two cloud scales for depth: a high, thinner veil above nearer banks.
 * Bias below 0.5 keeps the sky partly clouded rather than overcast.
 */
const skyCloudsHigh = clouds("0.0075 0.013", 0.14, 0.20, 21);
const skyCloudsLow = clouds("0.0026 0.0055", 0.19, 0.26, 22);

/** Ocean — light rippling on water: long in x, tight in y. */
const oceanRipples = noiseTexture({ freq: "0.0035 0.05", octaves: 3, r: 0.72, g: 0.95, b: 1, strength: 0.05, contrast: 1.1, seed: 33, fade: "top" });
// A second, finer train crossing the first: still water reads flat, real water
// is two wave systems interfering, and the crests are where light glints.
const oceanGlints = noiseTexture({ freq: "0.012 0.13", octaves: 2, type: "turbulence", r: 0.85, g: 1, b: 1, strength: 0.05, contrast: 1.6, bias: 0.1, seed: 34, fade: "top" });

/** Midnight — star dust: only the far tail of fine noise survives, so specks stay sparse. */
const starDust = noiseTexture({ freq: 1.2, octaves: 1, r: 0.85, g: 0.9, b: 1, strength: 0.6, contrast: 4.0, bias: -1.7, seed: 51 });

/** Sunset — haze layered along the horizon. */
const sunsetHaze = noiseTexture({ freq: "0.0022 0.016", octaves: 3, r: 1, g: 0.72, b: 0.5, strength: 0.05, contrast: 1.0, seed: 52 });

/** Aurora — vertical shimmer, tall streaks echoing the curtains. */
const auroraShimmer = noiseTexture({ freq: "0.012 0.002", octaves: 3, r: 0.75, g: 0.85, b: 1, strength: 0.045, contrast: 0.9, seed: 53 });

/** Candle — the unsteady warm pool a flame throws. */
const candleFlicker = noiseTexture({ freq: 0.005, octaves: 3, r: 1, g: 0.78, b: 0.45, strength: 0.06, contrast: 1.0, seed: 54, fade: "bottom" });

/** Graphite — brushed metal: long horizontal streaks, barely there. */
const brushed = noiseTexture({ freq: "0.003 0.9", octaves: 1, type: "turbulence", r: 1, g: 1, b: 1, strength: 0.05, contrast: 1.3, bias: 0.2, seed: 55 });

/** Forest / Mint — light broken by a canopy overhead. */
const canopyDapple = (r: number, g: number, b: number, strength: number, seed: number) =>
  noiseTexture({ freq: "0.010 0.013", octaves: 4, type: "turbulence", r, g, b, strength, contrast: 1.15, bias: 0.35, seed });

/** Fine filament structure — the detail layer that keeps a surface from reading as blur. */
const filaments = (freq: string, r: number, g: number, b: number, strength: number, seed: number) =>
  noiseTexture({ freq, octaves: 2, type: "turbulence", r, g, b, strength, contrast: 1.4, bias: 0.15, seed });

/** Chalk — subtle center dust */
const chalkLightSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">
  <defs>
    <radialGradient id="dust" cx="0.5" cy="0.5" r="0.4">
      <stop offset="0%" stop-color="#000000" stop-opacity="0.025"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1600" height="1000" fill="url(#dust)"/>
</svg>`;

// Per-theme surface textures. The rule: a texture may give the surface a
// character you can feel, but never an object you can point at — no leaves,
// petals or clouds competing with the tasks for attention. Anything with a
// silhouette is expressed as soft mottling or grain instead.

// Fresh — dappled light under a canopy: large soft green blotches, the shadow
// pattern leaves cast rather than the leaves themselves.
const freshDapple = noiseTexture({ freq: 0.0035, octaves: 3, r: 0.24, g: 0.48, b: 0.33, strength: 0.13, contrast: 0.9, seed: 41 });

// Chalk — the fine dust left on a wiped board, no strokes to read.
const chalkDust = noiseTexture({ freq: 0.5, octaves: 2, r: 0.36, g: 0.36, b: 0.42, strength: 0.16, contrast: 0.7, seed: 62 });
// The smear a cloth leaves: long, soft horizontal sweeps of leftover chalk.
const chalkWipe = noiseTexture({ freq: "0.0025 0.03", octaves: 2, r: 1, g: 1, b: 1, strength: 0.10, contrast: 1.1, bias: 0.35, seed: 63 });

/**
 * Shared surface layers every theme gets, so nothing is ever a flat wash:
 * `mottle` are slow, large colour blotches (visible depth) and `grain` is fine
 * tactile noise (visible only as "not perfectly smooth").
 */
const mottle = (r: number, g: number, b: number, strength: number, seed: number) =>
  noiseTexture({ freq: 0.005, octaves: 5, r, g, b, strength, contrast: 0.85, seed });

// Light grain on a dark ground reads far louder than the reverse — at equal
// strength it turns into speckle instead of texture, so keep it finer and fainter.
const grainLight = noiseTexture({ freq: 1.0, octaves: 2, r: 1, g: 1, b: 1, strength: 0.030, contrast: 0.45, seed: 77 });
const grainDark = noiseTexture({ freq: 0.7, octaves: 2, r: 0.15, g: 0.13, b: 0.1, strength: 0.055, contrast: 0.45, seed: 78 });


const paperFibers = noiseTexture({ freq: "0.30 0.42", octaves: 1, type: "turbulence", r: 0.45, g: 0.37, b: 0.24, strength: 0.14, contrast: 1.2, bias: 0.5, seed: 65 });
// "Formation": the uneven fibre density of a real sheet, visible as faint
// cloudiness when paper is held up to the light. Without it a sheet reads as
// flat card stock.
const paperFormation = noiseTexture({ freq: 0.02, octaves: 3, r: 0.48, g: 0.4, b: 0.28, strength: 0.09, contrast: 0.9, seed: 64 });

// ============================================================
// Scene table — top layers first
// ============================================================

/**
 * Every theme stacks, topmost first: its own subject texture, fine grain, then
 * its scene glow — over the ambient gradients from `themes.ts`.
 *
 * The texture is always OF the theme, never a generic decoration: Sky gets
 * clouds, Ocean gets ripples, Midnight star dust, Linen an actual weave. Even
 * the man-made surfaces are built from noise rather than a geometric repeat —
 * see the note at the top of this file for why.
 */
export const SCENES: Record<string, SceneLayer[]> = {
  // --- dark ---
  // Мята — steady focus: soft canopy dapple, nothing that pulls the eye
  mint: [
    { image: svgUrl(filaments("0.022 0.026", 0.55, 0.85, 0.72, 0.035, 201)) },
    { image: svgUrl(canopyDapple(0.35, 0.62, 0.5, 0.05, 11)) },
    { image: svgUrl(grainLight) },
    { image: svgUrl(mottle(0.35, 0.62, 0.5, 0.045, 111)) },
    { image: svgUrl(mintSvg) },
  ],
  // Полночь — star dust over the moon glow
  midnight: [
    { image: svgUrl(starDust) },
    { image: svgUrl(grainLight) },
    { image: svgUrl(mottle(0.42, 0.5, 0.85, 0.05, 12)) },
    { image: svgUrl(midnightSvg) },
  ],
  // Лес — deeper, more broken dapple than Mint; light through branches
  forest: [
    { image: svgUrl(filaments("0.03 0.003", 0.6, 0.8, 0.5, 0.04, 202)) },
    { image: svgUrl(canopyDapple(0.42, 0.62, 0.34, 0.07, 14)) },
    { image: svgUrl(grainLight) },
    { image: svgUrl(mottle(0.4, 0.6, 0.35, 0.05, 114)) },
    { image: svgUrl(forestSvg), position: "center bottom" },
  ],
  // Закат — haze stacked along the horizon
  sunset: [
    { image: svgUrl(sunsetHaze) },
    { image: svgUrl(grainLight) },
    { image: svgUrl(mottle(0.9, 0.55, 0.35, 0.055, 15)) },
    { image: svgUrl(sunsetSvg) },
  ],
  // Сияние — vertical shimmer running with the curtains
  aurora: [
    { image: svgUrl(auroraShimmer) },
    { image: svgUrl(grainLight) },
    { image: svgUrl(mottle(0.65, 0.5, 0.95, 0.055, 16)) },
    { image: svgUrl(auroraSvg) },
  ],
  // Океан — light rippling across the surface
  ocean: [
    { image: svgUrl(oceanGlints) },
    { image: svgUrl(oceanRipples) },
    { image: svgUrl(grainLight) },
    { image: svgUrl(mottle(0.3, 0.72, 0.82, 0.05, 17)) },
    { image: svgUrl(oceanSvg) },
  ],
  // Свеча — the flame's unsteady warm pool
  candle: [
    { image: svgUrl(filaments("0.03 0.032", 1, 0.82, 0.55, 0.035, 203)) },
    { image: svgUrl(candleFlicker) },
    { image: svgUrl(grainLight) },
    { image: svgUrl(mottle(0.95, 0.7, 0.4, 0.05, 18)) },
    { image: svgUrl(candleSvg), position: "center bottom" },
  ],
  // Графит — brushed metal, and deliberately nothing else
  graphite: [
    { image: svgUrl(brushed) },
    { image: svgUrl(grainLight) },
    { image: svgUrl(graphiteSvg) },
  ],

  // --- light --- (texture goes ABOVE the glow so it sits on top of it)
  // Бумага — a made surface: dotted rule over its own fibres
  paper: [
    { image: svgUrl(paperFibers) },
    { image: svgUrl(grainDark) },
    { image: svgUrl(paperFormation) },
    { image: svgUrl(paperLightSvg) },
  ],
  // Лён — a made surface: woven grid over thread grain
  linen: [
    { image: svgUrl(linenWarp) },
    { image: svgUrl(linenWeft) },
    { image: svgUrl(grainDark) },
    { image: svgUrl(linenSlub) },
  ],
  // Мел — a made surface: the squared board under its dust
  chalk: [
    { image: svgUrl(chalkDust) },
    { image: svgUrl(grainDark) },
    { image: svgUrl(chalkWipe) },
    { image: svgUrl(chalkLightSvg) },
  ],
  // Свежесть — morning light broken by leaves overhead
  fresh: [
    { image: svgUrl(filaments("0.018 0.022", 0.16, 0.42, 0.28, 0.05, 204)) },
    { image: svgUrl(canopyDapple(0.24, 0.48, 0.33, 0.07, 41)) },
    { image: svgUrl(grainDark) },
    { image: svgUrl(freshDapple) },
    { image: svgUrl(freshLightSvg) },
  ],
  // Утро — low sun: beams plus the warm haze they travel through
  morning: [
    { image: svgUrl(filaments("0.010 0.030", 0.7, 0.42, 0.16, 0.045, 205)) },
    { image: svgUrl(mottle(0.85, 0.55, 0.25, 0.12, 31)) },
    { image: svgUrl(grainDark) },
    { image: svgUrl(sunRaysSvg) },
    { image: svgUrl(morningLightSvg) },
  ],
  // Сакура — a drift of colour in the air, no petals to count
  sakura: [
    { image: svgUrl(filaments("0.020 0.026", 0.62, 0.3, 0.46, 0.045, 206)) },
    { image: svgUrl(sakuraMist) },
    { image: svgUrl(grainDark) },
    { image: svgUrl(sakuraLightSvg) },
  ],
  // Небо — actual clouds: two scales, high veil over nearer banks
  sky: [
    { image: svgUrl(skyCloudsHigh) },
    { image: svgUrl(skyCloudsLow) },
    { image: svgUrl(grainDark) },
    { image: svgUrl(skyLightSvg), position: "center top" },
  ],
};

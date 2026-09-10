/** Longest side of a stored icon, in pixels. */
const ICON_SIZE = 64;

/** Refuse anything a project row has no business carrying. */
const MAX_SOURCE_BYTES = 4 * 1024 * 1024;
const MAX_SVG_BYTES = 64 * 1024;

/**
 * Turn a picked file into something a project row can carry: a small square
 * data URL.
 *
 * Raster images are redrawn at 64px — three times the size they are shown at,
 * so they stay sharp on a retina screen while the stored string stays a few
 * kilobytes. SVG is kept as it is, because it is already resolution-independent
 * and rasterising it would only lose quality. It travels inside an `img`/CSS
 * mask, where a document's scripts never run.
 */
export async function normalizeIcon(file: File): Promise<string> {
  if (file.size > MAX_SOURCE_BYTES) throw new Error("TOO_LARGE");
  if (!file.type.startsWith("image/")) throw new Error("NOT_AN_IMAGE");

  if (file.type === "image/svg+xml") {
    if (file.size > MAX_SVG_BYTES) throw new Error("TOO_LARGE");
    return await readAsDataUrl(file);
  }

  const source = await readAsDataUrl(file);
  const image = await loadImage(source);

  const canvas = document.createElement("canvas");
  canvas.width = ICON_SIZE;
  canvas.height = ICON_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("NOT_AN_IMAGE");

  // Fit inside the square without stretching: a wide logo keeps its shape.
  const scale = Math.min(ICON_SIZE / image.width, ICON_SIZE / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  ctx.drawImage(image, (ICON_SIZE - width) / 2, (ICON_SIZE - height) / 2, width, height);

  return canvas.toDataURL("image/png");
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("UNREADABLE"));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("NOT_AN_IMAGE"));
    image.src = src;
  });
}

/**
 * A picture reduced to its shape, so it can be painted in one colour.
 *
 * A CSS mask uses the alpha channel, which is right for a glyph on a
 * transparent background and useless for the far more common export: black ink
 * on solid white, where every pixel is opaque and the mask comes out as a filled
 * square. For those the shape is taken from contrast instead — whatever differs
 * from the corners is ink — so a logo saved as a flat PNG masks the same as one
 * saved with transparency.
 */
export async function silhouette(dataUrl: string): Promise<string> {
  const cached = silhouettes.get(dataUrl);
  if (cached !== undefined) return cached;

  const result = await buildSilhouette(dataUrl).catch(() => dataUrl);
  silhouettes.set(dataUrl, result);
  return result;
}

/** The already-computed shape, if this image has been through here before. */
export function cachedSilhouette(dataUrl: string): string | undefined {
  return silhouettes.get(dataUrl);
}

const silhouettes = new Map<string, string>();

async function buildSilhouette(dataUrl: string): Promise<string> {
  const image = await loadImage(dataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = ICON_SIZE;
  canvas.height = ICON_SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return dataUrl;

  const scale = Math.min(ICON_SIZE / image.width, ICON_SIZE / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  ctx.drawImage(image, (ICON_SIZE - width) / 2, (ICON_SIZE - height) / 2, width, height);

  const frame = ctx.getImageData(0, 0, ICON_SIZE, ICON_SIZE);
  const pixels = frame.data;

  // An image that already carries transparency needs nothing: its own alpha is
  // the shape the author drew.
  let transparent = 0;
  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i] < 250) transparent += 1;
  }
  if (transparent > pixels.length / 4 / 20) return dataUrl;

  // Otherwise the corners are the background and the ink is what differs.
  const corners = [
    0,
    (ICON_SIZE - 1) * 4,
    (ICON_SIZE - 1) * ICON_SIZE * 4,
    (ICON_SIZE * ICON_SIZE - 1) * 4,
  ];
  const background =
    corners.reduce((sum, i) => sum + luminance(pixels[i], pixels[i + 1], pixels[i + 2]), 0) /
    corners.length;

  for (let i = 0; i < pixels.length; i += 4) {
    const l = luminance(pixels[i], pixels[i + 1], pixels[i + 2]);
    // Dark ink on a light ground, or light ink on a dark one.
    const ink = background > 0.5 ? 1 - l : l;
    pixels[i] = 0;
    pixels[i + 1] = 0;
    pixels[i + 2] = 0;
    pixels[i + 3] = Math.round(Math.min(1, Math.max(0, ink)) * 255);
  }
  ctx.putImageData(frame, 0, 0);
  return canvas.toDataURL("image/png");
}

function luminance(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

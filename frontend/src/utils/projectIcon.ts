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

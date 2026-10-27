import { BrowserQRCodeReader } from "@zxing/browser";
import { DecodeHintType } from "@zxing/library";

/** Decode uploaded/pasted images entirely in memory, including dense QR exports. */
export async function decodeQrImage(file: File): Promise<string> {
  if (
    !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
    file.size > 10_000_000
  )
    throw Error("Choose a PNG, JPEG, or WebP image smaller than 10 MB.");

  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  try {
    if (bitmap.width * bitmap.height > 24_000_000)
      throw Error("Image dimensions are too large.");
    const context = canvas.getContext("2d");
    if (!context) throw Error("Image decoding is unavailable in this browser.");
    const normal = new BrowserQRCodeReader(
      new Map([[DecodeHintType.TRY_HARDER, true]]),
    );
    // Finder-pattern detection can miss dense, otherwise valid export screenshots.
    // PURE_BARCODE samples an upright QR directly; keep normal detection for photos.
    const upright = new BrowserQRCodeReader(
      new Map([
        [DecodeHintType.TRY_HARDER, true],
        [DecodeHintType.PURE_BARCODE, true],
      ]),
    );
    const baseScale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
    for (const scale of [baseScale, baseScale * 0.75, baseScale * 0.5]) {
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const reader of [normal, upright]) {
        try {
          return reader.decodeFromCanvas(canvas).getText();
        } catch {
          /* Try the next bounded decoding strategy. */
        }
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    throw Error(
      "No supported QR code could be read. Try a clearer, cropped image.",
    );
  } finally {
    bitmap.close();
    canvas.width = 0;
    canvas.height = 0;
  }
}

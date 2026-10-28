import { expect, test } from "@playwright/test";
import { Writer } from "protobufjs/minimal.js";
import QRCode from "qrcode";

// Match the sample's shape and density without retaining its account secrets.
function denseExport(): string {
  const payload = Writer.create();
  for (let i = 0; i < 4; i++) {
    const entry = Writer.create()
      .uint32(10)
      .bytes(new Uint8Array(i === 1 ? 10 : 20).fill(49 + i))
      .uint32(18)
      .string(`demo-${i}@example.test`)
      .uint32(26)
      .string(`Synthetic account ${i}`)
      .uint32(32)
      .int32(1)
      .uint32(40)
      .int32(1)
      .uint32(48)
      .int32(2)
      .finish();
    payload.uint32(10).bytes(entry);
  }
  payload.uint32(16).int32(2).uint32(24).int32(1).uint32(32).int32(0);
  return (
    "otpauth-migration://offline?data=" +
    encodeURIComponent(Buffer.from(payload.finish()).toString("base64"))
  );
}

test("dense multi-account QR upload and JPEG paste work offline", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page
    .getByLabel("Master password", { exact: true })
    .fill("synthetic test password");
  await page
    .getByLabel("Confirm master password")
    .fill("synthetic test password");
  await page.getByRole("button", { name: "Create your private vault" }).click();
  await expect(
    page.getByRole("heading", { name: "Your accounts." }),
  ).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
  await context.setOffline(true);
  await page.getByRole("button", { name: "Add account", exact: true }).click();
  // This version/size/mask fails ZXing's normal finder-pattern detection.
  const image = await QRCode.toBuffer(denseExport(), {
    width: 862,
    version: 18,
    margin: 4,
    errorCorrectionLevel: "L",
    maskPattern: 0,
  });
  await page.getByLabel("Upload QR image", { exact: true }).setInputFiles({
    name: "dense-synthetic-export.png",
    mimeType: "image/png",
    buffer: image,
  });
  await expect(
    page.getByRole("heading", { name: "4 supported accounts" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Import 4 new accounts" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Clear preview" }).click();

  // Exercise the shared decoder through image paste with messaging-style JPEG compression.
  await page.evaluate(async (bytes) => {
    const bitmap = await createImageBitmap(
      new Blob([new Uint8Array(bytes)], { type: "image/png" }),
    );
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
    bitmap.close();
    const jpeg = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(Error("JPEG conversion failed")),
        "image/jpeg",
        0.75,
      ),
    );
    canvas.width = 0;
    canvas.height = 0;
    const clipboard = new DataTransfer();
    clipboard.items.add(
      new File([jpeg], "dense-synthetic-export.jpg", { type: "image/jpeg" }),
    );
    const event = new Event("paste", { cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: clipboard });
    document.dispatchEvent(event);
  }, Array.from(image));
  await expect(
    page.getByRole("heading", { name: "4 supported accounts" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Import 4 new accounts" }).click();
  await expect(page.locator(".account-card")).toHaveCount(4);
  for (let i = 0; i < 4; i++)
    await expect(
      page.getByRole("heading", {
        name: `Synthetic account ${i}`,
        exact: true,
      }),
    ).toBeVisible();
  await page.reload();
  await page
    .getByLabel("Master password", { exact: true })
    .fill("synthetic test password");
  await page.getByRole("button", { name: "Unlock vault", exact: true }).click();
  await expect(page.locator(".account-card")).toHaveCount(4);
});

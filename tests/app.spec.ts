import { test, expect, type Page } from "@playwright/test";
import QRCode from "qrcode";
import { Writer } from "protobufjs/minimal.js";
import { generateCode, newAccount } from "../src/model";
const password = "synthetic test password";
const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const uri = `otpauth://totp/Example:demo?secret=${secret}&issuer=Example`;
async function create(page: Page) {
  await page.goto("/");
  await page.getByLabel("Master password", { exact: true }).fill(password);
  await page
    .getByLabel("Confirm master password", { exact: true })
    .fill(password);
  await page.getByRole("button", { name: "Create your private vault" }).click();
  await expect(
    page.getByRole("heading", { name: "Your accounts." }),
  ).toBeVisible();
}
async function unlock(page: Page) {
  await page.getByLabel("Master password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Unlock vault", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Your accounts." }),
  ).toBeVisible();
}
async function add(page: Page) {
  await page.getByRole("button", { name: "Add account", exact: true }).click();
  await page
    .getByLabel("Paste a QR code or an authenticator URI")
    .fill(
      `otpauth://totp/Personal%20email:demo@example.test?secret=${secret}&issuer=Personal%20email`,
    );
  await page.getByRole("button", { name: "Preview import" }).click();
  await page.getByRole("button", { name: "Import 1 new accounts" }).click();
  await expect(
    page.getByRole("heading", { name: "Personal email", exact: true }),
  ).toBeVisible();
}
test("create, CRUD, copy, encrypted persistence and lock", async ({
  page,
  browserName,
  context,
}) => {
  const external: string[] = [];
  page.on("request", (r) => {
    if (!r.url().startsWith("http://localhost:4173")) external.push(r.url());
  });
  await create(page);
  await add(page);
  const code = generateCode(newAccount({ secretBase32: secret }));
  await expect(page.locator(".otp")).toHaveText(
    new RegExp(code.slice(0, 3) + " " + code.slice(3)),
  );
  if (browserName === "chromium") {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page
      .getByRole("button", { name: "Copy code for Personal email" })
      .click();
    await expect(page.getByRole("status")).toContainText("Code copied");
  }
  await page.getByLabel("Options for Personal email").click();
  await page.getByRole("button", { name: "Edit account", exact: true }).click();
  await page.getByLabel("Display label").fill("Work email");
  await page.getByRole("button", { name: "Save account" }).click();
  await expect(page.getByRole("heading", { name: "Work email" })).toBeVisible();
  const persisted = await page.evaluate(async () => {
    const request = indexedDB.open("stillkey");
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const get = db.transaction("vault").objectStore("vault").get("main");
    return new Promise<string>((resolve) => {
      get.onsuccess = () => {
        resolve(JSON.stringify(get.result));
        db.close();
      };
    });
  });
  expect(persisted).toContain("AES-256-GCM");
  expect(persisted).not.toContain(secret);
  expect(persisted).not.toContain("Work email");
  await page.getByRole("button", { name: "Lock vault" }).click();
  await expect(page.getByText("Work email", { exact: true })).toHaveCount(0);
  await page.reload();
  await unlock(page);
  await page.getByLabel("Search accounts").fill("unmatched");
  await expect(
    page.getByRole("heading", { name: "No matching accounts" }),
  ).toBeVisible();
  await page.getByLabel("Search accounts").fill("");
  await page.getByLabel("Options for Work email").click();
  await page
    .getByRole("button", { name: "Delete account", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Make yourself at home." }),
  ).toBeVisible();
  expect(external).toEqual([]);
});
test("offline shell, QR image and clipboard import, backup and recovery", async ({
  page,
  context,
}) => {
  await create(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
  await context.setOffline(true);
  await page.reload();
  await unlock(page);
  await page.getByRole("button", { name: "Add account", exact: true }).click();
  const png = await QRCode.toBuffer(uri, { width: 400 });
  await page.getByLabel("Upload QR image", { exact: true }).setInputFiles({
    name: "synthetic.png",
    mimeType: "image/png",
    buffer: png,
  });
  await expect(
    page.getByRole("heading", { name: "1 supported account" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Import 1 new accounts" }).click();
  await expect(
    page.getByRole("heading", { name: "Example", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add account", exact: true }).click();
  await page.evaluate(async (bytes) => {
    const blob = new Blob([new Uint8Array(bytes)], { type: "image/png" });
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([blob], "clipboard.png", { type: "image/png" }),
    );
    const event = new Event("paste", { cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: transfer });
    document.dispatchEvent(event);
  }, Array.from(png));
  await expect(page.getByText("1 duplicate(s) will be skipped.")).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Back up vault" }).click();
  const backup = await download;
  const path = await backup.path();
  expect(path).toBeTruthy();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Restore backup", exact: true })
    .click();
  await page.getByLabel("Encrypted backup file").setInputFiles(path!);
  await page.getByLabel("Password used for this backup").fill("wrong password");
  await page.getByLabel("I understand").check();
  await page.getByRole("button", { name: "Validate & restore backup" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Unable to unlock",
  );
  await page.getByLabel("Password used for this backup").fill(password);
  await page.getByRole("button", { name: "Validate & restore backup" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Accounts", exact: false })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Example", exact: true }),
  ).toBeVisible();
  await page.reload();
  await unlock(page);
  await expect(
    page.getByRole("heading", { name: "Example", exact: true }),
  ).toBeVisible();
});
function migration(index: number, type = 2) {
  const entry = Writer.create()
    .uint32(10)
    .bytes(new Uint8Array(20).fill(49 + index))
    .uint32(18)
    .string("demo-" + index)
    .uint32(26)
    .string("Migration " + index)
    .uint32(32)
    .int32(1)
    .uint32(40)
    .int32(1)
    .uint32(48)
    .int32(type)
    .finish();
  const bytes = Writer.create()
    .uint32(10)
    .bytes(entry)
    .uint32(16)
    .int32(1)
    .uint32(24)
    .int32(2)
    .uint32(32)
    .int32(index)
    .uint32(40)
    .int32(42)
    .finish();
  return (
    "otpauth-migration://offline?data=" +
    encodeURIComponent(Buffer.from(bytes).toString("base64"))
  );
}
test("migration requires all batch parts and reports HOTP", async ({
  page,
}) => {
  await create(page);
  await page.getByRole("button", { name: "Add account", exact: true }).click();
  await page
    .getByLabel("Paste a QR code or an authenticator URI")
    .fill(migration(0));
  await page.getByRole("button", { name: "Preview import" }).click();
  await expect(
    page.getByRole("button", { name: "Import 1 new accounts" }),
  ).toBeDisabled();
  await page
    .getByLabel("Paste a QR code or an authenticator URI")
    .fill(migration(1, 1));
  await page.getByRole("button", { name: "Preview import" }).click();
  await expect(
    page.getByText(/HOTP \(counter 0\) is not supported/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Import 1 new accounts" }).click();
  await expect(
    page.getByRole("heading", { name: "Migration 0", exact: true }),
  ).toBeVisible();
});
test("password change and background locking", async ({ page }) => {
  await create(page);
  await add(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Change master password", exact: true })
    .click();
  await page.getByLabel("Current password", { exact: true }).fill(password);
  await page
    .getByLabel("New password", { exact: true })
    .fill("another synthetic password");
  await page
    .getByLabel("Confirm new password", { exact: true })
    .fill("another synthetic password");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Change password", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Lock vault" }).click();
  await page.getByLabel("Master password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Unlock vault", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Unable to unlock");
  await page
    .getByLabel("Master password", { exact: true })
    .fill("another synthetic password");
  await page.getByRole("button", { name: "Unlock vault", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Personal email", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Lock when backgrounded").click();
  await expect(page.getByLabel("Lock when backgrounded")).toBeChecked();
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(
    page.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
});
test("responsive layout and keyboard dialog navigation", async ({
  page,
}, info) => {
  await create(page);
  await expect(
    page.getByRole("button", { name: "Import", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Add your first account" }).click();
  await expect(
    page.getByRole("dialog", { name: "Add Account", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await add(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/${info.project.name}-accounts.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Add account", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Add Account", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Display label")).toHaveCount(0);
  await expect(
    page.getByLabel("Paste a QR code or an authenticator URI"),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("backup moves to a separate browser vault; QR export requires confirmation", async ({
  page,
  browser,
}) => {
  await create(page);
  await add(page);
  await page.getByLabel("Options for Personal email").click();
  await page.getByRole("button", { name: "Export QR code" }).click();
  await expect(page.getByAltText("Sensitive account QR code")).toHaveCount(0);
  await page.getByRole("button", { name: "I understand — reveal QR" }).click();
  await expect(page.getByAltText("Sensitive account QR code")).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Back up vault" }).click();
  const backup = await pending,
    path = await backup.path();
  const other = await browser.newContext();
  const fresh = await other.newPage();
  await fresh.goto("http://localhost:4173");
  await fresh.getByLabel("Master password", { exact: true }).fill(password);
  await fresh.getByLabel("Confirm master password").fill(password);
  await fresh
    .getByRole("button", { name: "Create your private vault" })
    .click();
  await fresh.getByRole("button", { name: "Settings", exact: true }).click();
  await fresh
    .getByRole("button", { name: "Restore backup", exact: true })
    .click();
  await fresh.getByLabel("Encrypted backup file").setInputFiles(path!);
  await fresh.getByLabel("Password used for this backup").fill(password);
  await fresh.getByLabel("Restore mode").selectOption("replace");
  await fresh.getByLabel("I understand").check();
  await fresh
    .getByRole("button", { name: "Validate & restore backup" })
    .click();
  await expect(fresh.getByRole("dialog")).toHaveCount(0);
  await fresh
    .getByRole("button", { name: "Accounts", exact: false })
    .first()
    .click();
  await expect(
    fresh.getByRole("heading", { name: "Personal email", exact: true }),
  ).toBeVisible();
  await other.close();
});

test("another tab locks on a vault change and inactivity expires", async ({
  page,
  context,
}) => {
  await create(page);
  const second = await context.newPage();
  await second.goto("/");
  await unlock(second);
  await add(page);
  await expect(
    second.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
  await unlock(second);
  await expect(
    second.getByRole("heading", { name: "Personal email", exact: true }),
  ).toBeVisible();
  await second.clock.install();
  await second.clock.fastForward(5 * 60 * 1000 + 500);
  await expect(
    second.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
});

test("camera pipeline decodes a synthetic stream and stops tracks", async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "Synthetic canvas camera is tested on Chromium; real cameras require device validation.",
  );
  await create(page);
  const image = await QRCode.toDataURL(uri, { width: 400 });
  await page.evaluate(async (data) => {
    const img = new Image();
    img.src = data;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 400;
    canvas.height = 400;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const stream = canvas.captureStream(10);
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: async () => stream,
    });
    Object.defineProperty(window, "testCameraStream", { value: stream });
  }, image);
  await page.getByRole("button", { name: "Add account", exact: true }).click();
  await page.getByRole("button", { name: "Use camera" }).click();
  await expect(
    page.getByRole("heading", { name: "1 supported account" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as { testCameraStream: MediaStream }
        ).testCameraStream
          .getTracks()
          .every((t) => t.readyState === "ended"),
      ),
    )
    .toBe(true);
  await page.getByRole("button", { name: "Import 1 new accounts" }).click();
  await expect(
    page.getByRole("heading", { name: "Example", exact: true }),
  ).toBeVisible();
});

test("imports a Google Authenticator version 2 QR image", async ({ page }) => {
  await create(page);
  const account = Writer.create()
    .uint32(10)
    .bytes(new Uint8Array(20).fill(49))
    .uint32(18)
    .string("demo@example.test")
    .uint32(26)
    .string("Version 2 sample")
    .uint32(32)
    .int32(1)
    .uint32(40)
    .int32(1)
    .uint32(48)
    .int32(2)
    .finish();
  const payload = Writer.create()
    .uint32(10)
    .bytes(account)
    .uint32(16)
    .int32(2)
    .uint32(24)
    .int32(1)
    .uint32(32)
    .int32(0)
    .finish();
  const uri =
    "otpauth-migration://offline?data=" +
    encodeURIComponent(Buffer.from(payload).toString("base64"));
  await page.getByRole("button", { name: "Add account", exact: true }).click();
  await page.getByLabel("Upload QR image", { exact: true }).setInputFiles({
    name: "synthetic-v2-export.png",
    mimeType: "image/png",
    buffer: await QRCode.toBuffer(uri, { width: 400 }),
  });
  await expect(
    page.getByRole("heading", { name: "1 supported account" }),
  ).toBeVisible();
  await expect(page.getByText("Batch: 1 of 1 QR codes scanned.")).toBeVisible();
  await page.getByRole("button", { name: "Import 1 new accounts" }).click();
  await expect(
    page.getByRole("heading", { name: "Version 2 sample", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Lock vault" }).click();
  await unlock(page);
  await expect(
    page.getByRole("heading", { name: "Version 2 sample", exact: true }),
  ).toBeVisible();
});

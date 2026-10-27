import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import type { AddressInfo } from "node:net";

test("service worker waits for approval, locks, and preserves the vault", async ({
  page,
}) => {
  let version = 1;
  const root = resolve("dist");
  const server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url ?? "/", "http://localhost").pathname;
      const file = resolve(root, "." + (path === "/" ? "/index.html" : path));
      if (!file.startsWith(root + "/")) {
        res.writeHead(403).end();
        return;
      }
      let body = await readFile(file);
      if (path === "/sw.js")
        body = Buffer.concat([
          body,
          Buffer.from(`\n// test deployment ${version}\n`),
        ]);
      res.writeHead(200, {
        "Content-Type":
          (
            {
              ".js": "application/javascript",
              ".css": "text/css",
              ".html": "text/html",
              ".png": "image/png",
              ".webmanifest": "application/manifest+json",
            } as Record<string, string>
          )[extname(file)] ?? "application/octet-stream",
        "Cache-Control": "no-store",
      });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    await page.goto(
      `http://127.0.0.1:${(server.address() as AddressInfo).port}/`,
    );
    await page
      .getByLabel("Master password", { exact: true })
      .fill("synthetic test password");
    await page
      .getByLabel("Confirm master password")
      .fill("synthetic test password");
    await page
      .getByRole("button", { name: "Create your private vault" })
      .click();
    await expect(
      page.getByRole("heading", { name: "Your accounts." }),
    ).toBeVisible();
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    await page
      .getByLabel("Master password", { exact: true })
      .fill("synthetic test password");
    await page
      .getByRole("button", { name: "Unlock vault", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Your accounts." }),
    ).toBeVisible();
    version = 2;
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      await registration.update();
    });
    await expect(
      page.getByRole("button", { name: "Lock & update" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Your accounts." }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Lock & update" }).click();
    await expect(
      page.getByRole("heading", { name: "Welcome back." }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Lock & update" }),
    ).toHaveCount(0);
    await page
      .getByLabel("Master password", { exact: true })
      .fill("synthetic test password");
    await page
      .getByRole("button", { name: "Unlock vault", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Your accounts." }),
    ).toBeVisible();
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

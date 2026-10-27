import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
export default defineConfig({
  plugins: [
    {
      name: "dev-react-refresh-csp",
      apply: "serve",
      transformIndexHtml(html) {
        // React Fast Refresh injects an inline preamble in development only.
        return html.replace(
          "script-src 'self' 'wasm-unsafe-eval';",
          "script-src 'self' 'wasm-unsafe-eval' 'unsafe-inline';",
        );
      },
    },
    react(),
    tailwind(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["icon-192.png", "icon-512.png", "maskable-512.png"],
      manifest: {
        name: "Stillkey — Offline Authenticator",
        short_name: "Stillkey",
        description: "Your codes. Your device. An offline authenticator.",
        theme_color: "#132c27",
        background_color: "#f5f6f2",
        display: "standalone",
        start_url: ".",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg,wasm}"],
        maximumFileSizeToCacheInBytes: 4000000,
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        navigateFallback: "index.html",
        runtimeCaching: [],
      },
    }),
  ],
  test: { include: ["src/**/*.test.ts"], environment: "node" },
});

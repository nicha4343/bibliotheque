/// <reference types="vitest/config" />
import preact from '@preact/preset-vite';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };
import { fr } from './src/textes/fr.ts';

// Matches the app background so the phone status bar blends in.
const BACKGROUND_COLOR = '#F4F5F7';

const escapeHtml = (text: string): string =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

// Keeps index.html free of hard-coded French: its texts come from src/textes/fr.ts.
function htmlTexts(): Plugin {
  return {
    name: 'html-texts',
    transformIndexHtml: (html) =>
      html
        .replaceAll('{{APP_NAME}}', escapeHtml(fr.app.name))
        .replaceAll('{{APP_SHORT_NAME}}', escapeHtml(fr.app.shortName))
        .replaceAll('{{APP_DESCRIPTION}}', escapeHtml(fr.app.description)),
  };
}

export default defineConfig({
  // Relative base: the same build works at the root of a domain or under a sub-path (GitHub Pages).
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    preact(),
    htmlTexts(),
    VitePWA({
      // Our own service worker (src/sw/sw.ts): Workbox's offline caching, plus the loan reminders (lot 4).
      strategies: 'injectManifest',
      srcDir: 'src/sw',
      filename: 'sw.ts',
      // An update never reloads the page by itself: a scan session must not be interrupted.
      registerType: 'prompt',
      injectRegister: false,
      // The icons are already precached through globPatterns.
      includeManifestIcons: false,
      manifest: {
        id: './',
        name: fr.app.name,
        short_name: fr.app.shortName,
        description: fr.app.description,
        lang: 'fr',
        dir: 'ltr',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: BACKGROUND_COLOR,
        theme_color: BACKGROUND_COLOR,
        categories: ['books', 'productivity'],
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,woff2,png,svg,ico,wasm}'],
        // A classic script, as Workbox generated before.
        rollupFormat: 'iife',
      },
    }),
  ],
  test: {
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test-setup.ts'],
    environment: 'node',
  },
});

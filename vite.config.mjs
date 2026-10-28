import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Extension pages and scripts are emitted to dist/. No CDN and no script URLs from outside the extension.
export default defineConfig({
  base: './',
  publicDir: resolve(import.meta.dirname, 'public'),
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: {
        popup: resolve(import.meta.dirname, 'popup.html'),
        reader: resolve(import.meta.dirname, 'reader.html'),
        sandbox: resolve(import.meta.dirname, 'ocr-sandbox.html')
      },
    },
  },
});

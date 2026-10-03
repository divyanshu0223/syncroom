import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(({ command }) => {
  const base = process.env.VITE_BASE || (command === 'build' ? '/syncroom/' : '/');

  return {
    base,
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'copy-404-and-sync-docs',
        closeBundle() {
          const rootDir = import.meta.dirname || process.cwd();
          const distDir = path.resolve(rootDir, 'dist');
          const distIndex = path.resolve(distDir, 'index.html');
          const dist404 = path.resolve(distDir, '404.html');
          const docsDir = path.resolve(rootDir, 'docs');
          if (fs.existsSync(distIndex)) {
            fs.copyFileSync(distIndex, dist404);
            console.log('[Vite Build] Created dist/404.html for GitHub Pages SPA fallback.');
          }
          const iconsSrc = path.resolve(distDir, 'icons');
          const assetsIcons = path.resolve(distDir, 'assets', 'icons');
          if (fs.existsSync(iconsSrc)) {
            fs.cpSync(iconsSrc, assetsIcons, { recursive: true, force: true });
            console.log('[Vite Build] Copied dist/icons into dist/assets/icons for manifest resolution.');
          }
          if (fs.existsSync(distDir)) {
            fs.cpSync(distDir, docsDir, { recursive: true, force: true });
            console.log('[Vite Build] Synced dist/ into docs/ for GitHub Pages /docs fallback.');
          }
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname || process.cwd(), '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});

import { defineConfig } from 'vite';
// base './' => dist/ is a self-contained folder that works from any path (GitHub Pages subfolder, file host, etc.)
export default defineConfig({ base: './', build: { outDir: 'dist', assetsInlineLimit: 0, target: 'es2020' } });

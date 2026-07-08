import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the build runs from any static host or subpath
  // (GitHub Pages project sites, Netlify, itch.io, a plain folder...).
  base: './',
});

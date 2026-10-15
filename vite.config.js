import { defineConfig } from 'vite';

// GitHub Pages serves project sites from a repository subdirectory.
// Keep the local development and preview URLs rooted at /.
export default defineConfig({
  base: process.env.GITHUB_PAGES === 'true' ? '/threejs-universe/' : '/'
});

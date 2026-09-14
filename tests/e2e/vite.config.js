import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// A minimal Vite root (no Tailwind, no PWA plugin) that serves only the
// accessibility test harness in tests/e2e/harness. It imports components
// directly from src/App.jsx, so styling is irrelevant to what these specs check.
export default defineConfig({
  root: fileURLToPath(new URL('./harness', import.meta.url)),
});

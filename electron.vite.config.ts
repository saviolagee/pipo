import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const alias = { '@shared': resolve(__dirname, 'src/shared') };

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: {
      rollupOptions: {
        external: ['node:sqlite'],
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          // Processo separado que o Claude Code sobe via --mcp-config (stdio).
          'mcp-stdio': resolve(__dirname, 'src/main/mcp/stdio-entry.ts'),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
  },
  renderer: {
    resolve: { alias: { ...alias, '@renderer': resolve(__dirname, 'src/renderer') } },
    plugins: [react(), tailwindcss()],
    worker: { format: 'es' },
  },
});

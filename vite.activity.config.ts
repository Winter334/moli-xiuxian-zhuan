import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: false,
  plugins: [{
    name: 'activity-storage-sql',
    generateBundle() {
      for (const name of ['001_initial.sql', '002_discord.sql', '003_discord_profiles.sql']) {
        this.emitFile({
          type: 'asset',
          fileName: `server/client/${name}`,
          source: readFileSync(new URL(`./server/client/${name}`, import.meta.url), 'utf8'),
        });
      }
    },
  }],
  build: {
    ssr: 'server/client/activity.ts',
    outDir: 'dist/server',
    target: 'node22',
    rollupOptions: {
      output: {
        preserveModules: true,
        preserveModulesRoot: resolve('.'),
        entryFileNames: '[name].js',
      },
    },
  },
});

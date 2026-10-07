import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: false,
  plugins: [{
    name: 'activity-storage-sql',
    generateBundle() {
      const directory = new URL('./server/client/', import.meta.url);
      const migrations = readdirSync(directory, { withFileTypes: true })
        .filter(entry => entry.isFile() && /^\d+_[a-z0-9_]+\.sql$/.test(entry.name))
        .map(entry => entry.name).sort();
      for (const name of migrations) {
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

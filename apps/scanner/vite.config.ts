import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Rellena `sw.js` (copiado desde public/) con la lista de archivos del build
 * para precachearlos, y un id de versión derivado de su contenido: si el build
 * cambia, cambia el SW y el navegador detecta la versión nueva.
 */
function swPrecache(): Plugin {
  let outDir = 'dist';
  const assets = new Set<string>();
  return {
    name: 'tp-sw-precache',
    apply: 'build',
    configResolved(cfg) { outDir = cfg.build.outDir; },
    generateBundle(_opts, bundle) {
      for (const name of Object.keys(bundle)) if (!name.endsWith('.map')) assets.add('/' + name);
    },
    closeBundle() {
      const swPath = join(outDir, 'sw.js');
      if (!existsSync(swPath)) return;
      const list = ['/', '/index.html', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png', ...[...assets].sort()];
      const hash = createHash('sha256');
      for (const f of list) {
        const p = join(outDir, f === '/' ? 'index.html' : f);
        if (existsSync(p)) hash.update(readFileSync(p));
      }
      const buildId = hash.digest('hex').slice(0, 12);
      const src = readFileSync(swPath, 'utf8')
        .replace('__BUILD_ID__', buildId)
        .replace('__PRECACHE__', JSON.stringify(list));
      writeFileSync(swPath, src);
      writeFileSync(join(outDir, 'version.json'), JSON.stringify({ buildId, builtAt: new Date().toISOString() }));
    }
  };
}

export default defineConfig({
  plugins: [react(), swPrecache()],
  define: { __APP_BUILD__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ')) },
  server: { port: 5173 },
  build: { outDir: 'dist', sourcemap: false }
});

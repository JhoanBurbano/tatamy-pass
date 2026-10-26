import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// El build se copia a apps/host/public/admin y el host lo sirve en /admin (mismo origen que la API).
export default defineConfig({
  plugins: [react()],
  base: '/admin/',
  server: { port: 5174 },
  build: { outDir: '../host/public/admin', emptyOutDir: true, sourcemap: false }
});

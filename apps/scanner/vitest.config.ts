import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['test/**/*.test.{ts,tsx}'],
    // Lógica pura en Node; las pruebas de componente declaran `@vitest-environment jsdom`.
    environment: 'node',
    setupFiles: ['fake-indexeddb/auto', './test/setup-dom.ts'],
    testTimeout: 20000
  }
});

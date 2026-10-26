/**
 * Lote desde JSON: `npm run print -w apps/print -- lote.json out/lote.pdf`
 * El JSON es un array de credenciales con `token` (lo que devuelve el host en
 * GET /credentials/:id con rol PRINTER) y opcionalmente `config` del evento.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createDefaultConfig, type EventConfig } from '@tatami/core';
import { buildCredentialsPdf, type PrintableCredential } from './pdf.js';

const [input, output = 'out/credentials.pdf', configPath] = process.argv.slice(2);
if (!input) {
  console.error('Uso: print <credenciales.json> [salida.pdf] [event.config.json]');
  process.exit(1);
}
const creds = JSON.parse(readFileSync(input, 'utf8')) as PrintableCredential[];
const config: EventConfig = configPath ? { ...createDefaultConfig(), ...JSON.parse(readFileSync(configPath, 'utf8')) } : createDefaultConfig();
const t0 = performance.now();
const pdf = await buildCredentialsPdf(creds, config);
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, pdf);
console.log(`${creds.length} credenciales → ${output} en ${(performance.now() - t0).toFixed(0)} ms`);

/**
 * `npm run promote -w apps/host` (o `tatami promote`): convierte este host
 * (standby) en primario.
 *
 * Escribe `hostMode=primary` en la base; si el host está corriendo lo detecta
 * en ≤ 10 s, deja de replicar y empieza a aceptar escaneos y cambios. Si no
 * está corriendo, arrancará ya como primario. Luego hay que apuntar los
 * scanners (y el DNS/mDNS si se usa) a este equipo.
 */
import { networkInterfaces } from 'node:os';
import { createContext } from './server.js';
import { promote } from './replication.js';

const ctx = createContext();
const port = process.env.PORT ?? '8787';
const ips = Object.values(networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i!.address);

if (ctx.mode === 'primary') {
  console.log('Este equipo ya es el principal. Nada que hacer.');
} else {
  const r = promote(ctx, 'cli');
  console.log(`Equipo promovido a principal (${r.promotedAt}). Antes replicaba de ${ctx.replica.primaryUrl ?? '(sin TP_PRIMARY_URL)'}.`);
  console.log('');
  console.log('Qué hacer ahora:');
  console.log('  1. Si el host está en marcha, deja de replicar en menos de 10 s. Si no, arráncalo: npm run dev:host (o node dist/main.js).');
  console.log(`  2. Apunta cada scanner a este equipo: menú ⋯ › Cambiar dirección del host → http://${ips[0] ?? '<ip-de-este-equipo>'}:${port}`);
  if (ips.length > 1) console.log(`     (otras direcciones de este equipo: ${ips.slice(1).join(', ')})`);
  console.log('  3. Si usas un nombre (tatami-host.local o DNS interno), cámbialo para que resuelva a esta IP: así los scanners no necesitan tocar nada.');
  console.log('  4. En el panel (/admin › Sistema) verás "Equipo principal". Cuando recuperes el equipo anterior, arráncalo como standby de este: TP_ROLE=standby TP_PRIMARY_URL=http://<esta-ip>:' + port);
  console.log('  5. No vuelvas a encender el principal viejo como principal: habría dos fuentes de verdad.');
}
ctx.db.close();

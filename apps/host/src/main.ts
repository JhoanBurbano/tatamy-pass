import { buildApp } from './server.js';

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '0.0.0.0';

const app = await buildApp({ logger: true });
if (app.ctx.users.count() === 0 && app.ctx.mode === 'primary') {
  app.log.warn('No hay usuarios. Ejecuta `npm run seed` para crear el evento de prueba.');
}
if (app.ctx.mode === 'standby') {
  app.log.info(`Modo respaldo (standby): replicando de ${app.ctx.replica.primaryUrl ?? '(sin TP_PRIMARY_URL)'} cada 10 s. Promover: npm run promote -w apps/host`);
  app.ctx.replica.start();
} else {
  app.ctx.cloud.startScheduler();
  app.ctx.backups.start((m) => app.log.info(m));
  app.ctx.purge.start((m) => app.log.info(m));
}
await app.listen({ port, host });
app.log.info(`Tatami Pass host (${app.ctx.mode}) escuchando en http://${host}:${port} · panel en /admin`);

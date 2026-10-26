# apps/host — guía para agentes

L2 del sistema: **Fastify + SQLite (WAL)**, fuente de verdad de la sede. Lee primero `/CLAUDE.md` (raíz); aquí solo lo específico.

## Estructura

| Archivo | Qué hace |
|---|---|
| `src/server.ts` | `createContext()` arma base, repos, clave, cifrado, nube, réplica, copias y purga; `buildApp()` registra guardas (`requireUser`, `requireDeviceOrUser`, `requireReplica`), auditoría y rutas. Sirve `public/admin` en `/admin`. |
| `src/routes/*.ts` | Rutas por tema (`auth`, `devices`, `sync`, `cloud`, `credentials`, `print`, `live`, `config`, `reports`, `audit`, `system`, `radio`). Cada ruta: `/** JSDoc */` + `app.<método>('/ruta', { preHandler: g.requireUser([...]) }, handler)`. `routes/shared.ts` tiene los grupos de roles (`READERS`, `CRED_READERS`, `PRINTERS`, `AUDITORS`). |
| `src/repos.ts` | Repositorios con **SQL directo** sobre `better-sqlite3` (sin ORM, ADR-0001). Sin lógica de dominio: eso va en `@tatami/core`. `publicCredential()` quita PII y token. |
| `src/auth.ts` | Sesiones, `hashSecret`/`verifySecret` (scrypt, ADR-0006), roles `USER_ROLES`. |
| `src/pii.ts` | Cifrado de documento, fecha de nacimiento y acudiente (AES-256-GCM, HMAC para buscar). |
| `src/config.ts` | `event.config.json` y clave de firma cifrada (`keys/signing.enc.json`, `TP_KEY_PASSPHRASE`). |
| `src/cloud-sync.ts` | Pull desde la nube (ADR-0007). `src/replication.ts` respaldo. `src/backup.ts` copias. `src/purge.ts` purga a 90 días. `src/reports.ts` resúmenes. |
| `src/radio.ts` | `RadioHub` (Tatami Radio, ADR-0010, `docs/34`): sockets de `/radio/ws` (`@fastify/websocket`), envuelve el `RadioArbiter` de core, retransmite SDP/ICE entre pares (**nunca audio**), concede el PTT, difunde órdenes/acuses y persiste `radio_ptt/order/ack` en `scan_events` bajo el dispositivo virtual `radio` (solo en primario). `reloadConfig()` tras `PUT /config`. El token viaja como subprotocolo (`routes/radio.ts › radioToken`). |
| `migrations/NNN_*.sql` | Esquema; se aplican en orden al arrancar. Una migración nueva = archivo nuevo, nunca editar una aplicada. |
| `test/*.test.ts` | Integración con `buildApp({ dbPath: ':memory:', config, signingKey })` + `app.inject()`. `seedCredentials(ctx, n)` para datos. |

## Reglas propias

- **Toda ruta nueva**: JSDoc encima (alimenta `docs/31-API-REFERENCIA.md`), `preHandler` con roles explícitos, mensajes `{ error }` en español humano (ver `docs/70` §6), `g.audit(actor, 'ACCION_EN_MAYUSCULAS', payload)` si cambia estado, y test en `test/` con el rol que puede y uno que no (espera 403).
- **Escrituras en standby** deben responder 409: no saltes el hook global; si necesitas una excepción, documenta por qué.
- **Nunca** devuelvas `token`, `passwordHash`, `documentNumber`, `birthDate` ni `guardian` a roles que no sean ADMIN/COORDINATOR (usa `publicCredential`/`forRole`).
- La base la abre `openDb` con WAL y `foreign_keys`; usa transacciones (`ctx.db.transaction(() => …)()`) para lotes.
- Cambios de esquema → migración nueva + replicación: revisa `replication.ts` (`replicationPayload`, `applyReplication`) y `backup.ts` (`verifySnapshot` cuenta filas) para que el respaldo y la verificación de copias sigan funcionando; añade un caso en `test/standby.test.ts`.
- Eventos de dispositivo (`decision: 'EVENT'`) viajan por `POST /sync/events`; los reportes deben ignorarlos (pendiente en `reports.ts`, ver `docs/80` §9). Los de la radio los escribe el host (`ctx.radio`), con `device_id = 'radio'` y seq propio (`scans.maxSeq`).
- Rutas WebSocket: `app.get(path, { websocket: true, preHandler }, (socket, req) => …)`; el `preHandler` debe autenticar a mano (`radioToken`) porque el navegador no manda `Authorization`. `docs:gen` las lista como `WS`. Tests con `ws` real: `app.listen({ port: 0 })` y `configPath: null` (si no, `PUT /config` escribe `event.config.json`).
- Variables de entorno: lista en `docs/80-COMO-PROBAR.md` §2; si añades una, documéntala allí y en `docker-compose.yml`.
- La app de escritorio (`apps/host-desktop`) importa `@tatami/host/dist/server.js`, `backup.js`, `replication.js`, `seed-data.js` y `auth.js` y usa sus `.d.ts` (`declaration: true`): si cambias esas firmas, compila también `npm run build -w apps/host-desktop`. `TP_SQLITE_NATIVE_BINDING` (en `db.ts`) deja cargar un `better_sqlite3.node` de otro runtime; no lo quites.

## Verificar

```bash
npm test -w apps/host            # compila print antes (pretest)
npm run typecheck -w apps/host
npm run seed && npm run dev:host # http://localhost:8787/admin
npm run docs:gen                 # si tocaste rutas
```

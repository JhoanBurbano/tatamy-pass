# 31 · Referencia de la API

> **Generado automáticamente** por `scripts/docs/gen-api.ts` (`npm run docs:gen`). No lo edites a mano: cambia el JSDoc de la ruta en el código y vuelve a generar. Las rutas sin comentario aparecen con «—»: es una deuda que hay que pagar en el mismo PR.

Rutas del host: **67** · rutas de la nube: **13**. Roles del host: `ADMIN` (Administrador), `COORDINATOR` (Coordinador), `PRINTER` (Operador de impresión), `CLUB` (Inscriptor (club)), `CONTROL` (Control de entradas), `SUPERVISOR` (Supervisor), `AUDITOR` (Auditor).

## 1. Host (`apps/host`, Fastify, puerto 8787)

Autenticación: `Authorization: Bearer <token>` con el token de `POST /auth/login` (usuarios) o el `deviceToken` de `POST /devices/enroll` (scanners). En el equipo de respaldo toda escritura responde `409`. Los errores llegan como `{ error: "mensaje en español" }` y, en validaciones de formulario, `errors: [{ path, message }]`.

### Auditoría

| Método | Ruta | Quién puede | Qué hace | Código |
|---|---|---|---|---|
| `GET` | `/audit` | Administrador, Auditor, Coordinador | Página del registro de auditoría con filtros por acción y actor; `all=1` devuelve todo. Incluye la verificación de la cadena. | [audit.ts:8](../apps/host/src/routes/audit.ts#L8) |
| `GET` | `/audit/verify` | Administrador, Auditor, Coordinador | Verifica la cadena de hashes de la auditoría y devuelve hasta qué número está íntegra. | [audit.ts:14](../apps/host/src/routes/audit.ts#L14) |
| `GET` | `/audit/export` | Administrador, Auditor, Coordinador | Exporta toda la auditoría en JSON (por defecto) o CSV (`format=csv`) con huella SHA-256 en `x-content-sha256`. | [audit.ts:20](../apps/host/src/routes/audit.ts#L20) |

### Sesión y usuarios

| Método | Ruta | Quién puede | Qué hace | Código |
|---|---|---|---|---|
| `POST` | `/auth/login` | Público (sin sesión) | Inicia sesión con usuario y contraseña; devuelve el token de sesión (Bearer) y el modo del host. | [auth.ts:7](../apps/host/src/routes/auth.ts#L7) |
| `GET` | `/auth/me` | Cualquier usuario con sesión | Usuario de la sesión actual y modo del host (primary/standby). | [auth.ts:16](../apps/host/src/routes/auth.ts#L16) |
| `POST` | `/auth/logout` | Cualquier usuario con sesión | Cierra la sesión del token actual. | [auth.ts:18](../apps/host/src/routes/auth.ts#L18) |
| `GET` | `/users` | Administrador | Lista de usuarios del host (sin contraseñas). | [auth.ts:25](../apps/host/src/routes/auth.ts#L25) |
| `POST` | `/users` | Administrador | Crea un usuario con rol (y club opcional). Contraseña mínima de 8 caracteres. | [auth.ts:27](../apps/host/src/routes/auth.ts#L27) |
| `POST` | `/users/:id/disable` | Administrador | Desactiva (o reactiva con `disabled:false`) un usuario y cierra sus sesiones. No permite desactivarse a sí mismo. | [auth.ts:39](../apps/host/src/routes/auth.ts#L39) |
| `POST` | `/users/:id/reset-password` | Administrador | Cambia la contraseña de un usuario. | [auth.ts:49](../apps/host/src/routes/auth.ts#L49) |

### Nube → host

| Método | Ruta | Quién puede | Qué hace | Código |
|---|---|---|---|---|
| `GET` | `/sync/cloud/status` | Administrador, Coordinador, Supervisor, Auditor, Operador de impresión | Estado de la actualización desde la nube: última hora, conteos, intervalo y si el último intento tuvo conexión. | [cloud.ts:14](../apps/host/src/routes/cloud.ts#L14) |
| `POST` | `/sync/cloud/pull` | Administrador, Coordinador | Trae ahora las inscripciones aprobadas de la nube (idempotente por id de inscripción). 503 si no hay conexión, 409 si la nube no está configurada. | [cloud.ts:17](../apps/host/src/routes/cloud.ts#L17) |
| `GET` | `/sync/cloud/preview` | Administrador, Coordinador, Operador de impresión | Qué hay en la nube desde el último cursor, sin aplicarlo. | [cloud.ts:29](../apps/host/src/routes/cloud.ts#L29) |
| `PUT` | `/sync/cloud/settings` | Administrador, Coordinador | Cambia el intervalo de actualización periódica (0 = solo manual, máximo 1440 min). Se guarda en la base. | [cloud.ts:41](../apps/host/src/routes/cloud.ts#L41) |
| `GET` | `/registrations/pending` | Administrador, Coordinador, Operador de impresión, Supervisor, Auditor | Inscripciones que la nube ya trajo al host y todavía no tienen credencial impresa/entregada: lo que hay que imprimir antes de que lleguen. | [cloud.ts:53](../apps/host/src/routes/cloud.ts#L53) |

### Configuración del evento

| Método | Ruta | Quién puede | Qué hace | Código |
|---|---|---|---|---|
| `GET` | `/config` | Cualquier usuario con sesión | Configuración vigente del evento (`event.config.json` en memoria) y credenciales emitidas por rol. | [config.ts:7](../apps/host/src/routes/config.ts#L7) |
| `PUT` | `/config` | Administrador | Guarda una configuración nueva: valida con `validateEventConfig`, incrementa `configVersion`, persiste el archivo y recarga en caliente. 409 si `expectedVersion` no coincide. | [config.ts:10](../apps/host/src/routes/config.ts#L10) |
| `POST` | `/config/validate` | Administrador, Coordinador | Valida una configuración sin guardarla; devuelve errores por campo y avisos de cupo. | [config.ts:27](../apps/host/src/routes/config.ts#L27) |

### Credenciales

| Método | Ruta | Quién puede | Qué hace | Código |
|---|---|---|---|---|
| `GET` | `/credentials` | Administrador, Coordinador, Operador de impresión, Supervisor, Auditor | Busca credenciales por texto (`q`), rol, estado, club o documento (por HMAC, nunca descifra). Paginado con `limit`/`offset`. | [credentials.ts:19](../apps/host/src/routes/credentials.ts#L19) |
| `GET` | `/credentials/clubs` | Administrador, Coordinador, Operador de impresión, Supervisor, Auditor | Lista de clubes con credenciales (para filtros). | [credentials.ts:26](../apps/host/src/routes/credentials.ts#L26) |
| `GET` | `/credentials/:id` | Administrador, Coordinador, Operador de impresión, Supervisor, Auditor | Ficha completa: persona (PII solo para admin/coordinador), anulaciones, acompañantes, participante e historial de escaneos. | [credentials.ts:29](../apps/host/src/routes/credentials.ts#L29) |
| `GET` | `/credentials/:id/token` | Administrador, Coordinador, Operador de impresión | Token firmado del QR (lo que va impreso o en la credencial digital). | [credentials.ts:47](../apps/host/src/routes/credentials.ts#L47) |
| `GET` | `/credentials/:id/companions` | Administrador, Coordinador, Operador de impresión, Supervisor, Auditor | Acompañantes ligados a una credencial, con los límites configurados y el uso actual. | [credentials.ts:55](../apps/host/src/routes/credentials.ts#L55) |
| `POST` | `/credentials/:id/revoke` | Administrador, Coordinador, Supervisor | Anula una credencial (motivo obligatorio). Los scanners la reciben en la lista de revocaciones. | [credentials.ts:67](../apps/host/src/routes/credentials.ts#L67) |
| `POST` | `/credentials/:id/reissue` | Administrador, Coordinador | Re-emite con versión nueva; la versión anterior queda anulada automáticamente. | [credentials.ts:79](../apps/host/src/routes/credentials.ts#L79) |
| `POST` | `/credentials/:id/deliver` | Administrador, Coordinador, Operador de impresión | Marca la credencial como entregada (no aplica a anuladas). | [credentials.ts:89](../apps/host/src/routes/credentials.ts#L89) |
| `GET` | `/credentials/:id/pdf` | Administrador, Coordinador, Operador de impresión | PDF de una sola credencial (100 × 150 mm) generado con `apps/print`. | [credentials.ts:99](../apps/host/src/routes/credentials.ts#L99) |
| `POST` | `/credentials/issue` | Administrador, Coordinador | Emisión manual en sitio: crea la persona y su credencial (p. ej. prensa o staff que llega sin acreditar). Valida rol, cupo, edad/categoría (COMP), acudiente para menores y límites de acompañantes. | [credentials.ts:113](../apps/host/src/routes/credentials.ts#L113) |

### Scanners (enrolamiento)

| Método | Ruta | Quién puede | Qué hace | Código |
|---|---|---|---|---|
| `POST` | `/devices/enroll-token` | Administrador, Supervisor | Genera un código de enrolamiento (caduca en 10 min) para un scanner con nombre, zona y rol Control/Supervisor. Devuelve también el JSON para el QR. | [devices.ts:7](../apps/host/src/routes/devices.ts#L7) |
| `POST` | `/devices/enroll` | Público (sin sesión) | Enrola un scanner con el código y un PIN de 6 dígitos; devuelve `deviceToken`. Sin sesión: lo llama el propio scanner. | [devices.ts:19](../apps/host/src/routes/devices.ts#L19) |
| `GET` | `/devices` | Administrador, Coordinador, Supervisor, Auditor | Lista de scanners enrolados con zona, último seq, pendientes y estado. | [devices.ts:29](../apps/host/src/routes/devices.ts#L29) |
| `PATCH` | `/devices/:id` | Administrador, Supervisor | Cambia la zona o el nombre de un scanner. | [devices.ts:32](../apps/host/src/routes/devices.ts#L32) |
| `POST` | `/devices/:id/disable` | Administrador, Supervisor | Desactiva (o reactiva) un scanner; desde ese momento recibe 401. | [devices.ts:52](../apps/host/src/routes/devices.ts#L52) |

### Puertas en vivo y alertas

| Método | Ruta | Quién puede | Qué hace | Código |
|---|---|---|---|---|
| `GET` | `/live` | Administrador, Coordinador, Supervisor, Auditor | Puertas en vivo: ingresos de hoy, ritmo, pendientes, alertas abiertas, tabla por puerta, "dentro ahora" por zona y últimos escaneos. | [live.ts:8](../apps/host/src/routes/live.ts#L8) |
| `GET` | `/alerts` | Administrador, Coordinador, Supervisor, Auditor | Alertas (duplicados, ingresos manuales, scanners sin conexión) abiertas o resueltas, con la credencial asociada. | [live.ts:14](../apps/host/src/routes/live.ts#L14) |
| `GET` | `/alerts/denied` | Administrador, Coordinador, Supervisor, Auditor | Intentos de ingreso denegados hoy, por puerta y por motivo, con los últimos casos. | [live.ts:23](../apps/host/src/routes/live.ts#L23) |
| `POST` | `/alerts/:id/resolve` | Administrador, Coordinador, Supervisor | Resuelve una alerta con una nota obligatoria. | [live.ts:39](../apps/host/src/routes/live.ts#L39) |

### Impresión por lotes

| Método | Ruta | Quién puede | Qué hace | Código |
|---|---|---|---|---|
| `GET` | `/print/batches` | Auditor, Administrador, Coordinador, Operador de impresión | Lotes de impresión creados. | [print.ts:46](../apps/host/src/routes/print.ts#L46) |
| `POST` | `/print/batches` | Administrador, Coordinador, Operador de impresión | Crea un lote por rol/club/estado o por lista de ids (máximo 2000, excluye anuladas). | [print.ts:49](../apps/host/src/routes/print.ts#L49) |
| `GET` | `/print/batches/:id` | Auditor, Administrador, Coordinador, Operador de impresión | Vista previa: las credenciales del lote (sin token). | [print.ts:62](../apps/host/src/routes/print.ts#L62) |
| `GET` | `/print/batches/:id/pdf` | Administrador, Coordinador, Operador de impresión | PDF del lote completo (`apps/print`, anverso y reverso según la plantilla); `?layout=duplex` pone ambos lados en una hoja. Registra el tiempo de generación en la auditoría. | [print.ts:70](../apps/host/src/routes/print.ts#L70) |
| `POST` | `/print/batches/:id/printed` | Administrador, Coordinador, Operador de impresión | Marca el lote y sus credenciales como impresas. | [print.ts:80](../apps/host/src/routes/print.ts#L80) |
| `POST` | `/print/batches/:id/delivered` | Administrador, Coordinador, Operador de impresión | Marca entregadas todas las credenciales del lote (las que no estén anuladas). | [print.ts:90](../apps/host/src/routes/print.ts#L90) |
| `GET` | `/print/template` | Auditor, Administrador, Coordinador, Operador de impresión | Plantilla de credencial vigente (`data/badge-template.json`) con sus assets en base64. | [print.ts:103](../apps/host/src/routes/print.ts#L103) |
| `PUT` | `/print/template` | Administrador, Coordinador | Guarda una plantilla completa: valida con `validateBadgeTemplate` (400 con `errors` por campo), persiste y audita. | [print.ts:106](../apps/host/src/routes/print.ts#L106) |
| `POST` | `/print/template/assets` | Administrador, Coordinador | Sube un logo o imagen (PNG, JPG o SVG, ≤ 1 MB) a la plantilla: `{ id, name, mime, dataBase64 }`. Si el id existe, lo reemplaza. | [print.ts:116](../apps/host/src/routes/print.ts#L116) |
| `DELETE` | `/print/template/assets/:id` | Administrador, Coordinador | Quita un asset y todas sus referencias (pie, patrocinadores, silueta, fondo). | [print.ts:133](../apps/host/src/routes/print.ts#L133) |
| `POST` | `/print/template/preview` | Administrador, Coordinador, Operador de impresión | Vista previa: PDF de una credencial de muestra con la plantilla enviada (`template`, sin guardar) o la vigente, datos de ejemplo (`sample`) y `layout`. Se firma con una clave efímera: el QR de la muestra no vale en ninguna puerta. `format: 'png'` devuelve la primera página como imagen si el equipo tiene `pdftoppm` (poppler); si no, 406 y el panel usa el PDF. | [print.ts:154](../apps/host/src/routes/print.ts#L154) |
| `POST` | `/print/template/reset` | Administrador, Coordinador | Vuelve a la plantilla por defecto del piloto ("Nacional 2026"). Se pierden los logos subidos. | [print.ts:184](../apps/host/src/routes/print.ts#L184) |

### Tatami Radio (voz por la LAN)

| Método | Ruta | Quién puede | Qué hace | Código |
|---|---|---|---|---|
| `GET` | `/radio/ws` | Público (sin sesión) | WebSocket de Tatami Radio. Autenticado con el `deviceToken` del scanner o el token de sesión del panel (subprotocolo `tatami-radio` + token, o `?token=`). Mensajes JSON (`RadioClientMessage` / `RadioServerMessage` en core): `join`, `leave`, `offer`, `answer`, `ice`, `ptt-start`, `ptt-end`, `order`, `ack`, `ping`. Solo señalización: el audio va P2P. | [radio.ts:29](../apps/host/src/routes/radio.ts#L29) |
| `GET` | `/radio/status` | Scanner enrolado (`deviceToken`) o usuario | Estado de la radio: canales con quién está y quién habla, cola, emergencia activa, equipos conectados y últimas órdenes con sus acuses. | [radio.ts:47](../apps/host/src/routes/radio.ts#L47) |
| `GET` | `/radio/events` | Administrador, Coordinador, Supervisor, Auditor | Historial del día (hora local del evento) de la radio: quién habló en qué canal y cuánto, órdenes y acuses, del log append-only. `date=AAAA-MM-DD` opcional. | [radio.ts:50](../apps/host/src/routes/radio.ts#L50) |

### Reportes

| Método | Ruta | Quién puede | Qué hace | Código |
|---|---|---|---|---|
| `GET` | `/reports/gate-summary` | Administrador, Coordinador, Supervisor, Auditor | Resumen por puerta: entradas, salidas, negados por motivo, por zona y por dispositivo, más credenciales por rol. | [reports.ts:7](../apps/host/src/routes/reports.ts#L7) |
| `GET` | `/reports/day-close` | Administrador, Coordinador, Supervisor, Auditor | Reporte de cierre del día (`date=YYYY-MM-DD`, por defecto hoy) en JSON o CSV (`format=csv`). | [reports.ts:14](../apps/host/src/routes/reports.ts#L14) |

### Sync con scanners y replicación

| Método | Ruta | Quién puede | Qué hace | Código |
|---|---|---|---|---|
| `GET` | `/sync/snapshot` | Scanner enrolado (`deviceToken`) o usuario | Copia completa para el scanner: config, credenciales (sin PII) y revocaciones, con la hora del host. | [sync.ts:9](../apps/host/src/routes/sync.ts#L9) |
| `POST` | `/sync/events` | Scanner enrolado (`deviceToken`) o usuario | Recibe escaneos y eventos de dispositivo (append-only, idempotente por `deviceId:seq`). Un scanner solo puede subir los suyos. Genera alertas. | [sync.ts:17](../apps/host/src/routes/sync.ts#L17) |
| `GET` | `/sync/events` | Scanner enrolado (`deviceToken`) o usuario | Eventos recibidos después del cursor `since` (hasta 20000); devuelve el cursor siguiente. | [sync.ts:41](../apps/host/src/routes/sync.ts#L41) |
| `GET` | `/replication/snapshot` | Clave de replicación (`TP_REPLICA_KEY`) o Administrador | Replicación primario → respaldo: copia completa (incluye PII en claro: usar HTTPS fuera de la LAN de staff). | [sync.ts:50](../apps/host/src/routes/sync.ts#L50) |
| `GET` | `/replication/changes` | Clave de replicación (`TP_REPLICA_KEY`) o Administrador | Replicación primario → respaldo: cambios desde `since`, auditoría desde `auditSeq` y config si cambió. | [sync.ts:52](../apps/host/src/routes/sync.ts#L52) |

### Sistema: salud, copias, respaldo, purga

| Método | Ruta | Quién puede | Qué hace | Código |
|---|---|---|---|---|
| `GET` | `/health` | Público (sin sesión) | Salud pública (sin sesión): modo, retraso de réplica, conteos, integridad de la auditoría y último backup. La usan scanners y el respaldo. | [system.ts:13](../apps/host/src/routes/system.ts#L13) |
| `GET` | `/system/health` | Administrador, Coordinador, Supervisor, Auditor | Salud detallada para el panel: reloj, disco, copias, nube, respaldo, purga, cifrado y clave de firma. | [system.ts:24](../apps/host/src/routes/system.ts#L24) |
| `GET` | `/backup/list` | Administrador, Coordinador, Supervisor, Auditor | Copias de seguridad en los dos destinos y estado del programador. | [system.ts:43](../apps/host/src/routes/system.ts#L43) |
| `POST` | `/backup/snapshot` | Administrador | Crea una copia ahora (`VACUUM INTO`) en ambos destinos y rota las antiguas. | [system.ts:45](../apps/host/src/routes/system.ts#L45) |
| `POST` | `/backup/verify` | Administrador, Coordinador, Supervisor, Auditor | Abre una copia, comprueba su integridad y cuenta filas; las compara con el estado actual. | [system.ts:56](../apps/host/src/routes/system.ts#L56) |
| `POST` | `/backup/restore` | Administrador | Restaura una copia (exige `confirm: "RESTAURAR"`); antes guarda una copia de seguridad del estado actual. | [system.ts:68](../apps/host/src/routes/system.ts#L68) |
| `POST` | `/system/promote` | Administrador | Convierte el equipo de respaldo en principal (exige `confirm: "PROMOVER"`). Solo si el principal no responde. | [system.ts:83](../apps/host/src/routes/system.ts#L83) |
| `POST` | `/system/purge` | Administrador | Purga de datos personales: por defecto `dryRun`; para ejecutar exige `confirm` = nombre del evento. No se puede deshacer. | [system.ts:93](../apps/host/src/routes/system.ts#L93) |

## 2. Nube (`apps/registration`, Next.js App Router)

Tres formas de entrar: público (inscripción y estado), sesión del panel (cookie; roles `admin`, `coord`, `club`) y clave compartida con el host (`x-tatami-key` = `TP_CLOUD_KEY`). Detalle de despliegue en [85-DESPLIEGUE-NUBE.md](./85-DESPLIEGUE-NUBE.md).

| Método | Ruta | Quién puede | Qué hace | Código |
|---|---|---|---|---|
| `POST` | `/api/approve` | Clave compartida del host (`x-tatami-key`) | Aprueba inscripciones (y sus acompañantes) con la clave del host. Cuerpo: `{ ids: string[] }` o `{ all: true }`. Para pruebas y scripts; el panel usa acciones con sesión. Envía los mismos correos que el panel. | [route.ts:11](../apps/registration/app/api/approve/route.ts#L11) |
| `GET` | `/api/credencial/:token` | Público (sin sesión) · con límite de peticiones | Credencial digital: estado + QR rotativo (SVG) para la página pública `/credencial/<token>`. El token es opaco (va en el correo de aprobación). Sin datos sensibles: nombre, rol, zonas, estado. | [route.ts:14](../apps/registration/app/api/credencial/[token]/route.ts#L14) |
| `GET` | `/api/cron/waitlist` | Clave compartida del host (`x-tatami-key`) o cron de Vercel (`Authorization: Bearer CRON_SECRET`) | Vence ofertas de cupo caducadas y avisa al siguiente. Lo llama el cron de Vercel (vercel.json) con `Authorization: Bearer $CRON_SECRET`, o cualquiera con `x-tatami-key`. También se ejecuta al abrir la lista de espera en el panel, así que el cron es opcional. | [route.ts:15](../apps/registration/app/api/cron/waitlist/route.ts#L15) |
| `GET` | `/api/export` | Clave compartida del host (`x-tatami-key`) | Exportación para el host (§8): inscripciones APROBADAS creadas/actualizadas después de `since` (ISO), cada una con sus acompañantes, `photoUrl` y `revoked`. Requiere `x-tatami-key`. | [route.ts:12](../apps/registration/app/api/export/route.ts#L12) |
| `POST` | `/api/host-report` | Clave compartida del host (`x-tatami-key`) | El host sube al cierre (o cuando tenga internet) el estado de las credenciales y un resumen de escaneos. Requiere `x-tatami-key`. Ver formato en lib/host-report.ts. | [route.ts:12](../apps/registration/app/api/host-report/route.ts#L12) |
| `POST` | `/api/import/confirm` | Sesión del panel: admin, coord | Mismo cuerpo que preview; aplica la importación (idempotente) y la guarda como lote. Solo admin/coord. | [route.ts:11](../apps/registration/app/api/import/confirm/route.ts#L11) |
| `POST` | `/api/import/preview` | Sesión del panel: admin, coord | Sube el CSV (campo `file` o texto `csv`) y opcionalmente `mapping` JSON. Devuelve vista previa sin guardar. Solo admin/coord. | [route.ts:10](../apps/registration/app/api/import/preview/route.ts#L10) |
| `GET` | `/api/photos/:name` | Público (sin sesión) | Sirve las fotos guardadas en disco (modo sin Vercel Blob). | [route.ts:8](../apps/registration/app/api/photos/[name]/route.ts#L8) |
| `POST` | `/api/register` | Público (sin sesión) · con límite de peticiones | Inscripción pública. Límite: 10 por minuto por IP (ver lib/rate-limit.ts). Forma y tamaños con zod; reglas de negocio en lib/validate.ts. | [route.ts:13](../apps/registration/app/api/register/route.ts#L13) |
| `GET` | `/api/status` | Público (sin sesión) | Estado público del evento para el formulario: ventana de inscripción, roles con cupo restante, categorías, delegaciones, acompañantes y aforo. Sin datos personales. | [route.ts:9](../apps/registration/app/api/status/route.ts#L9) |
| `GET` | `/panel/exportar/csv` | Público (sin sesión) | CSV de aprobados (participantes y acompañantes). Solo admin/coord. | [route.ts:9](../apps/registration/app/panel/exportar/csv/route.ts#L9) |
| `GET` | `/panel/exportar/json` | Público (sin sesión) | JSON de aprobados con el mismo formato que `GET /api/export` (sin marcar como exportado). Solo admin/coord. | [route.ts:8](../apps/registration/app/panel/exportar/json/route.ts#L8) |
| `GET` | `/panel/reportes/csv` | Público (sin sesión) | CSV de reportes: `?by=role\|category\|club\|status\|all`. Los inscriptores solo ven su delegación. | [route.ts:10](../apps/registration/app/panel/reportes/csv/route.ts#L10) |

## 3. Cómo mantener esta referencia

1. Cada ruta nueva del host lleva un `/** … */` justo encima de `app.<método>(...)` que diga **qué hace** y, si aplica, qué confirma o qué código de error devuelve.
2. Cada `route.ts` de la nube lleva el JSDoc encima de `export async function GET|POST`.
3. Corre `npm run docs:gen` y revisa el diff de este archivo en el PR (`scripts/agent/check-all.sh` falla si queda desactualizado).

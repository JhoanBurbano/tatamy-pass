# 99 · Changelog — Tatami Pass

> Formato [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/), versiones [SemVer](https://semver.org/lang/es/). Cada PR que cambie comportamiento añade una línea bajo **[Sin publicar]**; `scripts/agent/release.ts` mueve ese bloque a una versión con fecha, sube la versión de los `package.json` y crea la etiqueta `vX.Y.Z`.
>
> Categorías: **Añadido** · **Cambiado** · **Obsoleto** · **Eliminado** · **Corregido** · **Seguridad** · **Docs**.

## [Sin publicar]

### Añadido
- **Tatami Radio** (ADR-0010, `docs/34-VOZ-RADIO.md`): voz en tiempo real por la red local entre scanners y panel, por canales, sin internet y sin apps extra. Malla WebRTC P2P por canal (Opus, cancelación de eco y supresión de ruido, DTLS-SRTP, solo candidatos de la LAN) con el host como señalización WebSocket (`/radio/ws`, `@fastify/websocket`, token como subprotocolo); el host nunca recibe audio. Pulsar para hablar con árbitro (un hablante por canal, cola: "Ocupado · sigue pulsando y te toca"), canal **Emergencia** que interrumpe a todos (tono y vibración distintos, salto de canal automático y vuelta a los 5 s), órdenes predefinidas editables (Abrir/Cerrar Puerta {n}, Pausar/Reanudar ingreso, Supervisor a Puerta {n}, Evacuación) que suenan, vibran y se leen en voz alta (`speechSynthesis` es-CO) con botón **Recibido** y acuses en tiempo real en el panel. Hechos en el log append-only como eventos del dispositivo virtual `radio` (`radio_ptt`, `radio_order`, `radio_ack`; sin audio). Si cae el host, el audio ya conectado sigue y el PTT pasa a modo local; al volver se re-señaliza solo lo que falta. Core: `packages/core/src/radio.ts` (`RadioArbiter`, mensajes, `buildRadioEvent`), tipos `RadioConfig/RadioChannel/RadioOrderTemplate` y validación; config `radio` en `event.config.json` (canales por defecto Puertas, Supervisores, Acreditación, Emergencia; `maxPerChannel` 10). Host: `src/radio.ts` (hub), `GET /radio/status`, `GET /radio/events?date=`, `radio` en `/health`, recarga en caliente al guardar la config. Scanner: `src/radio/` (cliente, estado puro, panel deslizable con PTT ≥ 120 px, barra espaciadora, volumen, canales, órdenes) y píldora **Radio** en la barra. Panel › **Radio** (supervisor/admin): canales y presencia en vivo, quién habla, PTT desde el portátil, órdenes a canal o puerta con acuses, historial del día, editor de canales y catálogo. App de escritorio: "Radio: N equipos conectados". Pruebas: core (árbitro, permisos, validación), host (dos clientes `ws` reales: relay, ocupado, emergencia, orden con acuse, persistencia, standby), scanner (cliente con WebSocket y RTCPeerConnection falsos: estados PTT, cola, órdenes, reconexión con backoff, host caído) y e2e TC-120 (@smoke, Chromium con micrófono falso: audio real con bytes recibidos > 0, ocupado, acuse desde `/admin`, proxy apagado/encendido). Capturas `design/screenshots/radio-*.png`. El proxy e2e ahora tuneliza WebSockets.

- **Credencial como plantilla** (ADR-0009): el diseño de la credencial impresa deja de estar en código y pasa a `data/badge-template.json` (`BadgeTemplate` en `packages/core/src/badge-template.ts`: colores, fuentes, cabecera, fondo, campos del anverso, banda del rol, acceso, acreditación, QR, pie de logos, reverso completo, assets embebidos y privacidad). La plantilla por defecto **"Nacional 2026"** reproduce el diseño de referencia (`design/referencias/credencial-nacional-2026.png`) con logos placeholder. `apps/print` reescrito para dibujar desde la plantilla con anverso y reverso (`layout: 'two-pages' | 'duplex'`), franjas diagonales, número de edición con contorno, banda del rol con el color del rol, iconos vectoriales, Code 128 (`packages/core/src/code128.ts`, sin dependencias), fuentes Barlow Condensed / Barlow embebidas (OFL, `apps/print/fonts/`) con fallback a Helvetica, logos PNG/JPG/SVG (SVG vía `sharp` o placeholder). `npm run print:sample` genera 12 credenciales (anverso + reverso), el PDF dúplex y capturas PNG con `pdftoppm`.
- Host: `GET/PUT /print/template`, `POST /print/template/assets` (≤ 1 MB), `DELETE /print/template/assets/:id`, `POST /print/template/preview` (PDF o PNG de una credencial de muestra firmada con clave efímera), `POST /print/template/reset`; `GET /print/batches/:id/pdf?layout=duplex`. RBAC: admin/coordinador editan, impresión/auditor leen. Auditoría `BADGE_TEMPLATE_*`. Variable `TP_BADGE_TEMPLATE`.
- Panel › Impresión › pestaña **Diseño de la credencial**: editor por secciones (colores, textos de cabecera, campos del anverso con orden y visibilidad, banda del rol, logos con subida de archivos, reverso línea a línea, privacidad) con vista previa en vivo (debounce 600 ms), restablecer, exportar e importar `.json`.
- Persona: campos opcionales `delegation`, `emergencyContact {name, phone}` (teléfono cifrado en reposo) y `eps {name, regime}` en core, host (migración 005, repos, PII, replicación, purga, seed), nube (migración 003 en SQLite y Postgres, formulario con sección "Contacto de emergencia y EPS", `registration.requireEmergencyContact` en la config, export → host) e importación SportData (columnas opcionales). `credentialDisplay.prefix` imprime el número como `CNITF2026-00428-C` conservando el dígito verificador.
- Prueba e2e TC-110 (editor de diseño: color → vista previa, subir PNG, exportar JSON, guardar, solo lectura) con capturas en `design/screenshots/badge-*.png`.

### Docs
- `docs/33-DISENO-CREDENCIAL.md` (nuevo), ADR-0009, `docs/32` (opciones de inscripción y campos de persona impresos), `docs/60` (administrador y operador de impresión), `docs/70` (mensajes del editor y del formulario), `docs/80` §5.1.

### Seguridad
- Dependencias: Electron 40 → 42.11.15 (corrige GHSA de iframes sandbox; prebuild de better-sqlite3 para ABI 146), `@fastify/static` 10.1.6 (path traversal en listado de directorios), `sharp` 0.35.5 (libvips). `npm audit` queda en 14 avisos, todos en herramientas de desarrollo/empaquetado (electron-builder, vite/esbuild del sitio de docs, mermaid/katex) que no viajan dentro de las apps; detalle y criterio en `docs/80-COMO-PROBAR.md` §13.

### Añadido
- **App de escritorio "Tatami Pass Host"** (`apps/host-desktop`, Electron 40 + electron-builder) para Mac (dmg + zip, arm64 y x64), Windows (instalador NSIS + portable, x64) y Linux (AppImage): ejecuta el host (`buildApp` de `apps/host`) en el proceso principal con datos en `<userData>/tatami`; asistente de primera ejecución (sede y modo, passphrase en el llavero del SO con `safeStorage`, archivo de evento o demo con seed, carpeta de copias); ventana única con estado, IPs y puerto, QR de enrolamiento (10 min, rol y zona), scanners conectados y pendientes, copias (incluida "Copia a USB ahora" verificada), nube ("Traer ahora"), promoción con doble confirmación (SI + PROMOVER), cambio de archivo de evento, logs en vivo y Ajustes; icono en la bandeja (cerrar minimiza; Salir confirma si hay scanners conectados); HTTPS en la LAN con Caddy 2.10.2 como proceso auxiliar (`tls internal`, Caddyfile generado con las IPs, pidfile anti-huérfanos) y botón **Exportar certificado raíz** con instrucciones Android/iOS; la app funciona en HTTP si Caddy no está. Scripts `fetch-native.mjs` (prebuilds oficiales de better-sqlite3 para Electron), `fetch-caddy.mjs` (checksum SHA-512), `make-icons.mjs` (iconos desde SVG), `rebuild-native.mjs` (fallback con @electron/rebuild), `smoke.mjs` (Playwright `_electron`). 27 pruebas Vitest (`test/pure.test.ts`, `test/host-runner.test.ts`).
- `apps/host`: variable `TP_SQLITE_NATIVE_BINDING` (ruta a un `better_sqlite3.node` alternativo, usada por la app de escritorio) y `declaration: true` en su tsconfig para que `@tatami/host/dist/*.d.ts` esté disponible a otros workspaces.
- Framework de documentación: `docs/README.md` (mapa por público y convención de numeración), ADRs en `docs/95-ADR/` (plantilla + 8 decisiones), plantillas en `docs/_plantillas/`, sitio VitePress en `docs-site/` (`npm run docs:dev|build|preview`), generación automática de `31-API-REFERENCIA.md` y `32-CONFIG-EVENTO.md` (`npm run docs:gen`), plantilla de PR.
- Framework agéntico: `CLAUDE.md` (raíz y por workspace), `AGENTS.md`, `.claude/` (settings, hooks, subagentes, slash commands, skills), `scripts/agent/` (`check-all.sh`, `new-event-type.ts`, `verify-docs-links.ts`, `release.ts`), servidor MCP de solo lectura sobre el host (`scripts/mcp/host-server.ts`, `.mcp.json`) y `docs/36-AGENTES.md`.
- Guía de montaje del ecosistema de cero a simulacro: `docs/90-MONTAJE-ECOSISTEMA.md`.
- Pruebas end-to-end completas en `e2e/` (44 specs, Playwright): flujo maestro "día del evento" (TC-200), standby y promoción, backup y restauración, purga, matriz de roles del panel del host, panel de la nube (lista de espera, duplicados, export, rotación de clave), accesibilidad (axe) y rendimiento (`@perf`). Proyectos `e2e`, `e2e:smoke` (≈30 s) y `e2e:perf`; `npm run preflight`; CI con smoke en cada PR y suite completa en main y nightly.
- El host reporta a la nube los IDs y versiones emitidos tras cada "Traer ahora" (`POST /api/host-report`), lo que activa las credenciales digitales en la nube.

### Cambiado
- `better-sqlite3` ^11.7 → ^12.4 en `apps/host` y `apps/registration` (misma API; necesario para tener prebuilds de Electron 40).

### Docs
- `docs/86-APP-ESCRITORIO.md` (nuevo): instalar sin firma, asistente, ventana, HTTPS y certificado raíz, dónde quedan los datos, migrar desde Docker, compilar en la Mac (`npm run dist:mac -w apps/host-desktop`), firmar/notarizar (`CSC_LINK`, `APPLE_ID`…), actualizar, por qué no se recompila better-sqlite3, checklist de 12 puntos. `docs/90` §3 con opción A (app de escritorio) y opción B (Docker); `docs/80` §2 (variable nueva) y §12 (cómo probar la app); README y `CLAUDE.md` (mapa del monorepo).
- JSDoc en todas las rutas del host (`apps/host/src/routes/*.ts`) y en los tipos de configuración de `packages/core/src/types.ts` (fuente de los documentos generados).

### Corregido
- e2e TC-072: la matriz rol × página incluye **Radio** (Administrador, Coordinador, Supervisor); `docs/80` §2.1 actualizado.
- `npm run typecheck` de `e2e`: una sola versión de `playwright-core` (1.56.1) para `@playwright/test` y `@axe-core/playwright`.

## [0.2.0] — 2026-10-13

### Añadido
- **Acompañantes por participante** (rol `ACOMP`, zona Gradería, ligados por `companionOf`): límites `companions.perParticipant`, `companions.total` y `totalCapacity` en `event.config.json`; validación única `validateCompanions` en core usada por formulario, API de inscripción y host; heredan el estado de la inscripción y se exportan con el participante (ADR-0008).
- **Actualización desde la nube** por pull: `GET /api/export?since=` con `x-tatami-key`, `POST /sync/cloud/pull` (botón) + scheduler cada `TP_CLOUD_INTERVAL_MIN`, `GET /sync/cloud/status` y `GET /sync/cloud/preview`; idempotente por id de inscripción; `POST /api/host-report` para subir estados al cierre (ADR-0007).
- **Panel del host** (`apps/host-admin`, Vite + React, servido en `/admin`): Puertas en vivo, Credenciales (ficha, anular, re-emitir, entregar, QR/token, PDF), Inscripciones y emisión en sitio (`POST /credentials/issue`), Impresión por lotes, Dispositivos (enrolar con QR y cuenta regresiva, zona en línea, desactivar), Alertas (duplicados, manuales, sin conexión, rechazos por puerta), Evento y roles (validación por campo, guardado con `expectedVersion`), Nube, Auditoría (paginada, verificar, exportar con SHA-256), Sistema (salud, copias, respaldo, purga), Usuarios. RBAC por página y por endpoint; capturas en `design/screenshots/`.
- **Panel de coordinación en la nube** (`/panel`): aprobar, lista de espera con ofertas y cron, duplicados, cupos, importar SportData (preview + confirmar), exportar CSV/JSON, delegaciones/clubes, configuración del evento y del formulario, reportes; portal de club; estado del participante y **credencial digital** con QR rotativo de 60 s (`/credencial/<token>`); correos con Resend (outbox en dev); fotos con recorte (disco en dev, Vercel Blob en producción).
- **Scanner completo**: enrolamiento por QR o código, PIN con bloqueo de 15 min tras 5 intentos, selección de zona y modo (Entrada/Salida/Ambos), resultado con foto o iniciales y mensajes humanos, ingreso manual con motivos del catálogo, excepciones con PIN de supervisor o validación contra el host, cambio de zona/host, resumen de turno, bandeja de pendientes con "Reintentar ahora", caché de fotos, linterna y selección de cámara, modo kiosk con wake lock, tonos y vibración distintos por decisión, aviso de deriva de reloj. Eventos de dispositivo (`zone_change`, `mode_change`, `shift_start`, `shift_end`) por el mismo log de sync.
- **Equipo de respaldo (standby)**: `TP_ROLE=standby` replica cada 10 s desde `/replication/snapshot` y `/replication/changes` (clave `TP_REPLICA_KEY`); panel en modo consulta (409 en escrituras); promoción desde el panel (PROMOVER) o `npm run promote`.
- **Cifrado de datos personales en reposo**: documento, fecha de nacimiento y documento del acudiente con AES-256-GCM (`packages/core/src/field-crypto.ts` + `apps/host/src/pii.ts`), clave derivada por scrypt de `TP_KEY_PASSPHRASE` + salt por evento; búsqueda por documento mediante HMAC; bases anteriores se cifran al arrancar (`PII_ENCRYPTED`).
- **Copias de seguridad**: `VACUUM INTO` cada `TP_BACKUP_INTERVAL_MIN` a dos destinos (`TP_BACKUPS_DIR_2` = USB), rotación 48 + 1/hora, verificar (abre y cuenta filas), restaurar con la palabra RESTAURAR (guarda copia previa) y `npm run restore` con el host apagado.
- **Purga a 90 días** (`TP_RETENTION_DAYS`): job diario + botón con doble confirmación (nombre del evento) + `npm run purge -- --dry-run`.
- Reportes: `GET /reports/day-close` (JSON/CSV), `GET /alerts/denied`, `GET /live`.
- Migraciones del host `002_companions.sql`, `003_panel_standby_pii.sql`, `004_batches_delivered.sql`; de la nube `002_credential_token.sql` (SQLite y Postgres).
- Suite **e2e con Playwright** (`e2e/`, 17 pruebas trazadas a TC): host real sobre base temporal con proxy controlable (apagar/encender), scanner en modo prueba (`window.__tpScan`) y nube con base temporal.
- Demo interactiva y diseño en `design/` (14 escenarios, flujo del evento, academias ITF reales como clubes de ejemplo).

### Cambiado
- `docs/80-COMO-PROBAR.md` reorganizado (panel, standby, cifrado, copias, purga, acompañantes, nube, simplificaciones honestas §9, e2e §10, dispositivos reales §11); `docs/00-DECISIONES.md` §7 y §8 con las decisiones de acompañantes y pull desde la nube; `docs/85-DESPLIEGUE-NUBE.md` con clave compartida, credencial digital y cron de lista de espera.
- `apps/host/src/repos.ts`: SQL directo con `better-sqlite3` en lugar de Drizzle (ADR-0001).

### Corregido
- Dígito verificador real del ID de ejemplo `TP-2026-00123-C` en documentos y diseño.

### Seguridad
- Contraseñas y PIN del host con scrypt (`node:crypto`), aislado en `hashSecret`/`verifySecret` (ADR-0006); la nube usa Argon2id.
- El token del QR se registra en la auditoría cada vez que alguien lo ve (`CREDENTIAL_TOKEN_VIEWED`).

## [0.1.0] — 2026-10-09

### Añadido
- Monorepo npm workspaces con TypeScript estricto: `packages/core`, `apps/host`, `apps/scanner`, `apps/registration`, `apps/print`, `scripts/simulate.ts`, CI (`install · test · build · simulate · audit`).
- `packages/core` (dominio puro, Vitest con cobertura): tipos, ID corto con verificador Luhn mod 36, token QR `TP1.<payload>.<firma Ed25519>`, motor de reglas con mensajes en español, categorías de edad, log de eventos append-only con reconciliación, cadena de auditoría por hash, parser e importador SportData idempotente, validación de `event.config.json`.
- `apps/host`: API Fastify + SQLite (WAL) con enrolamiento de scanners (token de 10 min + PIN), `GET /sync/snapshot`, `POST/GET /sync/events`, revocación y re-emisión, reportes por puerta, auditoría encadenada, seed de 2.000 credenciales y usuarios por rol, Docker Compose con Caddy (CA interna).
- `apps/scanner`: PWA (Vite + React + Dexie) con validación offline, cámara `BarcodeDetector` y fallback ZXing, cola de pendientes con polling de 15 s.
- `apps/registration`: inscripción pública (Next.js 15) con cupos, edad/categoría y consentimiento de acudiente; importación SportData.
- `apps/print`: PDF de credenciales 100 × 150 mm (pdf-lib + qrcode) con color por rol, zonas, QR e ID corto.
- Documentación 00 (decisiones), 10 (PRD), 20 (plan de pruebas), 30 (arquitectura), 40 (seguridad e ISO 27001), 50 (operación), 60 (manuales por rol), 70 (UX writing), 80 (cómo probar).

[Sin publicar]: https://github.com/jsburbano/tatami-pass/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/jsburbano/tatami-pass/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/jsburbano/tatami-pass/releases/tag/v0.1.0

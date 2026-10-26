# 80 · Cómo probar Tatami Pass

> Comandos verificados en Linux con Node 22 (funciona con Node ≥ 20) y npm 10. Todo corre sin internet salvo el `npm install` inicial.

## 0. Requisitos

- Node 20 o superior, npm 10.
- Para `better-sqlite3` (módulo nativo) npm descarga un binario precompilado; si no hay binario para tu plataforma necesitas `python3`, `make` y `g++`.
- Opcional: Docker (solo para `docker compose` del host con Caddy).

## 1. Instalar y verificar todo (5 minutos)

```bash
git clone <repo> tatami-pass && cd tatami-pass
npm install            # instala los 5 workspaces y compila packages/core (hook "prepare")
npm test               # Vitest: core (unitarios, con cobertura) + host (integración de la API)
npm run build          # core → host → host-admin (panel, Vite) → print → registration (Next) → scanner (Vite)
npm run simulate       # simulación de carga: 2.000 credenciales, 8 puertas, corte de red
npm run print:sample   # genera apps/print/out/sample-credentials.pdf (12 credenciales)
```

Salida esperada:

- `npm test`: `packages/core` ≈ 111 tests (incluye `config-validation` y `field-crypto`), cobertura > 90 % de líneas; `apps/host` 59 tests de integración (API de sync, acompañantes, nube, API del panel, cifrado de PII, standby + promoción, copias de seguridad y purga). Sin fallos.
- `npm run simulate`: p95 de validación muy por debajo de 300 ms, 30/30 revocadas denegadas, 100/100 anti-passback denegados, 80/80 salidas, duplicados detectados en tiempo real en las puertas con red y 50/50 visibles en el host tras reconciliar, y la línea `eventos en host: N · suma de logs locales propios: N → CONSISTENTE`.
- `npm run print:sample`: imprime la ruta del PDF; ábrelo y comprueba que cada página mide 100 × 150 mm, con color por rol, nombre grande, zonas, QR e ID corto.

## 2. Host (L2) en local

```bash
npm run seed           # crea data/tatami.db con 2.000 credenciales, 7 usuarios y 4 scanners de demo (PIN 123456)
npm run dev:host       # http://localhost:8787
```

Usuarios de prueba (todos con contraseña `<usuario>123`): `admin`, `coord`, `print`, `club`, `control`, `super`, `audit`.

Prueba rápida de la API con `curl`:

```bash
curl -s localhost:8787/health | jq
TOKEN=$(curl -s -X POST localhost:8787/auth/login -H 'content-type: application/json' -d '{"username":"admin","password":"admin123"}' | jq -r .token)

# Token de enrolamiento (10 min) para una puerta de Tatamis
curl -s -X POST localhost:8787/devices/enroll-token -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"name":"Puerta T1","zone":"T"}' | jq
# → copia "token" y úsalo en la PWA del scanner (sección 3) o enrola por curl:
curl -s -X POST localhost:8787/devices/enroll -H 'content-type: application/json' -d '{"token":"<token>","pin":"123456"}' | jq
# → devuelve deviceToken; con él:
DEV=<deviceToken>
curl -s localhost:8787/sync/snapshot -H "authorization: Bearer $DEV" | jq '.credentials | length'   # 2000
curl -s "localhost:8787/sync/events?since=" -H "authorization: Bearer $DEV" | jq '.events | length'

# Revocar y re-emitir
ID=$(curl -s localhost:8787/sync/snapshot -H "authorization: Bearer $DEV" | jq -r '.credentials[0].id')
curl -s -X POST localhost:8787/credentials/$ID/revoke  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"reason":"perdida"}' | jq
curl -s -X POST localhost:8787/credentials/$ID/reissue -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"reason":"foto"}' | jq .credential.version

# Reporte, auditoría encadenada y backup
curl -s localhost:8787/reports/gate-summary -H "authorization: Bearer $TOKEN" | jq
curl -s localhost:8787/audit -H "authorization: Bearer $TOKEN" | jq .verification
curl -s -X POST localhost:8787/backup/snapshot -H "authorization: Bearer $TOKEN" | jq   # VACUUM INTO backups/
```

Variables de entorno útiles: `PORT`, `TP_DB_PATH`, `TP_KEYS_DIR`, `TP_KEY_PASSPHRASE` (obligatoria en producción; cifra la clave Ed25519 en `keys/signing.enc.json` **y** deriva la clave de los campos sensibles, §2.3), `TP_EVENT_CONFIG` (ruta a `event.config.json`), `TP_BADGE_TEMPLATE` (ruta a `badge-template.json`; por defecto junto a la base, [33](./33-DISENO-CREDENCIAL.md)), `TP_CLOUD_URL` / `TP_CLOUD_KEY` / `TP_CLOUD_INTERVAL_MIN` (actualización desde la nube, §8), `TP_BACKUPS_DIR` / `TP_BACKUPS_DIR_2` / `TP_BACKUP_INTERVAL_MIN` / `TP_BACKUP_KEEP` (copias, §2.4), `TP_ROLE` / `TP_PRIMARY_URL` / `TP_REPLICA_KEY` (equipo de respaldo, §2.2), `TP_RETENTION_DAYS` (purga, §2.5), `TP_SQLITE_NATIVE_BINDING` (ruta a un `better_sqlite3.node` compilado para otro runtime; solo la usa la app de escritorio, [86 §7](./86-APP-ESCRITORIO.md)).

### 2.1 Panel del host (`/admin`)

El host sirve el panel de administración compilado (`apps/host-admin`, Vite + React) en el **mismo origen** que la API, así que no hay CORS ni direcciones que configurar en producción.

```bash
npm run build -w apps/host-admin   # → apps/host/public/admin (lo hace también `npm run build`)
npm run seed && npm run dev:host   # http://localhost:8787/admin
npm run dev:admin                  # opcional: Vite en http://localhost:5174 con recarga en caliente (pide la dirección del host en el login)
```

Entra con un usuario del seed. Cada rol ve solo sus páginas (el host aplica el mismo RBAC en cada endpoint, así que un enlace copiado a mano responde 403):

| Usuario | Páginas |
|---|---|
| `admin` | todas |
| `coord` | todas menos Usuarios |
| `print` | Credenciales, Inscripciones, Impresión, Nube |
| `super` | Puertas en vivo, Credenciales, Inscripciones, Dispositivos, Alertas |
| `audit` | todo en solo lectura (sin botones de acción) |

Qué probar por página (todo con mensajes en español, confirmaciones en lo destructivo y estados vacíos; se usa bien en una tablet de 10"):

1. **Puertas en vivo** (`GET /live`, refresco cada 5 s): ingresos de hoy, ritmo/min y pico, pendientes por enviar, alertas abiertas; tabla por puerta (zona, ritmo, hoy, rechazos, último escaneo, pendientes, estado conectado / sin reportar / sin conexión / desactivado); "Dentro ahora" por zona con control de salida; últimos escaneos. Sube escaneos con un scanner (§3) y mira cómo cambia.
2. **Credenciales**: busca por nombre, ID corto, club o documento (el documento se busca por HMAC: nunca se descifra para buscar). Toca una fila: ficha con foto o iniciales, estado, versión, zonas, acompañantes, anulaciones e historial de escaneos. Acciones: **Anular** (motivo obligatorio), **Re-emitir** (versión nueva; la anterior queda anulada), **Marcar entregada**, **Ver QR / token** (QR en pantalla + token copiable; queda en la auditoría), **Ver / imprimir PDF** y **Descargar PDF** (`GET /credentials/:id/pdf`).
3. **Inscripciones**: lo que la nube trajo y aún está "Emitida" (`GET /registrations/pending`) con botón **Crear lote**; y **Emitir en sitio** (`POST /credentials/issue`): prueba un competidor con fecha de 2014 sin acudiente (bloquea y explica), un documento repetido (409 con el ID existente), un rol lleno (sube/baja el cupo en Evento y roles) y un acompañante ligado a un participante por ID corto.
4. **Impresión**: crea un lote por rol/club/estado (el panel adelanta cuántas entrarían), **Vista previa** del lote, **Descargar PDF** (usa `apps/print`), **Marcar como impreso** y luego **Marcar entregado**. "Imprimir una sola credencial" abre la ficha por ID corto.
5. **Dispositivos**: lista con zona editable en línea, última conexión, pendientes y estado; **Enrolar un scanner** genera el código (QR en pantalla con cuenta regresiva de 10 min + dirección y código en texto); **Desactivar** con confirmación (el scanner recibe 401 desde ese momento).
6. **Alertas**: duplicados (`ALERT`/`DUPLICATE`), ingresos manuales con motivo y scanners sin conexión > 5 min, en pestañas Abiertas/Resueltas; **Resolver** pide una nota. Debajo, **Intentos denegados hoy** por puerta (con % de rechazo) y los últimos casos con motivo (`GET /alerts/denied`).
7. **Evento y roles**: edita nombre, fechas, zona horaria, aforo total, acompañantes, zonas, roles (zonas, cupo, color, foto, digital, anti-passback), categorías de edad; **Nuevo rol**; la validación (`validateEventConfig`) marca el campo con error; **Guardar cambios** escribe `event.config.json` y recarga en caliente (`PUT /config` con `expectedVersion`: si otro admin guardó antes, 409 y te pide recargar).
8. **Nube**: estado de `GET /sync/cloud/status`, **Traer ahora**, **Ver qué hay por traer** (`GET /sync/cloud/preview`: consulta la nube sin aplicar nada) e intervalo editable (`PUT /sync/cloud/settings`, se guarda en la base). Sin `TP_CLOUD_URL` la página explica cómo configurarla.
9. **Auditoría**: tabla paginada con filtro por acción y usuario, detalle del registro al tocar, **Verificar cadena**, **Exportar CSV / JSON** (el panel muestra la huella SHA-256 del archivo).
10. **Sistema**: salud (reloj, disco, cifrado, clave de firma, integridad de la auditoría), **copias de seguridad** (lista en los dos destinos, **Hacer copia ahora**, **Verificar** abre la copia y cuenta filas, **Restaurar** con la palabra RESTAURAR), **equipo de respaldo** (estado de replicación y **Convertir en principal** con la palabra PROMOVER), **purga** (fecha automática, personas con datos, botón con doble confirmación: aviso + nombre del evento) y reportes de cierre.
11. **Usuarios** (solo admin): crear, desactivar (cierra sus sesiones) y restablecer contraseña.

Captura automática de todas las páginas (login + 11 páginas + tablet + tres roles) en `design/screenshots/admin-*.png`; se generó con Playwright/Chromium contra el host con seed y sin errores de consola.

### 2.2 Equipo de respaldo (standby) y promoción

```bash
# Terminal 1 · principal (con clave de replicación)
TP_REPLICA_KEY=clave-compartida npm run dev:host
# Terminal 2 · respaldo: misma TP_KEY_PASSPHRASE y misma carpeta keys/, otra base y otro puerto
PORT=8788 TP_DB_PATH=data/standby.db TP_ROLE=standby TP_PRIMARY_URL=http://localhost:8787 TP_REPLICA_KEY=clave-compartida npm run dev:host
curl -s localhost:8788/health | jq '{role, lagSeconds, standby: .standby.message}'   # replica cada 10 s (snapshot + cambios)
```

En el respaldo el panel (`http://localhost:8788/admin`) abre en modo consulta: cualquier cambio responde 409 "Este equipo es el de respaldo". Para promoverlo, Sistema › **Convertir este equipo en el principal** (PROMOVER) o, desde la consola, `npm run promote -w apps/host` (imprime las instrucciones para apuntar scanners y DNS). Después acepta escaneos y cambios y deja de replicar. Test automático: `apps/host/test/standby.test.ts` (100 escaneos + revocación + config + usuario + zona replicados, primario caído, promoción y escaneos nuevos).

### 2.3 Cifrado en reposo

Documento, fecha de nacimiento y documento del acudiente se guardan cifrados con AES-256-GCM (`packages/core/src/field-crypto.ts`, JS puro) con clave derivada por scrypt de `TP_KEY_PASSPHRASE` + un salt por evento (`meta.pii_salt`). La búsqueda por documento usa un HMAC indexado. Las bases anteriores se cifran solas al arrancar (`PII_ENCRYPTED` en la auditoría). Compruébalo:

```bash
sqlite3 apps/host/data/tatami.db "select birth_date, document_number, guardian_json from persons limit 2"   # enc:v1:…
```

Tests: `packages/core/test/field-crypto.test.ts` (incluida compatibilidad byte a byte con `node:crypto`) y `apps/host/test/pii.test.ts`.

### 2.4 Copias de seguridad

Snapshot `VACUUM INTO` cada `TP_BACKUP_INTERVAL_MIN` (5) en `TP_BACKUPS_DIR` y, si existe, en `TP_BACKUPS_DIR_2` (la USB; si no está montada la copia principal se hace igual y Sistema lo avisa). Rotación: se conservan `TP_BACKUP_KEEP` (48) recientes + 1 por hora de las anteriores. `POST /backup/verify` abre la copia en solo lectura, pasa `integrity_check` y cuenta filas. Restaurar con el host apagado:

```bash
npm run restore -w apps/host -- tatami-2026-11-20T10-05-00-000Z.db        # verifica y muestra qué haría
npm run restore -w apps/host -- tatami-2026-11-20T10-05-00-000Z.db --yes  # guarda una copia del estado actual y reemplaza la base
```

### 2.5 Purga a 90 días

Job diario en el host (`PurgeScheduler`): cuando `endDate + TP_RETENTION_DAYS` (90) pasó, borra nombre, documento, fecha de nacimiento, acudiente y foto de todas las personas, anonimiza el nombre visible de sus credenciales y guarda un resumen agregado en `meta.purge_summary`. Conserva escaneos, credenciales (rol, zonas, estado) y la auditoría (sin PII). Manual: Sistema › **Purgar datos personales ahora** (doble confirmación) o `npm run purge -w apps/host -- --dry-run`. Test: `apps/host/test/panel-api.test.ts` y `admin-api.test.ts`.

### Docker + Caddy (HTTPS en LAN)

```bash
cd apps/host
echo "TP_KEY_PASSPHRASE=cambia-esto" > .env
docker compose up --build
# https://localhost (certificado de CA interna de Caddy). Para los celulares, exporta el root:
docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt ./root.crt
```

## 3. Scanner (L1, PWA)

```bash
npm run dev:scanner        # http://localhost:5173 (usa --host para abrirlo desde un celular en la misma Wi-Fi)
npm test -w apps/scanner   # Vitest: modos y anti-doble-lectura, ingreso manual (verificador + motivos), PIN de supervisor local,
                           # bloqueo por inactividad, resumen de turno, eventos de dispositivo en la cola, caché de fotos,
                           # cola de pendientes (fake-indexeddb), bloqueo de PIN, cámara, tonos, búsqueda, reloj,
                           # y un test de componente Escanear → Resultado (Testing Library + jsdom)
npm run build -w apps/scanner && npm run preview -w apps/scanner   # build real con service worker (http://localhost:4173)
```

Pantallas, en el orden en que las ve el portero (capturas en `design/screenshots/scanner-*.png`):

1. **Enrolar este dispositivo**: dirección del host (`http://localhost:8787` en dev) + código de enrolamiento (del paso 2, o escaneado del QR) + PIN de 6 dígitos. Debajo, la tarjeta **Instala la app** con las instrucciones de Android/iOS (y botón "Instalar ahora" cuando Chrome lo ofrece); se oculta cuando ya corre instalada.
2. **Inicio de turno**: *¿Quién controla esta puerta?* (nombre del operador), **zona** y **modo de la puerta** (Entrada / Salida / Entrada + Salida). "Empezar a escanear" sin cambiar nada no pide nada; cambiar zona o modo pide **PIN de supervisor** (ver 8). Al empezar queda un evento `shift_start` en la cola.
3. **Escanear**: franja de modo (azul Entrada, roja Salida, negra Entrada + Salida), visor con esquinas guía y línea de barrido, botones ⟳ (cambiar cámara) y 🔦 (linterna, si el track la soporta), y **Ingreso manual**. Arriba: puerta · zona · modo, **Pendientes** y el punto de host (verde conectado, gris "Sin conexión · sigue escaneando"). Lector nativo `BarcodeDetector` si existe; si no, `@zxing/browser` (chunk aparte, aparece "lector JS" en el visor). Enfoque continuo cuando la cámara lo permite.
4. **Resultado**: pantalla de un solo color con sonido y vibración distintos (OK: dos notas ascendentes y 1 vibración; NO: zumbido grave y 2; ALERTA: triple pitido y 3; WebAudio sin archivos). Foto de la credencial (`photoUrl`, cacheada en IndexedDB tras la primera vez; iniciales si no hay), **nombre grande**, rol con su color, club, dirección · zona · hora. En **verde** el botón "Siguiente · 3" cuenta y se cierra solo a los 3 s; en **rojo/ámbar** no se cierra solo y aparece **Autorizar (supervisor)**.
5. **Anti-doble-lectura**: el mismo token no se procesa dos veces en 2 s (ni desde la cámara ni desde manual; el visor avisa "Ya leído · espera 2 s"). Pruébalo pegando dos veces seguidas el mismo token.
6. Sin cámara (escritorio o `http://`) el visor muestra "No puedo abrir la cámara" con **Reintentar**; usa **Ingreso manual** y pega el `token` (se obtiene con `GET /credentials/:id` como `admin`/`print`): "Validar código pegado" evalúa igual que la cámara.
7. **Ingreso manual**: escribe el **ID corto** (admite minúsculas y sin guiones); el dígito verificador se valida al escribir ("El último carácter no coincide…" en rojo, "✓ ID correcto" en verde) y la persona aparece con foto/iniciales, rol, club y zonas. También busca por **nombre** (sin tildes). **Registrar ingreso con motivo** abre el catálogo (*QR no se lee · Credencial provisional · Autorizado por supervisor · Planilla · Otro* — "Otro" exige texto) y las reglas deciden igual; el motivo viaja en `manual` del evento como `manual_entry`. **Solo validar (sin motivo)** evalúa sin dejar motivo.
8. **Excepción de supervisor**: en rojo/ámbar toca **Autorizar (supervisor)** → PIN de 6 dígitos. Vale sin red el PIN del propio dispositivo si está enrolado con rol `SUPERVISOR` (en el panel: Dispositivos › Enrolar › rol Supervisor), o los `supervisorPins` que vengan en `config` del snapshot; si no hay PIN local, el formulario **usuario + contraseña** lo valida el host (`super`/`super123`; `control` es rechazado). Luego el catálogo (*Salió sin escanear · Error de puerta · Autorización del Coordinador · Otro*) y sale verde `OK_MANUAL` "Ingreso manual autorizado por <supervisor>". Queda como evento `exception` con `authorizedBy`.
9. **Anti-passback**: pega dos veces la misma credencial en zona `T`: la segunda da **"No puede entrar — ya entró a Tatamis a las H:MM"**. Menú ⋯ › **Cambiar zona o modo** › modo **Salida** (PIN de supervisor) → la franja pasa a roja y el mismo token da "Salida registrada"; vuelve a Entrada y pasa. En **Entrada + Salida** cada lectura pregunta **¿Entra o sale?** con dos botones grandes.
10. **Sin host**: apaga el host (`Ctrl+C`): el punto pasa a gris "Sin conexión · sigue escaneando", los escaneos siguen desde el snapshot guardado y **Pendientes** crece. La bandeja muestra el contador, el estado del host con la última sync, una explicación calmada, **Reintentar ahora** y la lista (escaneos y eventos de dispositivo). Enciende el host: en ≤ 15 s baja a 0 y además se **refresca el snapshot al reconectar** (así una revocación hecha mientras estaba sin red llega en el primer tick).
11. **Turno**: menú ⋯ › **Terminar turno** → resumen con entradas, salidas, negados (y lista por motivo), alertas, manuales/excepciones y pendientes → **Cerrar sesión** deja un evento `shift_end` con esos totales y vuelve al PIN. "Resumen del turno" en el menú muestra lo mismo sin cerrar.
12. **PIN y bloqueo**: 5 PIN incorrectos → bloqueo de 15:00 con cuenta regresiva (sobrevive recargas; los pendientes quedan intactos). Tras **5 min sin tocar la pantalla** (o menú › Bloquear pantalla) aparece "Pantalla bloqueada": el PIN vuelve a la cámara con el mismo turno. La sesión vence a las **12 h**.
13. **Accesibilidad**: botones ≥ 56 px; menú › **Modo guantes** (botones ≥ 72 px, teclado 84 px) y **Alto contraste** (bordes marcados, sin degradados) se recuerdan en el dispositivo.
14. **Modo kiosk** (menú ⋯): pantalla completa, wake lock y bloqueo del botón atrás. **Cambiar dirección del host** comprueba `/health` antes de guardar (sirve para apuntar al standby).
15. **Reloj desincronizado**: si el reloj difiere más de 5 min del `serverTime` del host aparece una franja ámbar; los escaneos se guardan ya con la hora corregida.
16. **PWA**: `manifest.webmanifest` completo (iconos PNG 192/512 + maskable en `public/icons`, generados con `node apps/scanner/scripts/gen-icons.mjs`), `sw.js` con **precache del build** (la lista y el id de versión los rellena `vite.config.ts` al compilar; ver `dist/sw.js`), shell cache-first, navegación network-first y API network-first (solo GET de `/sync/snapshot` como último recurso). Al publicar un build nuevo la app muestra **"Hay una versión nueva · Actualizar"** (banner y menú); al tocar, el SW en espera toma el control y recarga. Pruébalo: `npm run preview -w apps/scanner`, abre, vuelve a compilar con cualquier cambio, recarga una vez y espera el banner.
17. Con un celular la cámara requiere HTTPS (Caddy del punto 2 o un túnel). Elige la **cámara trasera** automáticamente (etiquetas back/rear/trasera, descarta ultra-wide/tele).

Modo prueba: `VITE_E2E=1` (o `npm run build:e2e -w apps/scanner`) expone `window.__tpScan(token, { direction?, override? })`, `window.__tpSync()`, `window.__tpStatus()` y `window.__tpIdle()` para inyectar lecturas o inactividad sin cámara; nunca va en el build normal (§10).

### 3.1 Tatami Radio con dos celulares

1. Host con HTTPS (app de escritorio con Caddy o Docker + Caddy, §2) y los dos celulares en la **misma Wi-Fi de staff** sin aislamiento de clientes. Enrola los dos (uno como Control, otro como Supervisor) y abre el scanner por `https://`.
2. Empieza turno en ambos; al primer arranque el celular pide **micrófono**: Permitir. La píldora **Radio** pasa a punto verde; tócala: "Conectada · 2 en el canal".
3. Mantén pulsado el botón grande en A y habla: en B el indicador dice "{A} hablando" y se oye (< 300 ms). Prueba con altavoz: la cancelación de eco debe evitar el acople; si acopla, baja el volumen.
4. Pulsa en B mientras A habla: "Ocupado · {A} está hablando"; sigue pulsando, suelta A: B pasa a "Hablando" solo.
5. En el portátil, `/admin` (admin/admin123) › **Radio**: ves los dos en Puertas y quién habla. Envía "Abrir Puerta 1" al canal: ambos suenan, vibran, la leen en voz alta y abren la radio; toca Recibido en uno: el panel muestra "{A} recibió hh:mm".
6. Mantén pulsado **🚨 Emergencia** en el supervisor: en A suena la sirena, vibra, salta a Emergencia y te oye; al soltar, 5 s después vuelve a Puertas.
7. Apaga el host (o desconecta su Ethernet) con A hablando: B sigue oyendo; el botón de A dice "Hablando (sin host)". Enciende el host: en < 10 s ambos vuelven a "Conectada" sin cortar el audio.
8. Bloquea la pantalla del iPhone mientras habla: deja de oírse (límite de iOS; documentado en docs/34 §5). En Android aguanta unos segundos.
9. Historial: `/admin` › Radio › Historial del día, o `curl -H "Authorization: Bearer $TOKEN" https://host/radio/events`.

En desarrollo sin HTTPS vale `localhost` en el mismo computador (dos ventanas de Chrome en modo incógnito) pero no desde celulares. Modo prueba (`VITE_E2E=1`): `window.__tpRadio()`, `window.__tpRadioStats()` y `window.__tpRadioClient`.

### Eventos nuevos en el log de sync (sin cambios en el host)

Todo viaja por `POST /sync/events` con la forma de `ScanEvent`; el detalle va en `manual` (único JSON libre que el host persiste en `manual_json`). Definidos en `packages/core/src/device-events.ts`.

| Tipo (`manual.type`) | Qué es | `decision` / `reasonCode` | Campos en `manual` |
|---|---|---|---|
| `manual_entry` | ID escrito a mano con motivo; las reglas deciden | el de las reglas (`ALLOW OK_PHOTO_CHECK`, `DENY …`) | `reasonCode` (catálogo), `reason`, `by` (operador) |
| `exception` | Supervisor autorizó con PIN tras rojo/ámbar | `ALLOW OK_MANUAL` | `reasonCode`, `reason`, `by` (operador), `authorizedBy` (supervisor), `overrides` (motivo que anuló) |
| `zone_change` / `mode_change` | Cambio de zona o modo autorizado | `EVENT ZONE_CHANGE` / `EVENT MODE_CHANGE`, `credentialId: null` | `from`, `to`, `by`, `authorizedBy`, `reason` legible |
| `shift_start` | Inicio de turno | `EVENT SHIFT_START` | `by`, `gate`, `zone`, `mode` |
| `shift_end` | Fin de turno con resumen | `EVENT SHIFT_END` | `by`, `gate`, `zone`, `mode`, `startedAt`, `totals { scans, entries, exits, denied, deniedByReason, alerts, manual, exceptions, pending }` |
| `radio_ptt` / `radio_order` / `radio_ack` | Tatami Radio: quién habló (canal, inicio, duración), orden enviada, acuse. Los escribe el **host** bajo el dispositivo virtual `radio` (seq propio), no el scanner. `zone` = canal. | `EVENT RADIO_PTT` / `RADIO_ORDER` / `RADIO_ACK` | `by`, `participantId`, `channel`, `durationMs`, `emergency` / `orderId`, `code`, `text`, `to` / `orderId`, `code` (docs/34 §2) |

Nota honesta: el host de hoy acepta y guarda estos eventos tal cual, pero su `reports.ts`/`alerts` tratan cualquier `manual` como "ingreso manual" (abren una alerta MANUAL y lo cuentan). Para que `zone_change`/`shift_*` no inflen ese contador basta con filtrar `decision === 'EVENT'` (o `manual.type`) en el host; entradas/salidas/negados no se ven afectados porque no son `ALLOW`/`DENY`/`ALERT`.

## 4. Inscripción online (L3, Next.js)

```bash
npm run dev:registration   # http://localhost:3000
npm test -w apps/registration   # Vitest: validación, repositorio (SQLite; Postgres si hay DATABASE_URL), lista de espera, export, credencial digital, fotos/zod, clave del host
```

- `/`: formulario. Prueba un menor (fecha de nacimiento 2012-05-01) con categoría Adulto: bloquea y explica; pide acudiente y consentimiento. Al final hay una casilla de **aviso de privacidad** (texto editable desde el panel) sin la cual no se envía.
- **Foto:** "Elegir foto" abre el selector (en el celular, la cámara frontal); se recorta en cuadrado en el navegador (arrastrar + zoom) y se envía como JPEG de 600×600 (≈ 100 KB; el servidor acepta hasta 2 MB y comprueba la firma JPEG/PNG). En dev se guarda en `apps/registration/data/photos/` y se sirve por `/api/photos/<nombre>`; con `BLOB_READ_WRITE_TOKEN` va a Vercel Blob. Es opcional salvo `PHOTO_REQUIRED=1`.
- **Acompañantes:** sección 7.
- Cupos: ya no se tocan en `event.config.json`: Panel › **Cupos** (sección 4.1).
- Importar SportData vive en el panel (`/import` redirige a `/panel/importar`).

API directa:

```bash
curl -s localhost:3000/api/status | jq .roles
curl -s -X POST localhost:3000/api/register -H 'content-type: application/json' -d '{"firstName":"Ana","lastName":"Ruiz","birthDate":"2012-05-01","roleCode":"COMP","categoryCode":"JUV","guardianName":"Pedro","guardianDocument":"1","guardianConsent":true,"privacyConsent":true,"email":"ana@correo.com"}'
curl -s -X POST localhost:3000/api/register -H 'content-type: application/json' -d '{"firstName":"X","photo":"http://no"}' | jq .errors   # zod: forma y tamaños antes de la lógica de negocio
```

La base de dev es SQLite en `apps/registration/data/registration.db` (adaptador `apps/registration/lib/db/`: `sqlite.ts` y `postgres.ts` detrás de la misma interfaz `SqlDriver`; migraciones en `apps/registration/migrations/<dialecto>/`, `npm run migrate -w apps/registration`). Para Vercel + Neon + Blob + Resend sigue `docs/85-DESPLIEGUE-NUBE.md`.

### 4.1 Panel de coordinación (`/panel`)

Primer administrador: define `ADMIN_EMAIL` y `ADMIN_PASSWORD` (en `.env.local` o al correr `npm run migrate`); se crea si no hay usuarios. Entra en `http://localhost:3000/panel/login`. Sesión = cookie firmada (HS256, 12 h, HttpOnly); 5 intentos por minuto por correo.

| Sección | Qué probar |
|---|---|
| **Inscripciones** | Filtros por estado/rol/categoría/club y búsqueda (nombre, documento, código). Aprobar / rechazar con motivo (la persona recibe correo). "Aprobar todas las validadas". Abrir la ficha: editar datos (recalcula duplicados; menor exige acudiente), cambiar foto, agregar/quitar acompañantes (respeta el límite), enlace de credencial digital. |
| **Lista de espera** | Por rol y categoría en orden de llegada. **Liberar un cupo** manda correo con enlace `/confirmar/<token>` de 48 h; al abrirlo pasa a pendiente. Las ofertas vencidas pasan al siguiente al abrir la página (o con el cron). "Pasar a pendiente" salta el correo. |
| **Duplicados** | Mismo documento, o mismo nombre + fecha de nacimiento con club distinto. Fusionar (conserva una, completa datos y mueve acompañantes) o "son personas distintas". |
| **Cupos** | Uso real por rol, categoría, acompañantes y aforo; editar límites y marcar "sin límite". El formulario los usa de inmediato. Los inscriptores lo ven en solo lectura. |
| **Importar SportData** | Lo de antes, con historial de lotes. |
| **Credenciales** | Lo que exportó la nube y lo que reporta el host (`POST /api/host-report`); anular / retirar anulación. |
| **Exportar** | CSV y JSON de aprobados; endpoint `GET /api/export` para el host; la **clave** solo la ve el admin y puede regenerarla (la anterior deja de valer al instante). |
| **Clubes e inscriptores** | Crear club, invitar inscriptor (correo con enlace de activación de 7 días), reenviar invitación, borrar. |
| **Configuración del evento** | Nombre, fechas, nombre/foto/credencial digital por rol, categorías de edad, apertura y cierre del formulario, textos y aviso de privacidad. |

### 4.2 Portal de club (inscriptor)

1. Panel › Clubes e inscriptores › crea "Club X" e invita `club@correo.com` con rol Inscriptor y ese club. Abre el `.eml` de `data/outbox/` y sigue el enlace `/panel/activar/<token>`: crea contraseña y entra.
2. Solo ve **Inscripciones** de su club (por `delegationId` o por nombre del club), **Cupos** (lectura) y **Reportes** de su club. No puede aprobar. Puede **editar** y agregar/quitar acompañantes **hasta la fecha de cierre** del formulario (Configuración del evento); después, la ficha lo explica. Una ficha ajena da 404.
3. Botón "Inscribir a alguien" abre el formulario público.

### 4.3 Participante: estado y credencial digital

- Correo de confirmación con el código `N26-XXXXXX` y enlace `/estado/<código>`: línea de tiempo (recibida → validada → aprobada → credencial emitida → entregada) sin datos sensibles.
- Correo de aprobación: para roles con credencial digital (General y los acompañantes, siempre) incluye un enlace `/credencial/<token>` por persona. La página muestra un **QR rotativo** (`TP1.` con `iat`/`exp`, ventana 60 s, se renueva cada 30 s) cuando (a) la inscripción está aprobada, (b) el host reportó el ID de la credencial y (c) la nube tiene `TP_SIGNING_KEY` (la clave del host). Para probarlo en dev:

```bash
# 1. clave de firma de prueba (en producción es la del host, docs/85 §7)
node -e "const c=require('./packages/core/dist/index.js');console.log(JSON.stringify(c.generateKeyPair('k1')))"
TP_SIGNING_KEY='{"kid":"k1",...}' TP_CLOUD_KEY=secreto npm run dev:registration
# 2. inscribe un General con correo, apruébalo en el panel y simula el reporte del host:
curl -s -X POST localhost:3000/api/host-report -H 'x-tatami-key: secreto' -H 'content-type: application/json' -d '{"credentials":[{"externalId":"<id de la inscripción>","credentialId":"TP-2026-00123-C","status":"ISSUED","version":1}]}'
# 3. abre el enlace /credencial/<token> del correo (data/outbox) o de la ficha: QR + "Vence en N s"
curl -s localhost:3000/api/credencial/<token> | jq '{state, credentialId, exp: .qr.expiresAt}'
```

El token se puede verificar con la clave pública: `verifyToken(token, [{kid, publicKeyHex}])` del core (test `apps/registration/test/digital.test.ts`).

### 4.4 Correos en dev

Sin `RESEND_API_KEY` cada correo se escribe como `.eml` en `apps/registration/data/outbox/` (`MAIL_OUTBOX_DIR`) y se registra en consola. Plantillas en `lib/mail-templates.ts`: inscripción recibida (o lista de espera), se abrió un cupo (48 h), aprobada (con enlaces digitales) / no aprobada (con motivo), invitación al panel. Ábrelos con cualquier cliente de correo o `cat`.

### 4.5 Verificación automática con Chromium

El flujo completo (inscripción con foto y acompañantes → login → editar → aprobar → cupos → lista de espera → confirmar → duplicados → exportar y rotar clave → reporte del host → credencial digital → club invitado → portal de club → rate limit y cabeceras) se recorrió con Playwright contra `next start`; las capturas están en `design/screenshots/panel-*.png` (00 inscripción … 16 cupos del club).

## 5. Impresión

```bash
npm run print:sample                           # 12 credenciales de muestra con clave efímera
npm run print -w apps/print -- lote.json out/lote.pdf apps/host/event.config.json
```

`lote.json` es un array de credenciales con `token` (lo que devuelve `GET /credentials/:id` al usuario `print`) y, opcionalmente, `person` (`documentNumber`, `delegation`, `emergencyContact`, `eps`).

`print:sample` escribe en `apps/print/out/`: `sample-credentials.pdf` (12 credenciales, anverso + reverso con la plantilla "Nacional 2026"), `sample-duplex.pdf` (ambos lados en una hoja) y `sample-front.png` / `sample-back.png` si hay `pdftoppm` (`apt install poppler-utils`; si no, abre el PDF). Las fuentes Barlow se embeben desde `apps/print/fonts/`; si faltan, verás "fuentes Helvetica" en la salida.

### 5.1 Editor del diseño de la credencial (panel)

1. `npm run seed && npm run dev:host` → `http://localhost:8787/admin` (admin/admin123) › **Impresión** › pestaña **Diseño de la credencial**.
2. La vista previa de la derecha aparece sola (imagen si tienes poppler; si no, PDF embebido). Cambia el color **Acento (rosa)**: unos 600 ms después la vista previa se regenera con el color nuevo y aparece "Cambios sin guardar".
3. **Logos y archivos**: sube un PNG con id `logo-prueba` → aparece en la lista y en el desplegable "Añadir logo subido…" del pie. Añádelo y mira el pie en la vista previa.
4. **Exportar plantilla (.json)** descarga `plantilla-credencial-nacional-2026.json`; **Importar plantilla** la vuelve a cargar.
5. **Guardar diseño** → toast "Diseño guardado…", `apps/host/data/badge-template.json` cambia (o `TP_BADGE_TEMPLATE`) y `GET /print/template` devuelve `isDefault: false`. Crea un lote y descarga el PDF: dos páginas por credencial.
6. **Privacidad**: apaga "Imprimir el documento de identidad" → en la vista previa el campo DOCUMENTO sale vacío (el host no se lo manda al renderer).
7. **Restablecer diseño del piloto** (confirmación) vuelve al diseño de referencia.
8. Entra como `print`: la pestaña se ve en solo lectura y `PUT /print/template` responde 403.

Automático: `npx playwright test tc-110 -w e2e` (deja capturas en `design/screenshots/badge-*.png`); unitario `apps/host/test/badge-template.test.ts` y `packages/core/test/badge-template.test.ts`, `code128.test.ts`.

## 6. Qué mirar en CI

`.github/workflows/ci.yml` (Node 20, caché de npm):

| Job | Cuándo | Qué hace |
|---|---|---|
| **unit** | cada push y PR | `npm test` (core con cobertura, host, scanner, nube) + `npm run build` + `print:sample` + `npm audit --audit-level=high`; sube cobertura y el PDF. |
| **simulate** | cada push y PR | `npm run simulate` y sube el log. |
| **e2e-smoke** | cada PR | `preflight.sh` + `npm run e2e:smoke` (flujo maestro + menor). Artefactos solo al fallar. |
| **e2e-full** | `main`, nightly (03:17 UTC) y a mano | `npm run e2e` completo; en el nightly (o `workflow_dispatch` con `perf`) también `npm run e2e:perf`. Sube `playwright-report` siempre y `test-results` (capturas, vídeo, trazas) al fallar. |

## 7. Acompañantes por participante

Config en `apps/host/event.config.json`: rol `ACOMP` (zona `G`, digital), `companions: { perParticipant: 2, total: null }` y `totalCapacity: 2000` (`null` = sin límite). La regla vive en `packages/core/src/companions.ts` (`validateCompanions`).

```bash
npm test -w packages/core          # incluye test/companions.test.ts (límite por participante, sin límite, cupo total, aforo, mensajes)
npm run dev:registration           # http://localhost:3000
```

En el formulario, tras los datos del competidor aparece **Acompañantes** con el contador "0 de 2": agrega dos (nombre obligatorio; documento y parentesco opcionales) y verás que "Agregar acompañante" se desactiva con "Este participante ya tiene 2 acompañantes, el máximo permitido". Envía: la confirmación lista los acompañantes y `GET /api/status` muestra `companions.usedTotal` y `usedTotalEvent`.

Por API (el tercero falla con 400 y `errors.companions`):

```bash
curl -s -X POST localhost:3000/api/register -H 'content-type: application/json' -d '{"firstName":"Ana","lastName":"Ruiz","birthDate":"2000-05-01","roleCode":"COMP","categoryCode":"ADU","club":"Caucana","companions":[{"name":"Pedro Ruiz","document":"9","relationship":"Padre"},{"name":"Lina Ruiz"}]}' | jq '.companions[] | {firstName, roleCode, companionOf}'
curl -s -X POST localhost:3000/api/register -H 'content-type: application/json' -d '{"firstName":"Ana","lastName":"Ruiz","birthDate":"2000-05-01","roleCode":"COMP","categoryCode":"ADU","club":"Caucana","companions":[{"name":"Uno"},{"name":"Dos"},{"name":"Tres"}]}' | jq .errors
curl -s localhost:3000/api/status | jq '{companions, totalCapacity, usedTotalEvent}'
```

Para probar "Se llenó el cupo de acompañantes" pon `companions.total: 1`; para "El evento llegó a su aforo total" pon `totalCapacity: 1` (reinicia la app).

En el host, el seed crea 0–2 acompañantes por competidor (dentro de las 2.000 credenciales):

```bash
npm run seed && npm run dev:host
ID=$(sqlite3 apps/host/data/tatami.db "select id from credentials where role_code='COMP' and id in (select companion_of from credentials) limit 1")
curl -s localhost:8787/credentials/$ID/companions -H "authorization: Bearer $TOKEN" | jq '{count, limits, companions: [.companions[] | {id, displayName, roleCode, zones}]}'
```

## 8. Actualización desde la nube (botón + periódica)

La nube (`apps/registration`) expone `GET /api/export?since=` protegido por `x-tatami-key`; el host la consume con `POST /sync/cloud/pull` (botón) y con un scheduler cada `TP_CLOUD_INTERVAL_MIN` minutos (5 por defecto, `0` = solo manual). Test automático con nube falsa: `apps/host/test/cloud-sync.test.ts` (2 nuevas, 1 actualizada, pull repetido = 0 cambios, nube caída, sin config, scheduler sin solape).

```bash
# Terminal 1 · nube con clave compartida
TP_CLOUD_KEY=secreto npm run dev:registration
# Inscribe algo (sección 7) y apruébalo (los acompañantes heredan el estado):
curl -s -X POST localhost:3000/api/approve -H 'x-tatami-key: secreto' -H 'content-type: application/json' -d '{"all":true}'
curl -s "localhost:3000/api/export" -H 'x-tatami-key: secreto' | jq '{count, cursor}'

# Terminal 2 · host apuntando a la nube, actualización cada 1 min
TP_CLOUD_URL=http://localhost:3000 TP_CLOUD_KEY=secreto TP_CLOUD_INTERVAL_MIN=1 npm run dev:host
TOKEN=$(curl -s -X POST localhost:8787/auth/login -H 'content-type: application/json' -d '{"username":"admin","password":"admin123"}' | jq -r .token)
curl -s -X POST localhost:8787/sync/cloud/pull -H "authorization: Bearer $TOKEN" | jq '{ok, received, created, updated, companionsCreated, cursor}'
curl -s -X POST localhost:8787/sync/cloud/pull -H "authorization: Bearer $TOKEN" | jq '{received, created}'    # segunda vez: 0
curl -s localhost:8787/sync/cloud/status -H "authorization: Bearer $TOKEN" | jq '{lastCloudSyncAt, online, intervalMinutes, nextRunAt, message}'
```

Tras cada pull exitoso el host **reporta** a la nube los IDs, versiones y estados de credencial que emitió (`POST /api/host-report`, cabecera `x-tatami-key`): solo lo que cambió desde el último reporte (`meta.hostReportSent`), así que es idempotente; si la nube no responde, el pull sigue siendo OK y el reporte se reintenta en el siguiente. Mira `GET /sync/cloud/status` → `lastReport {ok, sent, applied, unknown}` y la acción `CLOUD_REPORT` en la auditoría. Con ese reporte (y `TP_SIGNING_KEY` en la nube, §4.3) la página `/credencial/<token>` pasa de "en preparación" a mostrar el QR. Para reenviar todo (p. ej. tras restaurar la nube): `ctx.cloud.report({ force: true })` desde un script.

Apaga la nube (Ctrl+C en la terminal 1) y vuelve a pulsar: responde 503, `status.online = false` y el mensaje dice "Sin conexión a la nube, se reintenta en 1 min"; el host sigue sirviendo scanners. Arranca el host sin `TP_CLOUD_URL`: el pull responde 409 con "define TP_CLOUD_URL y TP_CLOUD_KEY".

Del lado del scanner el equivalente ya existe: la PWA hace polling al host cada 15 s y la bandeja **Pendientes** tiene el botón **Reintentar ahora**.

## 9. Simplificaciones respecto a 00-DECISIONES (honestas)

| Tema | Contrato | Implementado | Por qué |
|---|---|---|---|
| ORM del host | Drizzle | SQL directo con `better-sqlite3` en `apps/host/src/repos.ts` | Menos superficie; el esquema está en `migrations/001_init.sql` y los repositorios aíslan el SQL. |
| Contraseñas | Argon2id | scrypt (`node:crypto`) | Evita otro módulo nativo; cambiar `hashSecret`/`verifySecret` en `auth.ts` basta. |
| Sync scanner ↔ host | WebSocket + polling | Solo polling (15 s, backoff exponencial) | Suficiente para 8 puertas; el WebSocket es una optimización. |
| Panel admin web en el host | HTML servido por el host | `apps/host-admin` (Vite + React) servido en `/admin` por el propio host (§2.1) | Sin WebSocket: las páginas en vivo hacen polling (5–15 s). |
| Cifrado de campos sensibles en reposo | AES-256-GCM por campo | Implementado (`packages/core/src/field-crypto.ts` + `apps/host/src/pii.ts`): documento, fecha de nacimiento y documento del acudiente; HMAC para buscar por documento | Entre primario y respaldo la PII viaja en claro por la LAN de staff (cada host la recifra con su clave); usa HTTPS entre hosts si la LAN no es de confianza. |
| Host standby / `tatami promote` | Replicación en caliente | Implementado: `TP_ROLE=standby` replica cada 10 s (§2.2) y se promueve desde el panel o `npm run promote` | La promoción no desactiva al primario viejo: no lo vuelvas a arrancar como principal. No hay failover automático ni mDNS integrado. |
| Fallback de cámara `@zxing/browser` | Sí | Implementado (`apps/scanner/src/camera.ts`): nativo si existe `BarcodeDetector`, si no ZXing (chunk lazy) | — |
| Playwright e2e | Sí | Implementado (`e2e/`, 44 pruebas trazadas a TC, flujo maestro @smoke, standby, backup/restore, purga, paneles, a11y, @perf; §10) | Un solo navegador (Chromium) y specs en serie porque comparten el host. Sin cámara real (modo prueba `__tpScan`). |
| Foto en credencial | Foto real | La inscripción sube y recorta la foto (disco en dev, Vercel Blob en producción) y la exporta como `photoUrl`; el scanner la muestra si existe; el PDF usa iniciales | Falta que el PDF descargue la foto. |
| Nube → host sync | HTTPS mismo protocolo | Pull de inscripciones aprobadas (`/api/export` → `POST /sync/cloud/pull`, botón + periódico) y, tras cada pull exitoso, el host **reporta** a la nube los IDs/versiones/estados emitidos (`POST /api/host-report`, idempotente, solo lo que cambió; si falla se reintenta en el siguiente pull; `GET /sync/cloud/status.lastReport`). Es lo que activa la credencial digital del participante. La clave de firma se comparte como indica `apps/host/.env.example` | La aprobación se hace en el panel de la nube (`/panel`); `POST /api/approve` con `x-tatami-key` queda para scripts. Los acompañantes no tienen fecha de nacimiento (se guarda `1900-01-01` como marcador en el host). |
| Purga a 90 días | Automática | Implementada: job diario + botón con doble confirmación (§2.5) | Borra PII de todo el evento de una vez (no por persona). Las copias de seguridad anteriores a la purga siguen conteniendo PII cifrada: destrúyelas con acta. |
| Copias de seguridad | `VACUUM INTO` cada 5 min a USB LUKS + standby + nube | Snapshot cada 5 min a dos carpetas (`TP_BACKUPS_DIR_2` = la USB) con rotación 48 + 1/hora, verificación y restauración (§2.4) | El cifrado LUKS de la USB y la subida a la nube son del sistema operativo / del técnico, no del host. |
| Emisión manual en sitio | — | `POST /credentials/issue` desde Inscripciones (valida rol, cupo, edad/categoría, acudiente y acompañantes) | Sin foto (no hay carga de imágenes en el host); el PDF sale con iniciales. |
| Inscripciones "pendientes de credencial" | Aprobación en el host | Las inscripciones aprobadas llegan de la nube ya con credencial; el panel muestra las que faltan por imprimir y la vista previa de lo que la nube tiene por traer | La aprobación sigue viviendo en la nube (`apps/registration`). |
| PIN de supervisor (zona, modo, excepciones) | PIN del supervisor | Sin red: PIN del dispositivo si está enrolado como `SUPERVISOR`, o `config.supervisorPins` / `config.supervisorPinHash` del snapshot (`sha256("tatami:"+pin)`, campos opcionales que el host aún no emite). Si no hay PIN local: usuario + contraseña validados con `POST /auth/login` (rol `SUPERVISOR` o `ADMIN`). | El host no publica PIN de supervisor en el snapshot; cuando lo haga, el scanner ya los lee. Mientras tanto, para autorizar sin red, enrola el scanner del supervisor con rol Supervisor. |
| Eventos de dispositivo (`zone_change`, `shift_*`) en reportes del host | — | El host los acepta y guarda (`decision: 'EVENT'`), pero `reports.ts`/alertas cuentan cualquier `manual` como ingreso manual | Falta filtrar `decision === 'EVENT'` en el host (una línea); los totales de entradas/salidas/negados no se afectan. |
| Linterna, enfoque continuo, cámara trasera | — | Vía `MediaStreamTrack.applyConstraints` (`torch`, `focusMode: continuous`) cuando el track lo soporta (Android/Chrome); en iOS Safari no hay torch desde la web | Limitación de plataforma. |
| Instalación PWA | Automática | `beforeinstallprompt` en Chrome/Android ("Instalar ahora"); en iOS solo instrucciones (Compartir › Añadir a pantalla de inicio) | Limitación de iOS. |
| Cambio de zona desde el panel → scanner (RF-080, TC-082) | < 15 s | `PATCH /devices/:id` cambia la zona en el host, pero el snapshot del scanner no trae la zona del dispositivo: el scanner la cambia desde su menú con autorización de supervisor (validada por el host) | Falta incluir `device.zone` en `/sync/snapshot` y aplicarla en el scanner. |
| Alerta "dispositivo bloqueado por PIN" en el panel | Sí | El bloqueo es local al scanner (localStorage); no se reporta al host | Requiere endpoint de alertas de dispositivo. |
| Lector QR en la suite e2e | Cámara real | Modo prueba `window.__tpScan` (solo `VITE_E2E=1`) | Chromium headless no tiene cámara; el motor de decisión es idéntico. |

## 10. Pruebas end-to-end

`e2e/` es un workspace con **Playwright Test** (`@playwright/test` 1.56, un solo navegador: Chromium). Levanta el ecosistema completo —nube (`next start`), host real con su panel `/admin`, scanner (`vite preview` en modo prueba)— y lo recorre como lo haría el evento. Las specs corren **en serie** porque comparten un host con estado (anti-passback, revocaciones, reporte de cierre).

### 10.1 Correrlas

```bash
npm run preflight       # Node, npm, Chromium, puertos libres, builds, disco (scripts/preflight.sh; --fix instala Chromium)
npm run e2e:smoke       # flujo maestro "día del evento" + inscripción de menor (@smoke) · ≈ 30 s + 1 min de builds
npm run e2e             # suite completa (todo menos @perf) · 44 pruebas · ≈ 2,5 min + 1 min de builds
npm run e2e:perf        # rendimiento (@perf): 500 escaneos por API p95 < 50 ms, snapshot de 2.000 < 2 s (no en CI de PR)
npm run e2e:ui          # modo UI de Playwright
npm run e2e:report      # abre el último informe HTML (e2e/playwright-report)

# atajos
E2E_SKIP_BUILD=1 npx playwright test --project=full tc-062 -w e2e   # una spec, sin recompilar (la build ya existe)
E2E_SKIP_REGISTRATION=1 npm run e2e                                 # solo host + scanner (las specs de nube se saltan)
```

`npm run e2e*` compila antes lo que la suite usa (`e2e/scripts/build.mjs`: panel del host → `apps/host/public/admin`, scanner `vite build --mode e2e` → `dist-e2e`, nube `next build`); con `E2E_SKIP_BUILD=1` se salta. Fuera de CI hace falta el Chromium de Playwright (`npx playwright install chromium`, o `PLAYWRIGHT_BROWSERS_PATH` apuntando a uno ya instalado).

### 10.2 Qué levanta y con qué datos

| Servidor | Puerto | Qué es |
|---|---|---|
| `e2e/scripts/host.ts` | 8790 (host real) · **8797 (proxy)** · 8798 (control) | `buildApp` de `apps/host` sobre una **base SQLite temporal** (`e2e/.tmp/host`) con 300 credenciales + 1 con foto, usuarios del seed, 4 scanners de demo, vigencia 2026-01-01 → 2027-12-31, nube configurada (`E2E_CLOUD_URL/KEY`) y clave de replicación. Delante va un **proxy controlable**: `GET :8798/__e2e/down` corta las conexiones (host "apagado"), `/__e2e/up` las restablece. El panel se sirve en `http://127.0.0.1:8790/admin/`. |
| `apps/scanner` | 5174 | `vite preview` de `dist-e2e` (`VITE_E2E=1`): expone `window.__tpScan(token)`, `__tpSync()`, `__tpStatus()`. |
| `apps/registration` | 3100 | `next start` con `REGISTRATION_DB_PATH` temporal, `EVENT_CONFIG_PATH` propio (fechas 2026-10-01 → 2027-12-31 para que el QR digital que firma la nube sea válido "hoy"; cupo `PRESS` = 2 para TC-007/TC-010), `TP_CLOUD_KEY=e2e-secreto`, `TP_SIGNING_KEY` = la misma clave del host, `MAIL_OUTBOX_DIR` (los correos quedan como `.eml` y las specs los leen), admin `admin@e2e.local` / `E2e-admin-123456`. |

Datos deterministas: la clave de firma se genera en `playwright.config.ts` y se escribe en `e2e/.tmp/signing-key.json` (host, nube y specs la comparten); el seed del host es `seedCredentials(ctx, 300)` con semilla fija; todo `e2e/.tmp/` se borra al empezar cada corrida. Las specs que necesitan **otro host** (standby, restaurado, purga, clave nueva, 2.000 credenciales) lo levantan ellas con `spawnHost()` en un puerto libre y carpeta propia (`e2e/.tmp/hosts/<nombre>`) y lo apagan al terminar.

Variables: `E2E_HOST_PORT`, `E2E_PROXY_PORT`, `E2E_CONTROL_PORT`, `E2E_SCANNER_PORT`, `E2E_REGISTRATION_PORT` (puertos), `E2E_SKIP_BUILD=1`, `E2E_SKIP_REGISTRATION=1`, `CI=1` (1 reintento, `list` + `html`). Trazas, capturas y vídeo **solo al fallar** (`retain-on-failure`).

### 10.3 Leer el informe

- En consola: reporter `list` (una línea por prueba; en el flujo maestro cada paso es una prueba numerada). Las pruebas `@perf` imprimen `[perf] …` con p50/p95/p99 y lo anotan en el informe.
- `e2e/playwright-report/index.html` (`npm run e2e:report`): por prueba, pasos, errores con el *snapshot de accesibilidad* de la página en el momento del fallo (`error-context.md`), captura, vídeo y traza. `npx playwright show-trace e2e/test-results/<carpeta>/trace.zip` reproduce la prueba paso a paso con red y consola.
- Un fallo en el flujo maestro (TC-200) salta los pasos siguientes (`serial`): el primer rojo es la causa.
- En CI los artefactos `playwright-report` (siempre en `e2e-full`) y `playwright-test-results` (solo al fallar) se adjuntan al job.

### 10.4 Añadir una spec

1. Nómbrala `e2e/specs/tc-<nnn>-<slug>.spec.ts` con el TC de `docs/20-RF-TEST.md` (crea el TC allí si no existe) y marca la tabla §3.1 de ese documento.
2. Usa `helpers.ts`: `host` (API directa del host principal: `login`, `get`, `post`, `pick(rol, n)`, `credential(id)`), `hostApi(url)` y `spawnHost({...})` para hosts extra, `proxy.down()/up()`, `cloud` (`post/get/status/outbox()/key`), `cloudLogin(page)`, `adminLogin(page, usuario, { base? })` + `adminGo(page, 'credenciales')`, y para el scanner `enrollScanner`, `scan`, `forceSync`, `setMode`, `supervisorPin`, `endShift`, `unlockWithPin`.
3. Cada spec enrola su propio scanner (contexto nuevo = IndexedDB nueva) y usa **offsets distintos** de credenciales (`host.pick('COMP', n)`): el anti-passback y la alerta de duplicado son reales entre specs. Offsets usados hoy: 0–10, 20–23, 30, 40, 50 (COMP) y 0–1 (GEN).
4. Lo que deja el ecosistema en un estado distinto para las demás (p. ej. rotar la clave de la nube) va en `specs/zz-ultimo/` (corre al final).
5. Etiqueta `@smoke` solo lo que deba correr en cada PR (≤ 3 min en total) y `@perf` lo que mida tiempos.
6. Localizadores por rol/etiqueta (`getByRole`, `getByLabel`) en los paneles; `data-testid` en el scanner. Nada de `waitForTimeout` salvo para los temporizadores propios de la app (anti-doble-lectura de 2 s).

### 10.5 Contra un ecosistema real desplegado

Con `E2E_BASE_*` la suite no levanta nada y apunta a lo que ya corre (p. ej. el LAB o el simulacro):

```bash
E2E_BASE_HOST=https://host.tatamipass.co \
E2E_BASE_SCANNER=https://scanner.tatamipass.co \
E2E_BASE_REGISTRATION=https://inscripciones.tatamipass.co \
E2E_CLOUD_KEY=<x-tatami-key> E2E_CLOUD_ADMIN_EMAIL=<admin> E2E_CLOUD_ADMIN_PASSWORD=<clave> \
npx playwright test --project=full -w e2e
```

Requisitos: el scanner desplegado debe ser un build con `VITE_E2E=1` (modo prueba; nunca el de producción), el host debe tener los usuarios del seed (`admin/admin123`…) o ajusta `helpers.ts`, y la nube la clave y el admin indicados. Se saltan solas las specs que necesitan el proxy controlable (host "apagado"), hosts extra o los correos en disco: TC-044, TC-071, TC-074, TC-200, TC-057, TC-094, TC-S06, rotación de clave, @perf. Lo que sí corre: inscripción, cupos, importación, panel de la nube (lista de espera, duplicados, CSV), matriz de roles de `/admin`, escaneos, anti-passback, firma alterada, QR digital, auditoría y reporte.

### 10.6 Specs

La tabla completa TC ↔ spec está en `docs/20-RF-TEST.md` §3.1. En resumen: `tc-200-dia-del-evento` (flujo maestro de 11 pasos, @smoke), `tc-006`/`tc-007`/`tc-016`/`tc-acompanantes-limite`/`tc-010-013-109-panel-nube` (nube y su panel), `tc-023`/`tc-044`/`tc-062`/`tc-067`/`tc-071-025`/`tc-080-074`/`tc-100`/`tc-ingreso-manual`/`tc-zona-supervisor-y-host` (scanner ↔ host), `tc-072-076-panel-admin-roles` (panel `/admin` por rol y rol nuevo), `tc-057-standby-promocion`, `tc-094-backup-restauracion`, `tc-s06-purga-90-dias`, `tc-086-cierre-reporte-auditoria`, `tc-049-accesibilidad` (axe-core), `tc-120-radio-voz` (Tatami Radio con micrófono falso, @smoke), `tc-p02-p04-rendimiento` (@perf) y `zz-ultimo/tc-109-rotacion-clave-nube`.

## 11. Pruebas en dispositivos reales

### Preparar

1. Host con HTTPS: `cd apps/host && docker compose up --build` (Caddy con CA interna) o un dominio real con certificado (DNS-01) apuntando a la IP LAN. Exporta el root de Caddy: `docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt ./root.crt`.
2. **Android (Chrome):** copia `root.crt` al teléfono → Ajustes › Seguridad › Cifrado y credenciales › Instalar certificado › **Certificado de CA** → acepta el aviso. Abre `https://<ip-del-host>` y comprueba el candado.
3. **iOS (Safari):** envía `root.crt` por AirDrop/correo → Ajustes › Perfil descargado › Instalar → luego Ajustes › General › Información › **Configuración de confianza de certificados** → activa la confianza total para ese root. Sin ese segundo paso la cámara no abre.
4. Scanner servido por HTTPS: `npm run build -w apps/scanner` y sírvelo detrás del mismo Caddy (o `npm run preview -w apps/scanner -- --host` tras un túnel HTTPS). Abre la URL en el celular.
5. **Instalar la PWA:** Android/Chrome → menú ⋮ › **Instalar aplicación** (o el banner); iOS/Safari → Compartir › **Añadir a pantalla de inicio**. Ábrela desde el icono: corre a pantalla completa (`display: standalone`) y el service worker deja abrir la app sin red.
6. Enrola con el QR del panel (incluye `hostUrl` y token) o pegando el código; PIN de 6 dígitos.

### Checklist de 10 puntos (por dispositivo, anotar modelo y versión del SO)

| # | Prueba | Esperado |
|---|---|---|
| 1 | Abrir la PWA instalada con el Wi-Fi apagado | Abre (shell cacheado), muestra "Sin conexión · modo local" y la lista de credenciales local. |
| 2 | Permiso de cámara y lector | Pide permiso una sola vez; en Chrome Android/Safari 17+ el hint no dice "lector JS" (nativo); en otros, dice "lector JS" (ZXing) y lee igual. |
| 3 | Cámara trasera y linterna | Arranca con la trasera principal (no la ultra-wide); ⟳ cambia de cámara; 🔦 enciende la linterna en Android/Chrome (en iOS no está disponible: documentarlo). |
| 4 | QR impreso válido en < 300 ms | Verde "Adelante, <nombre>" con foto/iniciales; el contador de ms de la esquina < 300. Sonido + vibración de OK. |
| 5 | Mismo QR dos veces en zona T, luego Salida y de nuevo | Rojo anti-passback con hora; salida registrada; re-entrada verde. Sonidos distintos para rojo. |
| 6 | QR fotocopiado en dos scanners con < 2 min de diferencia | Ámbar "posible duplicado" en el segundo con triple pitido; en el host `/reports/gate-summary.byReason.DUPLICATE` crece. |
| 7 | Modo avión 10 min con ≥ 20 escaneos | Sin errores ni latencia; Pendientes = 20; al reconectar se vacía en ≤ 15 s y `/devices.lastSeq` coincide. |
| 8 | PIN incorrecto 5 veces y bloqueo | Cuenta regresiva 15:00, teclado deshabilitado, sobrevive a cerrar y abrir la app; pendientes intactos. |
| 9 | Modo kiosk + botón atrás + 5 min sin tocar | Pantalla completa, la pantalla no se apaga (wake lock), atrás no sale de la app (muestra aviso). Al bloquear/desbloquear el teléfono el wake lock se recupera. |
| 10 | Batería y calor en 1 h de uso continuo | Consumo ≤ 10 %/h con brillo 70 % (power bank conectado si supera), sin cierres; hora del dispositivo sin franja ámbar de reloj (si aparece, activar hora automática). |

Registra los resultados en la planilla de simulacro (`docs/20-RF-TEST.md` §6) con capturas de los puntos 4, 6 y 8.

## 12. App de escritorio "Tatami Pass Host" (`apps/host-desktop`)

Mismo host, sin Docker ni terminal: Electron ejecuta `buildApp()` en su proceso principal, con ventana, bandeja y Caddy como proceso auxiliar. Guía completa (instalar, asistente, datos, migrar desde Docker, firmar, checklist de 12 puntos): [86-APP-ESCRITORIO](./86-APP-ESCRITORIO.md).

```bash
npm test -w apps/host-desktop              # 27 pruebas Vitest sin Electron: rutas de datos, ajustes → TP_*, passphrase (llavero/plano),
                                           # IPs de la LAN, QR de enrolamiento canjeable, guarda SI+PROMOVER, Caddyfile, estado, logs
                                           # + HostRunner con el host real: arranca, siembra demo, enrola, copia a USB verificada, puerto ocupado
npm run dev -w apps/host-desktop           # abre la app en dev (asistente de 4 pasos → demo → Host corriendo)
npm run smoke -w apps/host-desktop         # Playwright _electron: asistente → "Host corriendo · principal" → QR; capturas en release/smoke/
npm run dist:linux -w apps/host-desktop    # AppImage para probar aquí; TP_SMOKE_BIN=release/linux-unpacked/tatami-pass-host npm run smoke
TP_DESKTOP_USER_DATA=/tmp/tp-a TP_DESKTOP_SMOKE=1 npm start -w apps/host-desktop   # arranca, setup demo, imprime /health y sale
```

Dos instancias en el mismo equipo (principal + respaldo): `TP_DESKTOP_USER_DATA=/tmp/tp-b npm start -w apps/host-desktop`, asistente en modo **Equipo de respaldo** con `http://127.0.0.1:8787` y la clave de replicación del principal, puerto 8788 en Ajustes.

HTTPS: el certificado raíz lo exporta la app (botón) y se instala en los celulares igual que en §11 (pasos 2 y 3). Verificado en Linux con el AppImage: `curl --cacert root.crt https://localhost:8443/health` → `ok: true`.


## 13. `npm audit`: qué significa y qué hacer

`npm audit` cuenta avisos de **todas** las dependencias del monorepo, incluidas las que solo se usan para desarrollar, probar o empaquetar (Vitest, Vite, Playwright, Next, electron-builder, VitePress). Lo que viaja dentro de la app del host, del scanner o de la nube es una fracción pequeña de ese árbol.

Criterio: un aviso bloquea el release solo si (a) la dependencia se ejecuta en producción (host, scanner, nube, app de escritorio) y (b) el vector aplica a cómo la usamos. Lo demás se anota aquí y se revisa en cada release.

Estado a 2026-10-16 (14 avisos, 1 alto):

| Paquete | Dónde corre | Vector | Decisión |
|---|---|---|---|
| `electron-builder` → `app-builder-lib` → `@electron/get` → `global-agent` → `roarr` → `sprintf-js` | Solo al empaquetar (`dist:*`) | DoS por formato en logs de la herramienta | No aplica en producción; se actualiza cuando electron-builder lo arregle. |
| `vite` / `esbuild` (via `vitepress`) | Solo el servidor de desarrollo del sitio de docs (`docs:dev`) | Un sitio web malicioso lee respuestas del dev server local | No aplica: nunca se expone el dev server; `docs:build` genera estático. |
| `mermaid` → `katex` | Solo al compilar el sitio de docs | Prototype pollution al renderizar fórmulas | No usamos fórmulas; `vitepress-plugin-mermaid` aún exige mermaid 11. |

Corregidos en esta versión: Electron 42.11.15 (ABI 146), `@fastify/static` 10.1.6, `sharp` 0.35.5. Cómo subir Electron sin romper SQLite: §12 y `docs/86` §7.

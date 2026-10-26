# 86 · App de escritorio "Tatami Pass Host" (Mac y Windows)

> Para quien monta el host sin Docker ni terminal: la app de escritorio ejecuta el host (`apps/host`) dentro de un programa normal, con ventana, icono en la bandeja y HTTPS en la red del coliseo. Código en `apps/host-desktop`. Complementa a [90 §3](./90-MONTAJE-ECOSISTEMA.md) (opción A) y a [80](./80-COMO-PROBAR.md) §12 (cómo probarla).

## 1. Qué es y qué no es

- **Es** el mismo host de siempre (Fastify + SQLite, mismas rutas, mismo panel `/admin`, mismas copias, misma réplica) empaquetado con Electron. No hay un segundo backend: la app importa `buildApp` de `@tatami/host` y lo arranca **en el proceso principal**.
- **Añade** lo que antes exigía terminal: asistente de primera ejecución, passphrase guardada en el llavero del sistema, QR de enrolamiento en pantalla, copias a USB con un botón, "Traer de la nube", promoción con doble confirmación, HTTPS con certificado interno (Caddy como proceso auxiliar) y exportación del certificado raíz para los celulares.
- **No es** obligatoria: la opción Docker + Caddy de [90 §3](./90-MONTAJE-ECOSISTEMA.md) sigue siendo válida (y es la recomendada si el host es un mini PC Ubuntu sin pantalla).
- **No sustituye** al panel: la ventana muestra estado y acciones de operación; credenciales, usuarios, auditoría e impresión siguen en `/admin`.

## 2. Instalar y usar (lo que ve el Administrador)

### 2.1 Instalar

| Sistema | Archivo | Cómo |
|---|---|---|
| macOS (Apple Silicon) | `Tatami Pass Host-<versión>-mac-arm64.dmg` | Abre el `.dmg` y arrastra la app a Aplicaciones. |
| macOS (Intel) | `Tatami Pass Host-<versión>-mac-x64.dmg` | Igual. |
| Windows 10/11 | `Tatami Pass Host-<versión>-win-x64-instalador.exe` | Instalador normal (elige carpeta, crea acceso directo). |
| Windows sin instalar | `Tatami Pass Host-<versión>-win-x64-portable.exe` | Un solo `.exe`; se puede llevar en la USB. Los datos quedan igualmente en la carpeta del usuario (§2.5). |
| Linux (para probar) | `Tatami Pass Host-<versión>-linux-x86_64.AppImage` | `chmod +x` y ejecutar. |

**Sin firma (por defecto)** los sistemas avisan la primera vez:

- **macOS**: "No se puede abrir porque proviene de un desarrollador no identificado". Clic derecho sobre la app › **Abrir** › **Abrir** (solo la primera vez). Si macOS dice que está "dañada" (ocurre con apps descargadas sin notarizar), en Terminal: `xattr -dr com.apple.quarantine "/Applications/Tatami Pass Host.app"`. Con firma y notarización (§4) no aparece nada de esto.
- **Windows SmartScreen**: "Windows protegió su PC" › **Más información** › **Ejecutar de todas formas**. Con un certificado de firma de código desaparece.
- **Firewall de Windows**: la primera vez pide permiso para que la app reciba conexiones en redes **privadas**: acéptalo (es la red del coliseo). Si lo rechazaste, Panel de control › Firewall › Permitir una aplicación › marca "Tatami Pass Host" en Privada.
- **macOS**: pedirá permiso para "aceptar conexiones entrantes": acepta.

### 2.2 Primera ejecución: asistente de 4 pasos

1. **¿Dónde está este equipo?** Nombre de la sede y modo: **Principal** (aquí viven los datos) o **Equipo de respaldo** (dirección del principal, p. ej. `http://10.10.0.2:8787`, y la clave de replicación).
2. **Passphrase de las claves** (20+ caracteres, la del sobre del Administrador). Cifra la clave que firma los QR y los datos personales. Se guarda en el llavero del sistema (Keychain / DPAPI); si el llavero no está disponible la app lo dice y la guarda en disco con permisos 600. El equipo de respaldo usa **la misma** passphrase.
3. **¿Qué evento cargamos?** Evento de demostración (2.000 credenciales, `admin/admin123`, 4 scanners con PIN `123456`) o tu `event.config.json` (exportado del panel o editado según [32](./32-CONFIG-EVENTO.md)).
4. **Copias de seguridad**: cada 5 min en la carpeta de datos; opcionalmente una segunda carpeta (la USB cifrada). Si la USB no está, la copia principal se hace igual.

Al terminar, la ventana muestra **Host corriendo** y la dirección para los scanners.

### 2.3 La ventana (900 × 640, una sola)

| Bloque | Qué muestra / hace |
|---|---|
| Barra superior | Estado (Host corriendo · principal / respaldo, Arrancando, Host detenido, Falta configurar), **Abrir panel** (abre `/admin` en el navegador), **Ajustes**. |
| Este equipo | Dirección para los scanners (https si Caddy corre, si no http), evento cargado (nombre, fechas, archivo), conteos, **Cambiar archivo de evento**, **Abrir carpeta de datos**. En respaldo: estado de la réplica y **Promover a principal** (doble confirmación: SI + PROMOVER). |
| Enrolar un scanner | Nombre, zona, rol → **Generar código (10 min)**: QR grande + dirección y código por si no se puede leer. Es el mismo `POST /devices/enroll-token` del panel; queda en auditoría. |
| Scanners | Enrolados, conectados (visto hace < 5 min), pendientes por enviar, desactivados. |
| Copias de seguridad | Última copia, destinos, **Hacer copia ahora**, **Copia a USB ahora** (elige carpeta; copia + verificación `integrity_check`). |
| Nube | Última actualización, intervalo, **Traer ahora** (`cloud.pull()`, igual que el panel). |
| HTTPS en la red | Activo / Desactivado / No disponible, **Exportar certificado raíz** (`root.crt`), **Cómo instalarlo en los celulares** (Android e iOS, en pantalla). |
| Qué está pasando | Últimas 200 líneas de log (copias, nube, réplica, Caddy). Archivo completo en `logs/host.log`. |
| Ajustes | Nombre de la sede, puerto (8787), modo + dirección del principal + clave de replicación, carpeta de copias secundaria, nube (`TP_CLOUD_URL`, `TP_CLOUD_KEY`, intervalo), archivo de evento, HTTPS activado + puerto (8443), arrancar al iniciar sesión, passphrase, **Reiniciar host**. Los cambios que afectan al host lo reinician solos. |

**Bandeja / barra de menús**: icono con estado, Abrir ventana, Abrir panel, Hacer copia ahora, Traer de la nube ahora, Salir. **Cerrar la ventana la minimiza a la bandeja**: el host sigue corriendo. **Salir** pide confirmación si hay scanners conectados.

### 2.4 HTTPS en la LAN y el certificado raíz

La app lanza Caddy (`resources/caddy/<plataforma>/caddy`) con `tls internal` y un Caddyfile generado con las IPs actuales del equipo (`https://<ip>:8443` → `127.0.0.1:8787`). El certificado raíz queda en `<datos>/caddy/home/caddy/pki/authorities/local/root.crt`; **Exportar certificado raíz** lo guarda donde elijas. Instalación en los celulares: ver [90 §5](./90-MONTAJE-ECOSISTEMA.md) o el texto en pantalla. Si Caddy no está (descarga fallida en el build) o no arranca (puerto ocupado), la app lo dice y **sigue en HTTP**: los scanners funcionan igual, solo que algunos navegadores exigen https para usar la cámara. Puertos distintos del 8787/8443: Ajustes.

Si la IP del equipo cambia (otro router), reinicia el host desde Ajustes: el Caddyfile se regenera con la IP nueva y el certificado se reemite con la misma CA, así los celulares no tienen que reinstalar nada.

### 2.5 Dónde quedan los datos

Todo bajo `<userData>/tatami` (botón **Abrir carpeta de datos**):

| SO | Carpeta |
|---|---|
| macOS | `~/Library/Application Support/Tatami Pass Host/tatami/` |
| Windows | `%APPDATA%\Tatami Pass Host\tatami\` |
| Linux | `~/.config/Tatami Pass Host/tatami/` |

Dentro: `db/tatami.db` (+ WAL), `keys/signing.enc.json` (clave de firma cifrada) y `keys/passphrase.enc`, `backups/` (`tatami-<fecha>.db`, 48 + 1 por hora), `config/event.config.json` y `config/settings.json`, `logs/host.log`, `caddy/` (Caddyfile, `caddy.pid`, CA). La variable `TP_DESKTOP_USER_DATA=<carpeta>` cambia esta ruta: sirve para correr **principal y respaldo en el mismo equipo** al probar (dos instancias con puertos distintos).

### 2.6 Migrar desde Docker (o al revés)

1. En el host Docker: panel › Sistema › **Hacer copia ahora** y copia el `.db` (`docker compose cp host:/backups/<archivo> .`), más `signing.enc.json` (`docker compose cp host:/keys/signing.enc.json .`) y el `event.config.json`.
2. En la app: asistente con **la misma passphrase** y "Mi archivo event.config.json" apuntando al tuyo. Cierra la app (Salir).
3. Copia `signing.enc.json` a `<datos>/keys/` (reemplaza el que creó la app: así los QR ya impresos siguen valiendo) y el `.db` a `<datos>/db/tatami.db` (borra `tatami.db-wal` y `tatami.db-shm` si existen). O bien, con la app abierta, restaura la copia desde panel › Sistema › Restaurar (RESTAURAR).
4. Abre la app: **Host corriendo**, mismos conteos que tenía Docker. Si usabas Caddy en Docker, la CA es otra: exporta el nuevo `root.crt` e instálalo en los celulares (o copia la carpeta `caddy-data` de Docker a `<datos>/caddy/home/caddy/` para conservar la CA).

De la app a Docker: mismos tres archivos en sentido contrario (volúmenes `tatami-data`, `tatami-keys`).

## 3. Compilar en la Mac de Jhoan (y en Windows)

```bash
git clone <repo> && cd tatami-pass
npm install                       # baja Electron (≈100 MB) y compila core
npm run dist:mac -w apps/host-desktop
# → apps/host-desktop/release/Tatami Pass Host-0.2.0-mac-arm64.dmg (+ .zip), y -mac-x64
```

`dist:mac` hace, en orden: build de core/print/host/host-admin → build de la app (tsc) → `scripts/fetch-native.mjs` (binario de `better-sqlite3` **ya compilado para Electron** desde las releases oficiales, nada que compilar) → `scripts/fetch-caddy.mjs` (Caddy 2.10.2, checksum SHA-512 verificado) → `scripts/make-icons.mjs` (desde `resources/icon.svg` con sharp; icns/ico con png2icons) → `electron-builder --mac`.

- **Windows**: `npm run dist:win -w apps/host-desktop` en una máquina Windows produce instalador NSIS + portable. En Linux también se puede (necesita `wine` de 32 y 64 bits para el desinstalador NSIS y el icono del `.exe`); sin wine: `npm run dist:win:zip` (portable + zip).
- **Linux**: `npm run dist:linux -w apps/host-desktop` → AppImage (sirve para probar la app empaquetada en CI).
- **Solo un target**: `npx electron-builder --mac dmg --arm64` dentro de `apps/host-desktop`.
- **Sin red para GitHub** (Electron, prebuilds y Caddy se bajan de GitHub): `npm install` falla al bajar Electron → usa un espejo (`ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`) o copia `~/.cache/electron` de otra máquina. Si falla `fetch-caddy`, el build sigue (`--soft`) y la app queda sin HTTPS; si falla `fetch-native`, ver §7.
- **Dev**: `npm run dev -w apps/host-desktop` (compila y abre la app con el Electron de `node_modules`). `TP_DESKTOP_USER_DATA=/tmp/tp-b TP_DESKTOP_SMOKE=1 npm start -w apps/host-desktop` arranca, hace el setup de demo, imprime `/health` y sale (CI).

## 4. Firmar y notarizar (opcional, recomendado para repartir)

Sin firma todo funciona, pero cada equipo nuevo pasa por el aviso de §2.1. Para firmar, solo variables de entorno (electron-builder las lee; nada en el repo):

**macOS** (cuenta Apple Developer, certificado "Developer ID Application" exportado a `.p12`):
```bash
export CSC_LINK=/ruta/developer-id.p12 CSC_KEY_PASSWORD='clave del p12'
export APPLE_ID='tu@apple.id' APPLE_APP_SPECIFIC_PASSWORD='xxxx-xxxx-xxxx-xxxx' APPLE_TEAM_ID='XXXXXXXXXX'
npm run dist:mac -w apps/host-desktop -- -c.mac.notarize=true
```
`hardenedRuntime` y los entitlements (`resources/entitlements.mac.plist`: cargar `.node`, lanzar Caddy, servidor de red) ya están configurados. Comprueba con `spctl -a -vv "release/mac-arm64/Tatami Pass Host.app"` → `accepted`.

**Windows** (certificado de firma de código `.pfx`, OV o EV):
```bash
export WIN_CSC_LINK=/ruta/cert.pfx WIN_CSC_KEY_PASSWORD='clave'
npm run dist:win -w apps/host-desktop
```
Con EV en token USB o Azure Trusted Signing: `win.signtoolOptions` / `win.azureSignOptions` en `electron-builder.yml` (ver docs de electron-builder). `CSC_IDENTITY_AUTO_DISCOVERY=false` evita que busque certificados del llavero.

## 5. Caddy y el certificado raíz

- Versión fija en `scripts/fetch-caddy.mjs` (`CADDY_VERSION`), checksums verificados contra `caddy_<v>_checksums.txt` de la release. Cambiar de versión = cambiar esa constante y volver a correr el script con `--force`.
- Empaquetado en `resources/caddy/<os>-<arch>/` (extraResources, fuera del asar). La app lo lanza con `XDG_DATA_HOME=<datos>/caddy/home` y `--pidfile`; al arrancar mata un Caddy huérfano de una sesión anterior (en Linux dos Caddy pueden compartir el puerto y servir certificados distintos). Sale con la app (Salir, Cmd+Q, SIGTERM).
- `admin off`, `auto_https disable_redirects`, `skip_install_trust` (no toca el almacén de certificados del equipo; el navegador del host avisará salvo que importes `root.crt` también ahí).
- Sin binario → la app muestra "No encuentro Caddy en esta instalación; el host sigue en HTTP".

## 6. Actualizar la app

No hay auto-actualización (`publish: null`): se reparte el instalador nuevo. Instalar encima conserva los datos (están en `<userData>`, no en la app). Antes de actualizar en el día D: **Hacer copia ahora** y Salir. Las migraciones de la base se aplican solas al arrancar, igual que en Docker; nunca vuelvas a una versión anterior de la app con una base ya migrada.

## 7. better-sqlite3 y Electron (por qué no se recompila)

Electron usa su propia ABI de Node; el `better-sqlite3` que instala `npm install` está compilado para el Node del sistema (lo usan los tests). En vez de recompilarlo (`@electron/rebuild`, que rompería `npm test` hasta volver a compilar y exige toolchain de C++), la app **carga otro binario**: `scripts/fetch-native.mjs` baja el prebuild oficial `better-sqlite3-v<versión>-electron-v<abi>-<os>-<arch>.tar.gz` a `resources/native/<os>-<arch>/` y la app pone `TP_SQLITE_NATIVE_BINDING=<ruta>` antes de importar el host; `apps/host/src/db.ts` lo pasa como `nativeBinding` (mismo paquete JS, otro `.node`). Versiones actuales: better-sqlite3 12.x + Electron 42 (ABI 146). Para subir Electron: elige una versión con prebuild en las releases de better-sqlite3 (los nombres de archivo dicen el ABI; `node -p "require('node-abi').getAbi('<electron>', 'electron')"`), cambia `devDependencies.electron` y corre `fetch-native --force`.

**Fallback si no hay prebuild**: `npm run rebuild:native -w apps/host-desktop` compila con `@electron/rebuild` (Python 3 + Xcode CLT / VS Build Tools), copia el `.node` a `resources/native/` y vuelve a compilar el de Node (`npm rebuild better-sqlite3`). Solo produce el binario de la plataforma donde corre.

Si la app arranca sin binario para Electron, lo avisa en el log y lo intenta con el de Node: casi siempre falla con "was compiled against a different Node.js version" → ejecuta `fetch-native` o `rebuild:native` y vuelve a empaquetar.

## 8. Checklist de prueba de la app (antes del simulacro)

Marca cada punto en la Mac/PC real del host. Tiempo: 30 min.

1. ☐ Instalar (§2.1) y abrir: aparece el asistente. Completar con **demo**. **Salió bien si**: "Host corriendo · principal", 2000 credenciales en "Este equipo", evento "Campeonato Nacional…".
2. ☐ **Abrir panel** abre `http(s)://<ip>:…/admin` en el navegador; entra `admin/admin123`. Credenciales lista 2.000.
3. ☐ HTTPS: badge **Activo**; **Exportar certificado raíz** guarda `tatami-pass-root.crt`. Instálalo en un celular (texto en pantalla) y abre la dirección https desde el celular: candado sin avisos.
4. ☐ **Enrolar un scanner**: nombre "Puerta G1", zona Gradería, Control → QR. En el celular, PWA del scanner › Enrolar este dispositivo › escanea el QR › PIN. **Salió bien si**: aparece en "Scanners" como conectado en < 1 min.
5. ☐ Escanea una credencial del seed desde el scanner; "escaneos" sube en la ventana.
6. ☐ **Hacer copia ahora** → "Copia de seguridad creada"; **Copia a USB ahora** con una USB → "verificada: 2000 credenciales"; el `.db` está en la USB.
7. ☐ Ajustes › nube (URL + clave de tu despliegue [85](./85-DESPLIEGUE-NUBE.md)) › Guardar (el host se reinicia) › **Traer ahora** → "Nube al día".
8. ☐ Cierra la ventana (X): el icono sigue en la bandeja y el scanner sigue enviando. Clic en el icono › Abrir ventana.
9. ☐ **Salir** con un scanner conectado: pide confirmación. Vuelve a abrir: todo sigue (datos, passphrase del llavero, sin asistente).
10. ☐ Respaldo: en un segundo equipo (o en el mismo con `TP_DESKTOP_USER_DATA` y otro puerto), asistente en modo **Equipo de respaldo** con la dirección del principal y la clave de replicación (Ajustes del principal). **Salió bien si**: "Replicando del principal · al día hace N s" y los conteos coinciden. Apaga el principal y prueba **Promover a principal** (SI + PROMOVER) → "Este equipo ahora es el principal". Después deja el respaldo como estaba (Ajustes › modo) o borra su carpeta de datos.
11. ☐ Apaga el wifi del host: la ventana muestra "Sin red" bajo la dirección; al volver, la dirección reaparece. Los scanners siguen validando offline.
12. ☐ Reinicia el equipo con "Arrancar al iniciar sesión" activado: la app aparece en la bandeja y `/health` responde.

Si algo falla: `logs/host.log` en la carpeta de datos (botón **Abrir carpeta de datos**) y [90 §10](./90-MONTAJE-ECOSISTEMA.md).

## 9. Para desarrolladores: estructura de `apps/host-desktop`

```
apps/host-desktop/
├── package.json             scripts build / test / dist:* / smoke; main = dist/main/main.js (ESM)
├── electron-builder.yml     mac (dmg+zip arm64/x64), win (nsis+portable x64), linux (AppImage); asarUnpack, extraResources
├── tsconfig*.json           main (NodeNext) · preload (.cts → .cjs) · renderer (DOM)
├── src/shared/ipc.ts        contrato IPC (Settings, DesktopState, TpApi)
├── src/main/
│   ├── main.ts              cableado Electron: ventana, bandeja, IPC, arranque, SIGTERM
│   ├── host-runner.ts       buildApp() en proceso; backupNow/backupTo/cloudPullNow/promote/seedDemo
│   ├── settings.ts          settings.json, validación, needsRestart, settingsToEnv (→ TP_*)
│   ├── secrets.ts           passphrase con safeStorage (llavero) o plano declarado
│   ├── caddy.ts             Caddyfile + proceso auxiliar + pidfile + certificado raíz
│   ├── enroll.ts            código de enrolamiento + QR (qrcode)
│   ├── state.ts             DesktopState a partir del ctx del host
│   ├── lan.ts · paths.ts · promote-guard.ts · logs.ts
├── src/preload/preload.cts  window.tp (contextIsolation, sandbox)
├── src/renderer/            index.html + styles.css + renderer.ts (sin framework)
├── scripts/                 fetch-native, fetch-caddy, make-icons, rebuild-native, build-deps, copy-static, smoke
├── resources/               icon.svg, icons/ (generados), entitlements.mac.plist, native/ y caddy/ (descargados, ignorados por git)
└── test/                    Vitest: pure.test.ts (módulos sin Electron) y host-runner.test.ts (host real en proceso)
```

Pruebas: `npm test -w apps/host-desktop` (27 pruebas, sin Electron) y `npm run smoke -w apps/host-desktop` (Playwright `_electron`: asistente → Host corriendo → QR; capturas en `release/smoke/`; en Linux sin pantalla se relanza con `xvfb-run`). `TP_SMOKE_BIN=release/linux-unpacked/tatami-pass-host npm run smoke` prueba el binario empaquetado.

Textos visibles: siguen [70](./70-UX-WRITING.md) (tuteo, qué pasó + por qué + qué hacer). Nuevos en esta app: "Host corriendo · principal", "Falta configurar", "Copia a USB ahora", "Traer ahora", "Promover a principal" (SI + PROMOVER), "Exportar certificado raíz", "No encuentro Caddy en esta instalación; el host sigue en HTTP", "El puerto N ya está en uso. Cierra el otro programa o cambia el puerto en Ajustes."

# apps/host-desktop — guía para agentes

App de escritorio **"Tatami Pass Host"** (Electron + electron-builder). Lee primero `/CLAUDE.md` (raíz) y `docs/86-APP-ESCRITORIO.md`; aquí solo lo específico.

## Idea central

El host **no se reimplementa ni se lanza como proceso aparte**: `src/main/host-runner.ts` importa `buildApp` de `@tatami/host/dist/server.js` y lo escucha en el proceso principal de Electron. Todo lo que hace la ventana (copias, nube, promoción, QR de enrolamiento) llama a los mismos módulos del host que usan las rutas de `apps/host/src/routes`. Si una acción nueva existe en el panel, aquí debe llamar al mismo código, no a un `fetch` contra sí mismo.

## Estructura

| Archivo | Qué hace |
|---|---|
| `src/shared/ipc.ts` | Contrato IPC: `Settings`, `DesktopState`, `TpApi`. Cambiar aquí = cambiar main, preload y renderer. |
| `src/main/main.ts` | Único archivo que toca `electron` (ventana 900×640, bandeja, diálogos, `safeStorage`, IPC, SIGTERM). Sin lógica: delega. |
| `src/main/host-runner.ts` | Arranque/parada del host, `backupNow`, `backupTo` (USB verificada), `cloudPullNow`, `promote`, `seedDemo`. |
| `src/main/settings.ts` | `settings.json`, validación con mensajes humanos, `needsRestart`, `settingsToEnv` → variables `TP_*` de docs/80 §2. |
| `src/main/secrets.ts` | Passphrase con `safeStorage` (llavero) o en claro declarado (`plain`). |
| `src/main/caddy.ts` | Caddyfile (`tls internal`, IPs como SAN), proceso auxiliar con `--pidfile`, mata huérfanos, `root.crt`. |
| `src/main/enroll.ts` · `state.ts` · `lan.ts` · `paths.ts` · `promote-guard.ts` · `logs.ts` | Módulos puros (sin Electron), probados en `test/pure.test.ts`. |
| `src/preload/preload.cts` | `window.tp` con `contextIsolation` + `sandbox`. Es `.cts` para que salga `.cjs` (el paquete es ESM). |
| `src/renderer/` | HTML + CSS + un `renderer.ts` sin framework. Estilo del diseño: Sora/Inter, azul `#1C4FD1`, lima `#C8F560`, rojo `#E0323B`. |
| `scripts/` | `fetch-native.mjs` (prebuild de better-sqlite3 para Electron → `resources/native/<os>-<arch>/`), `fetch-caddy.mjs` (checksum), `make-icons.mjs`, `rebuild-native.mjs` (fallback), `build-deps.mjs`, `smoke.mjs` (Playwright `_electron`). |
| `electron-builder.yml` | Targets, `asarUnpack` (`*.node`, migraciones, panel), `extraResources` (`native/${os}-${arch}`, `caddy/${os}-${arch}`, iconos), `npmRebuild: false`, `publish: null`. |

## Reglas propias

- **Nunca recompiles el `better-sqlite3` del monorepo** (rompe `npm test`). El binario de Electron se carga por `TP_SQLITE_NATIVE_BINDING`; para subir Electron elige una versión con prebuild (docs/86 §7).
- `npm run build` (raíz) solo compila TypeScript; el empaquetado es `dist:*` y necesita red para bajar Electron/Caddy/prebuilds. No metas pasos con red en `build`, `test` ni `typecheck`.
- Textos visibles en español según `docs/70`: estado (qué pasó) + por qué + qué hacer. Los mensajes de error que vienen del host se muestran tal cual.
- Secretos: la passphrase y la clave de la nube no van al log ni al `DesktopState` (solo `passphraseSet`/`passphraseStorage`).
- Cada acción nueva: tipo en `ipc.ts`, `handle()` en `main.ts`, método en `preload.cts`, botón en el renderer, prueba del módulo puro, y una línea en `docs/86` §2.3.
- Antes de dar por terminado: `npm test -w apps/host-desktop`, `npm run build`, y si tocaste `main.ts`/renderer, `npm run smoke -w apps/host-desktop` (usa `xvfb-run` solo en Linux sin pantalla).

## Verificar

```bash
npm test -w apps/host-desktop            # Vitest (host real en proceso, sin Electron)
npm run dev -w apps/host-desktop         # abre la app (TP_DESKTOP_USER_DATA=<carpeta> para datos aparte)
npm run smoke -w apps/host-desktop       # Playwright _electron; capturas en release/smoke/
npm run dist:linux -w apps/host-desktop  # AppImage; TP_SMOKE_BIN=release/linux-unpacked/tatami-pass-host npm run smoke
```

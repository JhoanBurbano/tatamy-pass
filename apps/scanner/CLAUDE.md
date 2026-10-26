# apps/scanner — guía para agentes

L1 del sistema: **PWA** (Vite + React + Dexie/IndexedDB) que valida QR **sin red** y sube escaneos cuando puede. Lee primero `/CLAUDE.md` (raíz).

## Estructura

| Archivo | Qué hace |
|---|---|
| `src/scan-engine.ts` | `processInput(raw, dev, config)`: verifica firma con `@tatami/core` (`verifyToken`, `evaluateScan`), aplica revocaciones y anti-passback local, devuelve `ScanOutcome` (decisión, motivo, texto humano). **Aquí no hay red.** |
| `src/sync.ts` | Snapshot inicial, cola de pendientes, polling cada 15 s con backoff, `enrollDevice`, `checkHost`, `changeHostUrl`. |
| `src/db.ts` | Dexie: `settings` (dispositivo, hostUrl, deviceToken), `credentials`, `revocations`, `pending`, `scans`, `photos`. |
| `src/device-events.ts` | Construye `zone_change`, `mode_change`, `shift_start`, `shift_end` con `buildDeviceEvent` de core y los encola como un escaneo más. |
| `src/screens/*.tsx` | Una pantalla por estado: `Enroll`, `Pin`, `ZoneSelect`, `Scan`, `Result`, `ReasonSheet`, `ManualEntry`, `SupervisorAuth`, `Pending`, `ShiftSummary`, `Menu`, `Install`, `Photo`, `DirectionPrompt`. |
| `src/lib/*.ts` | `pin-lock` (5 intentos → 15 min), `supervisor` (PIN local o `POST /auth/login`), `manual` (ID corto con Luhn), `mode`, `shift`, `clock` (deriva), `idle`, `tones`, `camera-select`, `photo-cache`, `search`, `prefs`. |
| `src/camera.ts` | `BarcodeDetector` nativo o `@zxing/browser` (chunk lazy); linterna y enfoque por `applyConstraints`. |
| `src/radio/` | Tatami Radio (ADR-0010, `docs/34`): `client.ts` (`RadioClient`: WebSocket de señalización + una `RTCPeerConnection` por compañero de canal, micrófono silenciado salvo PTT, reconexión con backoff, modo local sin host; dependencias del navegador inyectadas), `state.ts` (estado puro + `reduce`, `pttLabel`, `isPttKey`), `speech.ts` (lee órdenes con `speechSynthesis` es-CO), `index.ts` (`radioClient` con las APIs reales), `RadioPanel.tsx` (panel deslizable: PTT ≥ 120 px, barra espaciadora, canales, volumen, 🚨 Emergencia, órdenes con Recibido). `App.tsx` la enciende con el turno y abre el panel al llegar una orden. El panel `/admin` importa `client.ts` y `state.ts` por ruta relativa. |
| `src/pwa.ts`, `src/kiosk.ts`, `public/sw.js` | Instalación, wake lock, pantalla completa, precache (lo rellena `vite.config.ts`). |
| `test/` | Vitest con `happy-dom` (`setup-dom.ts`); `scan-flow.test.tsx` cubre el flujo completo. Modo e2e: `VITE_E2E=1` expone `window.__tpScan(token)`. |

## Reglas propias

- **Primero offline**: cualquier función nueva debe funcionar con `navigator.onLine === false` y host caído. Si necesita el host, cae a un modo local explicado con texto humano ("Sin conexión. Sigue escaneando: se envía solo cuando vuelva").
- **Textos**: solo del catálogo `docs/70-UX-WRITING.md` §4 (ALLOW / DENY / ALERT / estado). Título ≤ 1 línea, cuerpo ≤ 2 líneas, una acción. Un texto nuevo entra al catálogo en el mismo PR.
- **Decisiones solo en core**: no dupliques reglas de acceso en la UI; si falta una regla, va a `packages/core/src/access-rules.ts` con test.
- **Eventos al host**: todo lo que pase en el dispositivo y deba quedar en auditoría se encola como `ScanEvent` (escaneo o `decision: 'EVENT'`), nunca por un endpoint nuevo (ADR-0004).
- Botones ≥ 48 px, contraste AA, sin depender solo del color (icono + texto + sonido + vibración por decisión).
- `localStorage` solo para preferencias y bloqueo de PIN; datos en Dexie.
- Radio: nada de audio por el host; el PTT solo abre la pista (`track.enabled`) cuando el host concede la palabra (o en modo local sin host). Sin micrófono se sigue escuchando y recibiendo órdenes. Tonos nuevos van en `lib/tones.ts` (`order`, `emergency`). Modo prueba: `window.__tpRadio()`, `__tpRadioStats()` (bytes recibidos por par), `__tpRadioClient`.

## Verificar

```bash
npm test -w apps/scanner
npm run typecheck -w apps/scanner
npm run dev:scanner               # http://localhost:5173 (enrola contra npm run dev:host)
npx playwright test tc-023 -w e2e # o la spec del TC que toques
```

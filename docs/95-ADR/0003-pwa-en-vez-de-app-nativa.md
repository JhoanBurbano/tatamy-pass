# ADR-0003 · Scanner como PWA, no app nativa

| Campo | Valor |
|---|---|
| **Estado** | Aceptado |
| **Fecha** | 2026-10-09 |
| **Decide** | Claude por encargo de Jhoan Burbano (contrato 00-DECISIONES v1.0) |
| **Afecta a** | `apps/scanner`, `apps/host` (Caddy), docs 30 §8, 50 §4, 80 §11 |

## Contexto

Los scanners son celulares del comité (Android y algún iPhone), hay 6–8 puertas más reserva, los operadores son voluntarios y la instalación ocurre el día anterior en el coliseo. Hace falta: cámara, almacenamiento local con la base completa (IndexedDB), funcionamiento sin red y actualización sin tiendas. No hay presupuesto ni tiempo para dos apps nativas.

## Decisión

`apps/scanner` es una **PWA** (Vite + React + Dexie) instalable desde el host, con service worker para el shell offline, `BarcodeDetector` nativo y fallback `@zxing/browser`, wake lock y modo kiosk. Como la cámara exige contexto seguro, el host sirve HTTPS en LAN (ADR-0005). Un modo de prueba (`VITE_E2E=1`, `window.__tpScan`) permite e2e sin cámara.

## Alternativas consideradas

| Alternativa | Por qué no |
|---|---|
| App nativa Android + iOS | Dos bases de código, tiendas o distribución manual de APK/TestFlight, sin actualización instantánea en LAN. |
| Lector QR de hardware + host | Sin pantalla para foto y mensajes humanos, sin modo local real. |
| Web sin instalar (solo pestaña) | Sin shell offline garantizado, sin pantalla completa, se pierde con un gesto. |

## Consecuencias

**Positivas**: instalación en 30 s por dispositivo, una sola base de código, misma versión en todas las puertas, e2e con Playwright.

**Negativas / costos**: HTTPS obligatorio en LAN (certificado en cada teléfono). Limitaciones de plataforma documentadas en 80 §9: iOS sin linterna web ni `beforeinstallprompt`; el bloqueo por PIN es local al dispositivo. Consumo ~10 %/h → power banks.

**Qué vigilar**: si Safari/iOS deja de permitir cámara en PWA instaladas o el rendimiento de ZXing supera 300 ms en teléfonos viejos, evaluar un wrapper nativo mínimo (Capacitor) sin cambiar el núcleo.

## Referencias

- `docs/00-DECISIONES.md` §3 y §8 · `docs/30-ARQUITECTURA.md` §2 y §11 · `docs/80-COMO-PROBAR.md` §3 y §11
- Código: `apps/scanner/src/camera.ts`, `apps/scanner/src/pwa.ts`, `apps/scanner/src/kiosk.ts`, `apps/scanner/public/sw.js`

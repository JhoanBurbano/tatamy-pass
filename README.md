# Tatami Pass

Sistema de **acreditación y control de accesos** del Campeonato Nacional de Taekwondo ITF 2026 (Colombia). Solo accesos: recibe la lista de competidores de SportData, emite credenciales con QR firmado y las valida en cada puerta **aunque no haya red ni nube**.

Contrato de arquitectura: [`docs/00-DECISIONES.md`](docs/00-DECISIONES.md). Cómo probarlo paso a paso: [`docs/80-COMO-PROBAR.md`](docs/80-COMO-PROBAR.md).

## Tres niveles, cada uno funciona sin el siguiente

| Nivel | App | Qué hace |
|---|---|---|
| L1 Scanner | `apps/scanner` (PWA, Vite + React + Dexie) | Valida QR Ed25519 offline con copia local de credenciales, reglas y revocaciones. Guarda escaneos y los sube cuando puede. |
| L2 Host | `apps/host` (Fastify + SQLite) + `apps/host-admin` (panel React servido en `/admin`) + `apps/host-desktop` (app de escritorio Mac/Windows que ejecuta el host sin Docker ni terminal, [docs/86](docs/86-APP-ESCRITORIO.md)) | Fuente de verdad de la sede: sync de scanners, anti-passback entre puertas, revocación/re-emisión/emisión en sitio, alertas, impresión por lotes, auditoría encadenada por hash, backups `VACUUM INTO` a dos destinos, equipo de respaldo (`TP_ROLE=standby` + `npm run promote`), cifrado AES-256-GCM de datos sensibles y purga a 90 días. |
| L3 Nube | `apps/registration` (Next.js 15) | Inscripción pública con foto, acompañantes, cupos, edad/categoría y consentimiento; panel de coordinación (`/panel`: aprobar, lista de espera, duplicados, cupos, importar SportData, exportar al host, clubes, configuración); portal de club; estado y credencial digital del participante. Postgres (Neon) + Blob + Resend en Vercel. |

`packages/core` es el dominio puro (sin IO) que comparten los tres: tipos, ID corto con verificador Luhn mod 36, token QR `TP1.<payload>.<firma>`, motor de reglas con mensajes en español, categorías de edad, log de eventos para sync, cadena de auditoría, parser CSV, validación de la config del evento y cifrado de campos sensibles (`field-crypto`).

## Estructura

```
tatami-pass/
├── docs/                      00 decisiones · 80 cómo probar · 85 despliegue nube
├── packages/core/             dominio puro, Vitest con cobertura
│   └── src/  types · credential-id · qr-token · access-rules · age-categories · event-log · audit-chain · sportdata-import · config-validation · field-crypto
├── apps/host/                 API Fastify + SQLite (src/routes/*, migrations/, event.config.json, seed, backups, replicación, purga, Docker + Caddy)
├── apps/host-admin/           panel del host (Vite + React) → se compila a apps/host/public/admin y se sirve en /admin
├── apps/host-desktop/         app de escritorio "Tatami Pass Host" (Electron + electron-builder): host en proceso, bandeja, QR de enrolamiento, copias a USB, HTTPS con Caddy
├── apps/scanner/              PWA del control de entradas (manifest + service worker)
├── apps/registration/         inscripción online + importación SportData (Next.js App Router)
├── apps/print/                PDF de credenciales 100×150 mm (pdf-lib + qrcode)
├── scripts/simulate.ts        simulación de carga y corte de red
└── .github/workflows/ci.yml   install · test · build · simulate · audit
```

## Correr en 5 minutos

```bash
npm install          # Node ≥ 20; compila packages/core
npm test             # core + host
npm run build        # todos los workspaces
npm run simulate     # métricas de validación, decisiones y reconciliación
npm run print:sample # apps/print/out/sample-credentials.pdf

npm run seed         # 2.000 credenciales + usuarios por rol en apps/host/data/tatami.db
npm run dev:host         # http://localhost:8787 · panel en http://localhost:8787/admin (compílalo antes: npm run build:admin)
npm run dev:admin        # panel con recarga en caliente (http://localhost:5174)
npm run dev:scanner      # http://localhost:5173
npm run dev:registration # http://localhost:3000
```

Usuarios del seed: `admin/admin123`, `coord/coord123`, `print/print123`, `club/club123`, `control/control123`, `super/super123`, `audit/audit123`. PIN de los scanners de demo: `123456`.

Operación del host sin consola: `npm run promote` (respaldo → principal), `npm run restore -- <snapshot> --yes` (restaurar con el host apagado), `npm run purge -- --dry-run` (purga de datos personales). Todo esto también está en el panel › Sistema.

Host sin terminal: `npm run dist:mac -w apps/host-desktop` (o `dist:win`, `dist:linux`) genera la app de escritorio **Tatami Pass Host** (`apps/host-desktop/release/`): asistente de primera ejecución, host corriendo en la bandeja, QR de enrolamiento, copias a USB, nube, promoción y HTTPS en la LAN con certificado exportable. Guía: [`docs/86-APP-ESCRITORIO.md`](docs/86-APP-ESCRITORIO.md).

## Credencial y QR

- ID público corto `TP-2026-00123-C` (secuencial + Luhn mod 36) para fallback manual.
- QR = token firmado `TP1.<payload b64url>.<firma Ed25519 b64url>` con evento, credencial, rol, zonas, vigencia, versión y `kid`. La clave privada vive cifrada (AES-256-GCM + scrypt) en el host; los scanners solo reciben la pública.
- Antifraude: firma + foto + anti-passback + alerta de duplicado (< 2 min en otra puerta) + revocación + versión + QR rotativo de 60 s para la credencial digital (solo rol General).

## Decisiones de implementación que se apartan del contrato (y por qué)

Ver la sección "Simplificaciones" (§9) de `docs/80-COMO-PROBAR.md` y los comentarios de cabecera en `apps/host/src/auth.ts` (scrypt en lugar de Argon2id), `apps/host/src/repos.ts` (SQL directo en lugar de Drizzle) y `apps/registration/lib/db/index.ts` (SQLite en dev, Postgres/Neon en Vercel; despliegue paso a paso en `docs/85-DESPLIEGUE-NUBE.md`).

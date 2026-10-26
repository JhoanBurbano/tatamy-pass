# Tatami Pass — guía para agentes (Claude Code)

Sistema de **acreditación y control de accesos** del Campeonato Nacional de Taekwondo ITF 2026 (Colombia). Solo accesos: recibe competidores de SportData, emite credenciales con QR firmado y las valida en cada puerta **aunque no haya red ni nube**. Contrato: `docs/00-DECISIONES.md`. Todo en español (código con nombres técnicos en inglés es normal; mensajes al usuario, docs y commits en español).

## Mapa del monorepo (npm workspaces, TypeScript estricto, Node ≥ 20)

| Ruta | Qué es | Guía propia |
|---|---|---|
| `packages/core` | Dominio puro sin IO: tipos, ID corto Luhn, token QR `TP1.<payload>.<firma Ed25519>`, reglas de acceso con mensajes humanos, categorías de edad, log de eventos append-only, cadena de auditoría, importador SportData, acompañantes, validación de config, cifrado de campos. Lo comparten los tres niveles. | `packages/core/CLAUDE.md` |
| `apps/host` | L2 · Fastify + SQLite (WAL). Fuente de verdad de la sede: sync de scanners, anti-passback, revocación/re-emisión/emisión en sitio, alertas, impresión, auditoría encadenada, copias `VACUUM INTO`, respaldo (`TP_ROLE=standby`), cifrado PII, purga a 90 días, pull desde la nube, señalización de Tatami Radio (`/radio/ws`, ADR-0010). | `apps/host/CLAUDE.md` |
| `apps/host-admin` | Panel React (Vite) del host; se compila a `apps/host/public/admin` y se sirve en `/admin`. | (ver host) |
| `apps/host-desktop` | App de escritorio "Tatami Pass Host" (Electron + electron-builder, Mac/Windows/Linux): ejecuta `buildApp()` del host **en el proceso principal**, asistente de primera ejecución, bandeja, QR de enrolamiento, copias a USB, nube, promoción, HTTPS con Caddy como proceso auxiliar. `better-sqlite3` para Electron viene de prebuilds (`scripts/fetch-native.mjs` + `TP_SQLITE_NATIVE_BINDING`), nunca se recompila el del monorepo. | `apps/host-desktop/CLAUDE.md` · `docs/86-APP-ESCRITORIO.md` |
| `apps/scanner` | L1 · PWA (Vite + React + Dexie): valida QR offline, cola de pendientes, enrolamiento, PIN, modos, ingreso manual, excepciones, turnos, Tatami Radio (voz P2P por la LAN, `src/radio/`). | `apps/scanner/CLAUDE.md` |
| `apps/registration` | L3 · Next.js 15 en Vercel + Postgres (Neon): inscripción pública, panel `/panel`, portal de club, credencial digital, exportación al host. | `apps/registration/CLAUDE.md` |
| `apps/print` | PDF de credenciales 100 × 150 mm (pdf-lib + qrcode) dibujado desde la **plantilla** `BadgeTemplate` (ADR-0009, `docs/33`): anverso y reverso, fuentes Barlow embebidas (`fonts/`), iconos vectoriales, Code 128. Lo usa el host. | — |
| `e2e` | Playwright: host real + proxy controlable + scanner en modo prueba + nube. Specs nombradas por TC de `docs/20-RF-TEST.md`. | `docs/80-COMO-PROBAR.md` §10 |
| `scripts/` | `simulate.ts` (carga), `docs/` (generadores), `agent/` (herramientas para agentes), `mcp/` (servidor MCP del host) | `docs/36-AGENTES.md` |
| `docs/` | Numeradas: 00 decisiones · 10 PRD · 20 pruebas · 30–36 técnico (33 = diseño de la credencial, 34 = Tatami Radio) · 40 seguridad · 50 operación · 60 manuales · 70 UX writing · 80 cómo probar · 85 nube · 86 app de escritorio · 90 montaje · 95 ADR · 99 changelog | `docs/README.md` |
| `docs-site/` | VitePress que lee `../docs` (`npm run docs:dev`). | — |

## Comandos

```bash
npm install                 # instala y compila core (prepare)
npm test                    # core (cobertura) + host + host-desktop + scanner + registration
npm run build               # todos los workspaces (solo TypeScript; el empaquetado Electron es dist:* en apps/host-desktop)
npm run typecheck           # tsc --noEmit por workspace
npm run simulate            # 2.000 credenciales, 8 puertas, corte de red
npm run seed && npm run dev:host      # host con demo en :8787, panel en /admin (admin/admin123)
npm run dev:scanner | dev:admin | dev:registration
npm run e2e | e2e:smoke | e2e:ui      # Playwright (npx playwright install chromium la primera vez)
npm run dist:mac -w apps/host-desktop   # app de escritorio (dist:win, dist:linux); npm run smoke -w apps/host-desktop la prueba con Playwright
npm run docs:gen            # regenera docs/31-API-REFERENCIA.md y docs/32-CONFIG-EVENTO.md
npm run docs:links          # enlaces rotos entre docs
npm run check               # scripts/agent/check-all.sh: test + build + typecheck + docs:gen sin diff + enlaces
```

## Invariantes: no se tocan sin un ADR nuevo

1. **Firma Ed25519 en el QR**: el token es `TP1.<payload b64url>.<firma b64url>`, sin datos personales. La clave privada vive cifrada en el host (`keys/signing.enc.json`); los scanners **solo** reciben la pública. Nunca mandes la privada al snapshot, al respaldo ni a la nube.
2. **Offline-first por niveles**: nada nuevo puede exigir red o nube en la puerta. El scanner decide con su copia local; el host funciona sin internet; la nube es opcional el día D.
3. **Append-only**: los escaneos y la auditoría son hechos inmutables identificados por `deviceId:seq` y encadenados por hash. No hay `UPDATE` de un escaneo; si hace falta corregir, se añade un evento compensatorio. Config y revocaciones son LWW.
4. **UX writing humano**: todo texto visible sigue `docs/70-UX-WRITING.md` (español neutro, tuteo, qué pasó + por qué + qué hacer, sin jerga, máximo 2 líneas en el scanner). Un texto nuevo entra al catálogo en el mismo PR.
5. **Ley 1581 (datos personales)**: documento, fecha de nacimiento y acudiente cifrados en reposo (AES-256-GCM); búsqueda por HMAC; menores con consentimiento; retención 90 días y purga. No registres PII en logs, en el QR ni en respuestas a roles que no la necesitan (ver `publicCredential`).
6. **RBAC en cada endpoint**: cada ruta del host declara `g.requireUser([...])`; el panel solo oculta, el host aplica. En el respaldo toda escritura responde 409.

## Convenciones

- TypeScript estricto (`tsconfig.base.json`), ESM, sin `any` nuevos, `import type` para tipos. Módulos pequeños con comentario de cabecera que diga qué hace el archivo.
- **Tests junto al cambio**: core → `packages/core/test` (Vitest, cobertura), host → `apps/host/test` (integración sobre `buildApp` con base temporal), scanner → `apps/scanner/test`, nube → `apps/registration/test`, flujos de usuario → `e2e/tc-<nnn>-<nombre>.spec.ts`.
- **Docs en el mismo PR**: documento del rango, `docs/70` si hay texto visible, `docs/99-CHANGELOG.md` bajo `[Sin publicar]`, ADR en `docs/95-ADR/` si hay alternativas. Rutas nuevas con JSDoc (alimenta `docs:gen`).
- **Commits en español** con prefijo `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`, `design:`. Una frase que diga qué cambia para el usuario. Nunca hagas `git commit` ni `git push` si no te lo piden.
- Mensajes de error de la API: `{ error: "frase en español" }` y, en validaciones de formulario, `errors: [{ path, message }]`.
- No añadas dependencias nativas al host sin ADR (hoy solo `better-sqlite3`; ver ADR-0006). El **audio de la radio nunca pasa por el host** (solo señalización, ADR-0010).
- Archivos generados (`docs/31`, `docs/32`, `apps/host/public/admin`, `dist/`) no se editan a mano.

## Antes de dar por terminado

1. `npm run check` (o como mínimo `npm test` y `npm run build`) en verde.
2. Si tocaste un flujo de usuario: `npm run e2e:smoke` (o la spec afectada: `npx playwright test tc-062 -w e2e`).
3. `npm run docs:gen` sin diff pendiente si tocaste rutas o tipos de config.
4. Si tocaste `auth`, `pii`, `qr-token`, `field-crypto`, `sync`, `replication` o `cloud-sync`: pide revisión al subagente `revisor-seguridad` (`.claude/agents/revisor-seguridad.md`).
5. Resume en español qué cambió, qué se probó y qué documento se actualizó.

## Punteros

- Cómo probar cualquier cosa paso a paso: `docs/80-COMO-PROBAR.md`. Simplificaciones honestas respecto al contrato: §9 de ese documento.
- Arquitectura y protocolo de sync: `docs/30-ARQUITECTURA.md`. API generada: `docs/31-API-REFERENCIA.md`. Config: `docs/32-CONFIG-EVENTO.md`.
- Seguridad, STRIDE y runbooks de incidente: `docs/40-SEGURIDAD-ISO27001.md`.
- Operación y día D: `docs/50-OPERACION.md`, `docs/90-MONTAJE-ECOSISTEMA.md`.
- Trabajar con agentes (subagentes, comandos, skills, MCP, límites): `docs/36-AGENTES.md`.

# apps/registration — guía para agentes

L3 del sistema: **Next.js 15 (App Router)** en Vercel con Postgres (Neon), Vercel Blob (fotos) y Resend (correo). En desarrollo usa SQLite (`REGISTRATION_DB_PATH`). Lee primero `/CLAUDE.md` (raíz). Despliegue: `docs/85-DESPLIEGUE-NUBE.md`.

## Estructura

| Ruta | Qué hace |
|---|---|
| `app/page.tsx`, `app/photo-crop.tsx` | Formulario público de inscripción (foto con recorte, acompañantes, cupos, edad/categoría, consentimiento). |
| `app/api/*/route.ts` | API: `register` (público, con límite por IP), `status` (público), `export` y `host-report` y `approve` (clave `x-tatami-key`), `import/preview|confirm` (sesión admin/coord), `credencial/[token]` (QR rotativo público por token opaco), `cron/waitlist`, `photos/[name]`. Cada handler lleva JSDoc (alimenta `docs/31`). |
| `app/panel/**` | Panel de coordinación con sesión por cookie: inscripciones, aprobar, lista de espera, duplicados, cupos, importar, exportar, delegaciones, evento, reportes, usuarios. `actions.ts` = server actions. Portal de club = mismo panel filtrado por delegación. |
| `app/estado/`, `app/credencial/`, `app/confirmar/` | Páginas del participante. |
| `lib/validate.ts` | Reglas de negocio del formulario (usa `@tatami/core`: edad, categoría, cupos, `validateCompanions`). `lib/schemas.ts` = forma con zod. |
| `lib/repo/*` | Repositorios sobre `SqlDriver` (SQLite o Postgres, `lib/db/`). Migraciones en `migrations/sqlite` y `migrations/postgres` **en pareja**. |
| `lib/auth/*` | Sesión, `requireUser(roles)`, `assertSameOrigin`, contraseñas Argon2id. `lib/cloud-auth.ts` = clave compartida con el host. |
| `lib/export.ts`, `lib/host-report.ts` | Contrato con el host (ADR-0007). `lib/digital.ts` = credencial digital. `lib/waitlist.ts`, `lib/approval.ts`, `lib/mail*.ts`. |
| `test/` | Vitest sobre SQLite temporal (`helpers.ts`). |

## Reglas propias

- **Dos dialectos**: toda migración nueva va en `migrations/sqlite/NNN_x.sql` **y** `migrations/postgres/NNN_x.sql`; el SQL de los repos debe correr en ambos (nada específico de uno sin probarlo en `test/repo.test.ts`).
- **Validación en core**: edad, categoría, cupos y acompañantes se calculan con `@tatami/core`, nunca con lógica duplicada en el formulario; el host aplica las mismas funciones.
- **Rutas públicas** (`register`, `status`, `credencial`, `photos`) no exponen PII de terceros; `credencial/[token]` solo nombre, rol, zonas y estado.
- **Clave compartida** (`x-tatami-key`) solo en `export`, `host-report`, `approve` y `cron`; todo lo demás con sesión (`requireUserOrThrow`) y `assertSameOrigin` en mutaciones.
- Textos de formulario, correos y panel: `docs/70-UX-WRITING.md` §5–6 (paciente, servicial, explica qué dato y por qué).
- Menores: consentimiento con nombre y documento del acudiente obligatorio (Ley 1581); nunca lo hagas opcional.
- El contrato de `GET /api/export` lo consume `apps/host/src/cloud-sync.ts`: si cambias campos, cambia `test/export.test.ts`, `apps/host/test/cloud-sync.test.ts` y `docs/80` §8.

## Verificar

```bash
npm test -w apps/registration
npm run typecheck -w apps/registration
npm run dev:registration          # http://localhost:3000 · panel en /panel
npx playwright test tc-006 -w e2e # tc-007, tc-016, tc-acompanantes-limite
```

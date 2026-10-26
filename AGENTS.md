# AGENTS.md — Tatami Pass

Guía para cualquier agente de código (Cursor, Codex, Copilot, Aider, Claude Code). Es el mismo contenido que `CLAUDE.md`; léelo completo allí. Resumen operativo:

**Qué es**: acreditación y control de accesos del Campeonato Nacional de Taekwondo ITF 2026. Tres niveles que funcionan cada uno sin el siguiente: scanner PWA (offline), host Fastify + SQLite en la sede, nube Next.js para inscripción. Dominio puro en `packages/core`. Contrato: `docs/00-DECISIONES.md`.

**Comandos**: `npm install` · `npm test` · `npm run build` · `npm run typecheck` · `npm run e2e` (Playwright) · `npm run docs:gen` · `npm run check` (todo junto).

**Invariantes** (no se cambian sin ADR en `docs/95-ADR/`): firma Ed25519 en el QR y clave privada solo en el host; offline-first (nada nuevo exige red en la puerta); escaneos y auditoría append-only; UX writing humano en español (`docs/70`); datos personales cifrados, menores con consentimiento, purga a 90 días (Ley 1581); RBAC en cada endpoint.

**Convenciones**: TypeScript estricto y ESM; test junto al cambio; docs en el mismo PR (documento del rango + `docs/99-CHANGELOG.md` + `docs/70` si hay texto visible); JSDoc en rutas y tipos; commits en español con prefijo `feat/fix/docs/test/refactor/chore`; no hacer commit ni push sin que lo pidan; no editar archivos generados (`docs/31`, `docs/32`, `dist/`, `apps/host/public/admin`).

**Antes de terminar**: `npm run check` en verde; `npm run e2e:smoke` si tocaste un flujo; revisión de seguridad (`.claude/agents/revisor-seguridad.md` o una persona) si tocaste auth, PII, firma, sync o replicación.

**Guías por workspace**: `packages/core/CLAUDE.md`, `apps/host/CLAUDE.md`, `apps/scanner/CLAUDE.md`, `apps/registration/CLAUDE.md`. Herramientas para agentes y límites: `docs/36-AGENTES.md`. Skills reutilizables: `.claude/skills/*/SKILL.md`.

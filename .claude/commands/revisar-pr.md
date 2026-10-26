---
description: Revisa un PR o el diff actual con el checklist de la plantilla de PR (código + test + doc), invariantes y seguridad
argument-hint: [rama|commit|--staged]
---

Revisa el cambio `$ARGUMENTS` (por defecto `git diff main...HEAD`; con `--staged`, `git diff --staged`).

1. Lee el diff completo y los tests que lo acompañan. Lee `.github/PULL_REQUEST_TEMPLATE.md`.
2. Recorre el checklist de la plantilla y marca cada ítem como ✅ / ❌ / n/a con la evidencia (archivo:línea o comando):
   - código con JSDoc en rutas/tipos nuevos;
   - test junto al cambio (¿cubre el caso feliz, el error y el rol sin permiso?);
   - doc del rango, `docs/70` si hay texto visible, `docs/99-CHANGELOG.md`, ADR si hay alternativas;
   - `npm run docs:gen` sin diff;
   - invariantes (firma, offline-first, append-only, UX writing, Ley 1581, RBAC).
3. Si el diff toca `auth`, `pii`, `qr-token`, `field-crypto`, `sync`, `replication`, `cloud-sync` o rutas nuevas, delega en el subagente `revisor-seguridad` y pega su veredicto.
4. Si cambió un texto visible, delega en `redactor-docs` la revisión de voz (checklist `docs/70` §11).
5. Corre `npm run check` y, si hay flujo de usuario, la spec e2e afectada.
6. Responde con: veredicto (aprobar / cambios / bloquear), hallazgos ordenados por severidad con archivo:línea, y la lista exacta de lo que falta del checklist.

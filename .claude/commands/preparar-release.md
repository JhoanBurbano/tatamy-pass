---
description: Prepara una versión: verifica todo, mueve [Sin publicar] del changelog a la versión, sube la versión y propone la etiqueta
argument-hint: <X.Y.Z> [--dry-run]
---

Prepara la versión `$ARGUMENTS` de Tatami Pass.

1. Estado limpio: `git status` sin cambios sin commit (si hay, detente y dilo).
2. Verificación completa: `npm run check` (tests, build, typecheck, `docs:gen` sin diff, enlaces). Si algo falla, corrige o detente; no publiques en rojo.
3. Suite e2e: `npm run e2e` (o `npm run e2e:smoke` si la completa no puede correr aquí, y dilo).
4. Changelog: revisa `docs/99-CHANGELOG.md` → `[Sin publicar]` debe tener todo lo mergeado desde la última versión (compara con `git log v<anterior>..HEAD --oneline`); redacta lo que falte en la categoría correcta, en español, orientado a lo que cambia para el usuario.
5. Corre `npx tsx scripts/agent/release.ts $ARGUMENTS` (acepta `--dry-run`): mueve el bloque a `[X.Y.Z] — AAAA-MM-DD`, actualiza los enlaces de comparación, sube `version` en `package.json` raíz y en los workspaces, y crea el commit + etiqueta `vX.Y.Z` **solo si** se lo piden sin `--dry-run`.
6. Criterios de aceptación de release: `docs/20-RF-TEST.md` §8. Marca cuáles se cumplen y cuáles no.
7. Responde con: versión, resumen del changelog, resultado de cada verificación y el comando `git push --follow-tags` pendiente (no lo ejecutes).

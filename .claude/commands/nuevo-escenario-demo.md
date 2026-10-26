---
description: Crea un escenario de demo/prueba reproducible (datos + guion + spec opcional) a partir de una situación del evento
argument-hint: "<situación>" p. ej. "coach con credencial vencida intenta entrar a Tatamis"
---

Crea el escenario de demo "$ARGUMENTS" de forma reproducible.

1. Describe el escenario en 3 líneas: quién, en qué puerta/zona, qué debe pasar (decisión, motivo, texto humano del catálogo `docs/70` §4) y qué queda en el host (alerta, auditoría, reporte).
2. Datos: decide si basta con el seed (`apps/host/src/seed-data.ts`) o si hace falta una credencial específica. Si hace falta, añádela al seed con un comentario que nombre el escenario (y, si el escenario es de la nube, una inscripción en `apps/registration/test/helpers.ts`).
3. Guion manual: añade una fila a `docs/80-COMO-PROBAR.md` (sección que corresponda) con comandos `curl` o pasos del panel/scanner y el resultado esperado, siguiendo el estilo de las secciones existentes.
4. Si el escenario cubre un TC de `docs/20-RF-TEST.md` sin spec, crea `e2e/tc-<nnn>-<nombre>.spec.ts` con el patrón de las specs existentes (enrola su propio scanner, `host.pick(rol, offset)` único, afirma texto exacto y estado en el host) y añádela a la tabla de `docs/80` §10. Si no hay TC, propón uno con el formato de `docs/20` §5.
5. Si vale para la demo interactiva de `design/`, añade el paso allí con el mismo texto.
6. Corre `npm test` y la spec nueva (`npx playwright test <nombre> -w e2e`).
7. Responde con: escenario, datos añadidos, cómo reproducirlo en 5 comandos, y qué se afirma.

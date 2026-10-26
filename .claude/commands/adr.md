---
description: Crea un ADR nuevo en docs/95-ADR desde la plantilla, con contexto, decisión, alternativas y consecuencias
argument-hint: "<título de la decisión>"
---

Crea un ADR para "$ARGUMENTS" con el subagente `arquitecto`.

1. Lista `docs/95-ADR/` y toma el siguiente número (`NNNN`). Lee los ADR relacionados para no contradecirlos.
2. Copia `docs/95-ADR/0000-plantilla.md` a `docs/95-ADR/NNNN-<titulo-en-kebab>.md`.
3. Rellena: tabla de estado (Propuesto, fecha de hoy, quién decide, qué afecta), **Contexto** con las fuerzas reales del proyecto, **Decisión** en una frase afirmativa más el detalle para implementar, **Alternativas** en tabla con "por qué no", **Consecuencias** (positivas, costos, qué vigilar) y **Referencias** (00 §, 30 §, código, tests).
4. Si la decisión cambia el contrato, propón el párrafo para `docs/00-DECISIONES.md` (no lo apliques sin confirmación).
5. Añade la línea en `docs/99-CHANGELOG.md` bajo `[Sin publicar]` → **Docs** y corre `npx tsx scripts/agent/verify-docs-links.ts`.
6. Responde con la ruta del ADR y la decisión en una frase.

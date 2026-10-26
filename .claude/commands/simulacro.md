---
description: Guía el simulacro D−7 paso a paso con el guion de docs/20 §7 y deja el acta rellenada
argument-hint: [fecha] [--solo-guion]
---

Prepara y acompaña el simulacro de Tatami Pass ($ARGUMENTS) con la skill `tatami-operacion-dia-d`.

1. Lee `docs/20-RF-TEST.md` §7 (participantes, material, guion T+0…T+90, métricas, go/no-go) y `docs/90-MONTAJE-ECOSISTEMA.md` §8.
2. Genera el acta desde `docs/_plantillas/acta-simulacro.md` en `docs/actas/simulacro-<fecha>.md` con los datos conocidos (versión = `git describe --tags --always`, fecha, lugar) y deja el resto para rellenar.
3. Prepara el checklist previo (bloques 3–6 de `docs/90`) como lista marcable en el chat y pregunta qué está listo.
4. Durante el simulacro (si te lo piden en vivo): por cada paso del guion, di qué hacer, qué observar y qué anotar; si tienes el MCP `tatami-host`, consulta `health` y `gate_summary` para confirmar conteos. No ejecutes acciones de escritura.
5. Al cierre: ayuda a rellenar métricas, defectos (`DEF-nnn` con `docs/_plantillas/reporte-defecto.md`) y la tabla go/no-go de 16 ítems; redacta la decisión con sus condiciones.
6. Responde con la ruta del acta y la lista de defectos abiertos con su prioridad.

---
description: Añade un rol de acceso nuevo a event.config.json con validación, seed, UX writing y docs
argument-hint: <CODIGO> "<Nombre>" zonas=G,W cupo=50 foto=si digital=no color=#RRGGBB
---

Añade el rol de acceso `$ARGUMENTS` a Tatami Pass siguiendo la skill `tatami-evento-config`.

1. Lee `docs/32-CONFIG-EVENTO.md` §3 y `packages/core/src/config-validation.ts` para los campos y reglas. Código en mayúsculas (≤ 12 caracteres), zonas existentes o `*`, `capacity` entero o `null`, color hex de 6 dígitos.
2. Edita `apps/host/event.config.json`: añade el objeto en `roles` (no toques `signingKeys`, `configVersion` ni `updatedAt`: los gestiona el host).
3. Si el rol debe existir también en la config por defecto (`packages/core/src/default-config.ts`), añádelo allí y actualiza `packages/core/test/config-validation.test.ts` y cualquier test que cuente roles.
4. Valida: `npx tsx -e "import('@tatami/core').then(m=>{const c=JSON.parse(require('fs').readFileSync('apps/host/event.config.json','utf8'));console.log(m.validateEventConfig(c))})"` debe imprimir `[]` (tras `npm run build -w packages/core`).
5. Seed y demo: si el rol debe aparecer en los datos de demo, añade credenciales en `apps/host/src/seed-data.ts` y, si aplica, en `apps/print/src/sample.ts`.
6. Lanyard y color: anota el color del lanyard en `docs/50-OPERACION.md` §1.4; el nombre del rol en `docs/10-PRD.md` §5 y en `docs/00-DECISIONES.md` §5 si es permanente.
7. UX writing: el nombre del rol aparece en credenciales y mensajes ("Esta credencial no vale para Tatamis…"); comprueba que suena bien en `docs/70` §4.2.
8. Corre `npm run docs:gen`, `npm test`, `npm run build`. Añade la línea en `docs/99-CHANGELOG.md` bajo `[Sin publicar]` → **Añadido**.
9. Responde con el diff resumido y el JSON del rol tal como quedó.

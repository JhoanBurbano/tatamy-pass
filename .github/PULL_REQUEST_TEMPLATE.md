## Qué cambia

<!-- Una o dos frases en español: qué hace ahora el sistema que antes no hacía (o qué deja de hacer). Enlaza el RF/TC de docs/20-RF-TEST.md si aplica. -->

## Por qué

<!-- El problema o la decisión. Si hay alternativas que alguien podría reabrir, enlaza el ADR (docs/95-ADR/). -->

## Checklist (código + test + doc en el mismo PR)

- [ ] **Código**: TypeScript estricto, sin `any` nuevos; rutas y tipos nuevos llevan JSDoc.
- [ ] **Test junto al cambio**: unitario (`packages/core/test`), integración (`apps/host/test`, `apps/scanner/test`, `apps/registration/test`) o spec e2e (`e2e/`) nombrada por su TC.
- [ ] **Doc del rango** actualizada (`docs/NN-…`), y si cambió un texto visible, el catálogo de `docs/70-UX-WRITING.md`.
- [ ] **Changelog**: entrada bajo `[Sin publicar]` en `docs/99-CHANGELOG.md`.
- [ ] **ADR** en `docs/95-ADR/` si la decisión tiene alternativas (o "no aplica").
- [ ] **Generados**: `npm run docs:gen` corrido y sin diff pendiente (`31-API-REFERENCIA.md`, `32-CONFIG-EVENTO.md`).
- [ ] **Invariantes intactas**: firma Ed25519 (los scanners solo reciben la pública), offline-first (nada nuevo exige red en la puerta), log de escaneos append-only, UX writing humano en español, datos personales según Ley 1581 (cifrados, purga a 90 días).
- [ ] **Verificación local**: `npm run check` en verde (tests, build, typecheck, docs:gen limpio, enlaces). Si tocaste un flujo de usuario: `npm run e2e` (o la spec afectada).
- [ ] **Seguridad**: si tocaste `auth`, `pii`, `qr-token`, `field-crypto`, `sync` o `replication`, pedí revisión del subagente `revisor-seguridad` (o de una persona) contra `docs/40-SEGURIDAD-ISO27001.md`.

## Cómo probarlo

<!-- Comandos exactos y qué se espera ver. Copia de docs/80-COMO-PROBAR.md si ya está descrito. -->

## Capturas / salida

<!-- Opcional: pantalla del scanner o del panel, salida de `npm run simulate`, informe de Playwright. -->

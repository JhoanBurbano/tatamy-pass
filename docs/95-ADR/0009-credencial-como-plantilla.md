# ADR-0009 · La credencial impresa es una plantilla de datos, no código

| Campo | Valor |
|---|---|
| **Estado** | Aceptado |
| **Fecha** | 2026-10-24 |
| **Decide** | Claude por encargo de Jhoan Burbano |
| **Afecta a** | `packages/core` (`badge-template.ts`, `code128.ts`, `types.ts`), `apps/print` (renderer, fuentes, iconos), `apps/host` (`badge-template.ts`, rutas `/print/template*`, migración 005), `apps/host-admin` (Impresión › Diseño), `apps/registration` (formulario, export), docs 32, 33, 60, 80 |

## Contexto

El primer renderer dibujaba una credencial genérica fija en `apps/print/src/pdf.ts`. El comité entregó un diseño de referencia ("Nacional 2026": franjas, cabecera con número de edición, banda del rol, reverso con información importante, contacto de emergencia, EPS, patrocinadores y código de barras) y es seguro que cambiará: logos definitivos, patrocinadores que entran y salen, textos legales, qué datos personales van impresos. Cada cambio pasaba por un desarrollador, un build y un despliegue en la sede, a veces el mismo día del evento.

## Decisión

El diseño es un **documento de datos** (`BadgeTemplate`, JSON) con secciones (colores, fuentes, cabecera, fondo, campos del anverso, banda del rol, acceso, acreditación, QR, pie, reverso, assets embebidos en base64, privacidad) que:

- vive en el host (`data/badge-template.json`), se valida con `validateBadgeTemplate` (mensajes humanos por campo) y se audita al cambiar;
- se edita desde el panel con vista previa en vivo, se exporta/importa como `.json` y se restablece a la del piloto con un botón;
- la dibuja un renderer genérico en `apps/print` (pdf-lib) que no sabe nada del evento: todo lo que ve sale de la plantilla, de `event.config.json` (fechas, roles, zonas) y de la credencial/persona;
- decide, con `privacy`, qué datos personales llegan al renderer (`filterPersonForBadge`); lo apagado no sale en ningún PDF.

Los textos derivables (año, línea de fecha, zonas de acceso) se calculan si la plantilla los deja vacíos, para que cambiar las fechas del evento no obligue a tocar el diseño. El número impreso puede llevar otro prefijo (`credentialDisplay.prefix`) sin cambiar el ID real ni su dígito verificador.

## Alternativas consideradas

| Alternativa | Por qué no |
|---|---|
| Seguir con el diseño en código, un `pdf.ts` por evento | Cada ajuste de logo o texto necesita desarrollador y despliegue; imposible el día D en la sede. |
| HTML + CSS renderizado con un navegador headless (Playwright/Puppeteer) | Añade Chromium al host (y a la app de escritorio), arranque lento, fuentes y márgenes de impresión inconsistentes entre máquinas; pdf-lib es determinista y ya estaba. |
| Editor visual libre (arrastrar cajas) | Mucho más código y QA; el diseño del comité es de bloques fijos. Las secciones con orden/visibilidad cubren lo que de verdad cambia. |
| Guardar la plantilla en `event.config.json` | Mezcla reglas de acceso (que viajan a los scanners) con un JSON de varios cientos de KB de logos; los scanners no necesitan el diseño. |

## Consecuencias

**Positivas**: colores, textos, logos, patrocinadores y privacidad se cambian desde el panel sin código; la misma plantilla sirve en cualquier host (export/import); la vista previa evita gastar plásticos; la decisión de qué dato personal se imprime queda explícita y auditada.

**Negativas / costos**: el layout sigue siendo el del piloto (bloques en posiciones fijas; una plantilla no puede mover el QR a la izquierda); los assets viajan en base64 dentro del JSON (límite 1 MB por archivo); SVG necesita `sharp` para rasterizar (si no, placeholder); las fuentes son un activo del repo (`apps/print/fonts/`, OFL) que hay que mantener.

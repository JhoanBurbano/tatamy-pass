# 33 · Diseño de la credencial (plantilla)

> El diseño de la credencial impresa **no está fijo en el código**: es una plantilla JSON (`BadgeTemplate`, [ADR-0009](./95-ADR/0009-credencial-como-plantilla.md)) que el host guarda en `data/badge-template.json`, el panel edita en **Impresión › Diseño de la credencial** y `apps/print` dibuja con pdf-lib. La plantilla por defecto del piloto, **"Nacional 2026"**, reproduce el diseño de referencia (`design/referencias/credencial-nacional-2026.png`): tarjeta vertical de 100 × 150 mm, anverso y reverso.

## 1. Qué hay en la credencial

**Anverso**: franjas diagonales (azul marino, rosa, gris), silueta clara arriba a la derecha, cabecera con el número de edición (`21`) con contorno, `CAMPEONATO NACIONAL`, `TAEKWON-DO ITF`, `20 26` en rosa, `POPAYÁN` espaciado y la fecha (`14 AL 16 DE NOVIEMBRE DE 2026`) sobre una línea dorada. Bloque de datos: foto a la izquierda y campos a la derecha (NOMBRE COMPLETO, DOCUMENTO, ACADEMIA, DELEGACIÓN en rosa). Banda ancha del rol con icono (`COMPETIDOR` en rosa; los demás roles con su color de `event.config.json`). Tarjeta `ACCESO:` con candado y las zonas, tarjeta `ACREDITACIÓN No.` con el número, QR a la derecha. Pie con los logos separados por líneas.

**Reverso**: mismas franjas y cabecera; recuadro `INFORMACIÓN IMPORTANTE` con cinco viñetas con icono; tarjetas `CONTACTO DE EMERGENCIA` (nombre y teléfono) y `EPS` (nombre y régimen); `PATROCINADORES` con cuatro logos; código de barras **Code 128** con el número debajo; mismo pie.

Muestra: `npm run print:sample` deja en `apps/print/out/` el PDF de 12 credenciales (anverso y reverso), `sample-duplex.pdf` (ambos lados en una hoja) y, si hay `pdftoppm` (poppler), `sample-front.png` y `sample-back.png`.

## 2. La plantilla campo a campo

Tipo en `packages/core/src/badge-template.ts`. Todo es JSON serializable; los archivos van embebidos en base64.

| Sección | Campos | Qué controla |
|---|---|---|
| `id`, `name`, `version` | `nacional-2026`, `Nacional 2026`, `1` | Identidad de la plantilla. `version` es el formato (hoy solo 1). |
| `size` | `widthMm`, `heightMm` | Tamaño de la tarjeta (50–210 × 50–297 mm). Por defecto 100 × 150. |
| `colors` | `primary` (azul marino `#0F2A6B`), `accent` (rosa `#E6007E`), `text`, `muted`, `stripe1..3`, `gold`, `roleBandDefault` | Paleta. Hex de 6 dígitos. |
| `fonts` | `display`, `body` (`name` + `fallback`) | Informativo: el renderer embebe Barlow Condensed / Barlow desde `apps/print/fonts/` (OFL) y cae a Helvetica si no están. |
| `header` | `badgeNumber`, `title`, `subtitle`, `year`, `city`, `dateLine`, `showSkyline`, `skylineAsset` | Cabecera. `year` y `dateLine` vacíos se calculan desde `startDate`/`endDate` (`badgeTextsFromConfig`). |
| `background` | `stripes`, `angle`, `opacity`, `imageAsset` | Franjas diagonales e imagen de fondo opcional. |
| `credentialDisplay` | `prefix` | Cómo se imprime el ID (§5). |
| `front.fields[]` | `key`, `label`, `source`, `customText`, `labelColor`, `visible` | Campos junto a la foto, en orden. `source`: `person.name`, `person.document`, `person.club`, `person.delegation`, `credential.category`, `credential.role`, `custom`. Máximo 6. |
| `front.photo` | `visible`, `widthMm`, `heightMm` | Recuadro de foto (hoy iniciales; la foto real se pega o se imprime aparte). |
| `front.roleBand` | `visible`, `useRoleColor`, `defaultColorRoles`, `icons` | Banda del rol: color del rol (`event.config.json › roles[].color`) o `colors.roleBandDefault`; `defaultColorRoles` (p. ej. `["COMP"]`) fuerza el color por defecto; `icons` por código de rol y `*`. |
| `front.access` | `visible`, `label`, `icon`, `text` | Tarjeta de acceso; `text` vacío = nombres de las zonas permitidas del rol. |
| `front.accreditation` | `visible`, `label` | Tarjeta con el número. |
| `front.qr` | `sizeMm` | 18–60 mm (por debajo de 18 los scanners fallan). |
| `front.footer.logos[]` | ids de assets | Pie del anverso, máximo 6. |
| `back` | `enabled`, `infoBox {title, icon, items[{icon, text}]}`, `emergencyContact {visible, label, icon}`, `eps {…}`, `sponsors {title, icon, logos[]}`, `barcode {visible, symbology: 'code128'}`, `footer.logos[]` | Reverso completo. `enabled: false` = una sola página por credencial. Máximo 8 viñetas de 110 caracteres. |
| `assets` | `{ id: { name, mime, dataBase64 } }` | PNG, JPG o SVG hasta 1 MB cada uno. Ids en minúsculas, números y guiones. |
| `privacy` | `printDocument`, `printEps`, `printEmergency` | Qué datos personales se imprimen (§6). |

Iconos disponibles (`BADGE_ICONS`): `none`, `kick`, `lock`, `info`, `person`, `calendar`, `id-card`, `ban`, `warning`, `phone`, `cross`, `star`, `whistle`, `camera`, `medical`, `shield`, `mic`, `handshake`. Se dibujan como vectores (`apps/print/src/icons.ts`); no son imágenes.

## 3. Cambiar colores, textos y logos (panel)

1. Entra como **Administrador** o **Coordinador** a `/admin` › **Impresión** › pestaña **Diseño de la credencial**.
2. La vista previa de la derecha se regenera sola 600 ms después de cada cambio (como imagen si el host tiene poppler; si no, como PDF). Elige el rol de muestra y si quieres ver ambos lados juntos.
3. **Colores**: selector + hex. **Textos de cabecera**: número, título, subtítulo, año, ciudad, fecha (vacíos = automáticos), silueta y prefijo del número. **Campos del anverso**: etiqueta, de dónde sale el valor, color de etiqueta, visible, orden (↑ ↓). **Banda del rol**: color por rol o por defecto, icono por rol. **Logos y archivos**: sube PNG/JPG/SVG (≤ 1 MB) con un id corto y añádelo al pie del anverso, al del reverso o a patrocinadores; reordena o quita. **Reverso**: viñetas línea a línea, tarjetas de emergencia/EPS, código de barras, patrocinadores. **Privacidad**: qué se imprime.
4. **Guardar diseño**. El host valida (mensajes por campo), guarda `data/badge-template.json` y lo registra en la auditoría (`BADGE_TEMPLATE_UPDATED`). Los lotes que ya descargaste no cambian; los próximos PDF salen con el diseño nuevo.
5. **Exportar plantilla (.json)** para guardar una copia o llevarla a otro host; **Importar plantilla** la carga en el editor (guarda para aplicarla). **Restablecer diseño del piloto** vuelve a "Nacional 2026" (pide confirmación; se pierden los logos subidos).

El Operador de impresión y el Auditor ven la pestaña en solo lectura; el host responde 403 a sus cambios.

## 4. Crear una plantilla nueva

- Desde el panel: parte de la del piloto, cambia lo que necesites y exporta el JSON con otro `id`/`name`.
- Desde código: `defaultBadgeTemplate()` devuelve la del piloto; `validateBadgeTemplate(t)` devuelve `[{ path, message }]` (vacío = válida). Una plantilla puede escribirse a mano en `data/badge-template.json` con el host apagado; si al arrancar no valida, el host avisa por consola y usa la del piloto hasta que la corrijas.
- API: `GET/PUT /print/template`, `POST /print/template/assets`, `DELETE /print/template/assets/:id`, `POST /print/template/preview`, `POST /print/template/reset` ([31-API-REFERENCIA](./31-API-REFERENCIA.md)).
- CLI: `npm run print -w apps/print -- lote.json salida.pdf event.config.json` usa la plantilla por defecto; para otra, llama a `buildCredentialsPdf(creds, config, { template, layout })`.

## 5. Número impreso y prefijo

El ID corto de Tatami Pass es `TP-2026-00428-C` (prefijo `idPrefix` + secuencial + dígito verificador Luhn mod 36, [credential-id.ts](../packages/core/src/credential-id.ts)). `credentialDisplay.prefix` cambia **solo lo impreso**: con `CNITF2026` la tarjeta y el código de barras muestran `CNITF2026-00428-C`. El secuencial y el **dígito verificador se mantienen** (se calculan sobre año + secuencial), el QR sigue llevando el ID real. El **ingreso manual del scanner sigue pidiendo el ID real** (`TP-2026-00428-C`, o solo `00428-C` normalizado): el número con prefijo es para lectura humana y para el código de barras del reverso. El seed de demo sigue en `TP-2026`.

## 6. Privacidad: qué datos personales van en el plástico

Una credencial se pierde, se fotografía y se presta. Por la **Ley 1581 de 2012** la organización decide qué imprime aunque la persona lo haya entregado: el documento y la EPS son datos personales; el contacto de emergencia es de un tercero. `privacy.printDocument`, `privacy.printEps` y `privacy.printEmergency` apagan cada dato en todos los PDF (el host no se lo pasa al renderer: `filterPersonForBadge`). Para el piloto van en `true` porque el equipo médico lo pidió; revísalo con el coordinador antes del lote grande. Los tres datos viven en la persona (`delegation`, `emergencyContact`, `eps`; el teléfono de emergencia se cifra en reposo como el documento) y llegan desde la inscripción online (sección "Contacto de emergencia y EPS", obligatoria si `registration.requireEmergencyContact`), desde SportData (columnas opcionales `Departamento`, `Contacto de emergencia`, `Teléfono de emergencia`, `EPS`, `Régimen`) o se editan en la ficha. Se purgan con el resto de datos personales a los 90 días.

## 7. Límites y simplificaciones

- La plantilla completa (con assets) debe caber cómodamente en memoria: cada asset ≤ 1 MB y el cuerpo de la API ≤ 4 MB. Diez logos de 300 KB está bien; fotos de fondo de 5 MB no.
- SVG se rasteriza con `sharp` (lo trae `apps/registration`); si no está, el logo se dibuja como un recuadro con su nombre. PNG y JPG se embeben tal cual.
- La foto del participante todavía no se imprime (recuadro con iniciales); ver [80 §9](./80-COMO-PROBAR.md).
- Fuentes: Barlow Condensed 700/800 y Barlow 400/600 (`apps/print/fonts/`, licencia OFL en `fonts/OFL.txt`). Si faltan, Helvetica de pdf-lib (sin algunos caracteres fuera de WinAnsi).
- La vista previa se firma con una clave efímera: su QR da `UNKNOWN_KEY` en cualquier scanner.
- `layout: 'duplex'` pone anverso y reverso en una hoja de 200 × 150 mm (útil para revisar o para impresoras sin dúplex); `'two-pages'` (por defecto en lotes) es una página por lado.

## 8. Qué falta entregar para el diseño final

Los logos de la plantilla por defecto son **placeholders** (SVG con el nombre): ITF, Federación, Alcaldía de Popayán, Secretaría de Deporte y Recreación y cuatro patrocinadores. La silueta de la catedral es un SVG geométrico simple. Para reemplazarlos: sube los PNG/SVG reales desde el panel con los mismos ids (`logo-itf`, `logo-federacion`, `logo-alcaldia`, `logo-secretaria`, `sponsor-1..4`, `skyline`) o edita la plantilla exportada.

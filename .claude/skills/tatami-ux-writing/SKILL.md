---
name: tatami-ux-writing
description: Reglas y catálogo de UX writing de Tatami Pass (docs/70) para escribir o revisar cualquier texto visible en scanner, panel, formulario, correos o impresos. Úsala al añadir un mensaje, un botón, un estado vacío o un error, y al revisar PRs con texto en español.
---

# UX writing de Tatami Pass

Fuente de verdad: `docs/70-UX-WRITING.md`. Esta skill es el resumen operativo; ante la duda, lee el documento.

## Voz (siempre) y tono (según situación)

Clara · humana · deportiva · calmada bajo presión. Todo bien → breve y cálido ("Adelante, Juan"). Rechazo → firme, sin culpar, con salida. Alerta → serio y concreto. Error del sistema → honesto y tranquilo. Formulario → servicial y paciente. Panel → neutro y preciso.

## Diez reglas

1. Una idea por pantalla.
2. Verbo primero ("Escanea la credencial").
3. **Qué pasó + por qué + qué hacer**, en ese orden. Sin "qué hacer", el mensaje está incompleto.
4. Tuteo al operador, inscriptor y participante; tercera persona para quien está en la puerta ("No puede entrar").
5. Nombres, no números (ID corto solo cuando hace falta para actuar).
6. Sin jerga: usa el glosario (abajo).
7. Scanner: título ≤ 28 caracteres y 1 línea; cuerpo ≤ 90 caracteres y 2 líneas; una acción.
8. Nunca culpar ("No pude leer el código", no "Código inválido").
9. Decir el siguiente paso aunque sea "nada" ("Sigue escaneando: se envía solo cuando vuelva").
10. Lo mismo se llama igual en scanner, panel y formulario.

## Glosario humano → no decimos

Pendientes por enviar → cola/outbox · Conectado / Sin conexión → online/offline · Actualizar datos → sync/pull · Credencial → token/pase · Código → QR/payload · ID corto → serial · Credencial anulada → revocada (en el panel la acción sí es "Anular") · Hay una credencial más nueva → versión anterior · Ya entró a {zona} → anti-passback · Se usó en otra puerta hace N min → duplicado · Registro de auditoría → audit log · Registro íntegro/alterado → hash válido/inválido · Enrolar este dispositivo → provisionar · Terminar turno → logout · Clave de acceso (PIN) · Computador central → host · Copia de seguridad → backup · Equipo de respaldo → standby · Zona → área/scope.

## Catálogo del scanner (códigos y títulos; cuerpos completos en docs/70 §4)

- **ALLOW** (verde, ✓, bip, 1 vibración): `ALLOW` "Adelante, {nombre}" · `ALLOW_OUT` "Hasta luego, {nombre}" · `ALLOW_MANUAL` · `ALLOW_OVERRIDE` · `ALLOW_NO_PHOTO` · `ALLOW_DELIVERY` "Entregada a {nombre}".
- **DENY** (rojo, ✕, bop doble, 2 vibraciones), título "No puede entrar" salvo que se indique: `ALREADY_INSIDE` "Esta credencial ya entró a {zona} a las {hora}." → "Pide que salga y vuelva a escanear, o llama al supervisor." · `ZONE_NOT_ALLOWED` "Esta credencial no vale para {zona}. Puede ir a: {zonas}." · `REVOKED` "Esta credencial fue anulada." · `SUPERSEDED` "Hay una credencial más nueva para esta persona." · `OUT_OF_DATES` "Esta credencial no es de hoy. Vale del {desde} al {hasta}." · `EXPIRED_CODE` "Este código ya venció." · `WRONG_EVENT` "Esta credencial es de otro evento." · `SIGNATURE_INVALID` "Esta credencial no es válida." → "Llama al supervisor. No la devuelvas todavía." · `KEY_UNKNOWN` · `NOT_FOUND` (título "No reconozco esta credencial") · `FORMAT_UNKNOWN` (título "Este código no es de Tatami Pass") · `PHOTO_MISMATCH` · `DEVICE_DISABLED` (título "Este scanner está desactivado").
- **ALERT** (ámbar, !, 3 tonos, 3 vibraciones), título "Revisa con el supervisor": `ALERT_DUPLICATE` "Esta credencial se usó en {otraPuerta} hace {min} min." · `ALERT_KEY_REVIEW` · `ALERT_MANY_MANUAL` (título "Muchos ingresos manuales") · `ALERT_REVOKED_SCAN`.
- **Estado** (sin sonido): "● Conectado" · "○ Sin conexión · sigue escaneando" · "{n} pendientes por enviar" · "Enviando {n}…" · "No pude leer el código." · "Tu turno terminó por tiempo." · "PIN incorrecto. Te quedan {n} intentos." · "La hora del celular está desfasada." · "Turno terminado. {n} escaneos · {r} rechazos · {m} manuales · {p} pendientes".

Mapa `ReasonCode` de core → código de catálogo: `ANTI_PASSBACK`→`ALREADY_INSIDE`, `OLD_VERSION`→`SUPERSEDED`, `NOT_YET_VALID`/`EXPIRED`/`DAY_NOT_ALLOWED`→`OUT_OF_DATES`, `DIGITAL_TOKEN_EXPIRED`→`EXPIRED_CODE`, `BAD_SIGNATURE`→`SIGNATURE_INVALID`, `UNKNOWN_KEY`→`KEY_UNKNOWN`, `UNKNOWN_CREDENTIAL`→`NOT_FOUND`, `MALFORMED`→`FORMAT_UNKNOWN`, `DUPLICATE`→`ALERT_DUPLICATE`.

## Formulario, panel y botones

- Formulario (docs/70 §5): explica el dato y el porqué ("La fecha de nacimiento no corresponde a Juvenil. Para esta fecha, la categoría es Adulto."); cupo lleno ofrece lista de espera; consentimiento de acudiente con nombre y documento.
- Panel (docs/70 §6): confirmaciones destructivas piden la palabra (RESTAURAR, PROMOVER, nombre del evento); semáforo de salud con texto, no solo color; estados vacíos dicen qué hacer.
- Botones (docs/70 §7): verbo corto, ≤ 3 palabras, dicen lo que pasa ("Anular", no "Sí"); destructivo nunca primario por defecto; sin exclamaciones.
- Puntuación (docs/70 §8): sentence case; títulos del scanner sin punto final, cuerpos con punto; cifras siempre; horas 24 h; miles con punto (2.000); sin emojis.

## Dónde viven los textos en el código

- Decisiones del scanner: `packages/core/src/access-rules.ts` (`messageTitle`, `messageBody`, `nextAction`) y `apps/scanner/src/screens/Result.tsx`.
- Estados y sistema del scanner: `apps/scanner/src/screens/*.tsx`, `apps/scanner/src/sync.ts`.
- Errores de la API del host: cada ruta (`reply.code(…).send({ error: '…' })`) y `packages/core/src/config-validation.ts`, `companions.ts`.
- Panel: `apps/host-admin/src/pages/*.tsx`, `apps/host-admin/src/ui.tsx`.
- Formulario y correos: `apps/registration/lib/validate.ts`, `lib/mail-templates.ts`, `lib/labels.ts`, `app/**`.

## Procedimiento para un texto nuevo

1. Escribe título / cuerpo / acción con las tres partes.
2. Pásalo por el checklist de docs/70 §11 (qué pasó + por qué + qué hacer; ≤ 2 líneas; glosario; tuteo; no culpa; icono + sonido + vibración si es decisión; mismo nombre en todas partes).
3. Añádelo al catálogo de docs/70 en la sección que corresponda, con su código, **en el mismo PR** que el código.
4. Si es una decisión nueva, también: `ReasonCode` en `packages/core/src/types.ts`, mensaje en `access-rules.ts`, test, y fila en docs/70 §4.

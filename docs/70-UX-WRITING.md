# 70 · Guía de UX writing — Tatami Pass

> Coherente con `00-DECISIONES.md` v1.0 §12. Audiencia: quien escriba cualquier texto que vea un usuario (pantallas, correos, impresos). Esta guía es la fuente de verdad de los mensajes; el código los toma de aquí (archivo `packages/core/src/messages.es.ts`).

## 1. Voz y tono

**Voz** (siempre igual): clara, humana, deportiva, calmada bajo presión.

- **Clara:** una persona con guantes, prisa y ruido de fondo entiende el mensaje en un vistazo.
- **Humana:** hablamos con nombre ("Adelante, Juan"), no con códigos.
- **Deportiva:** energía, respeto, sin burocracia. Como un buen árbitro: firme y amable.
- **Calmada bajo presión:** un rechazo no es un regaño. Un error no es una catástrofe. Siempre hay un siguiente paso.

**Tono** (cambia según la situación):

| Situación | Tono | Ejemplo |
|---|---|---|
| Todo bien | Breve y cálido | "Adelante, Juan" |
| Rechazo | Firme, sin culpar, con salida | "No puede entrar. Esta credencial no vale para Tatamis. Puede ir a Gradería y Calentamiento." |
| Alerta | Serio, concreto, sin alarmar al público | "Revisa con el supervisor" |
| Error del sistema | Honesto y tranquilo | "No pude leer el código. Inténtalo de nuevo o usa el ID corto." |
| Formulario | Servicial, paciente | "La fecha de nacimiento no corresponde a Juvenil. Para esta fecha, la categoría es Adulto." |
| Panel admin | Neutro, preciso | "12 dispositivos conectados · 0 pendientes · Último backup hace 3 min" |

## 2. Principios

1. **Una idea por pantalla.** El scanner muestra una decisión. El formulario pide un dato a la vez cuando hay error.
2. **Verbo primero.** "Escanea la credencial", no "La credencial debe ser escaneada".
3. **Qué pasó + por qué + qué hacer.** Todo mensaje de rechazo o error tiene las tres partes, en ese orden. Si falta "qué hacer", el mensaje está incompleto.
4. **Tuteo.** Al operador, al inscriptor y al participante les hablamos de tú. A la persona que se presenta en la puerta nos referimos en tercera persona ("No puede entrar") porque el mensaje lo lee el portero.
5. **Nombres, no números.** "Juan Pérez", "Tatamis", "Academia Caucana de Taekwondo". El ID corto solo cuando es necesario para actuar.
6. **Sin jerga.** Si una palabra necesita explicación, no va. Ver glosario.
7. **Máximo 2 líneas en el scanner.** Título de 1 línea, cuerpo de hasta 2 líneas, una acción. En un celular a un brazo de distancia.
8. **Nunca culpar.** "No pude leer el código" en vez de "Código inválido". "Esta credencial" en vez de "Tu credencial falsa".
9. **Decir el siguiente paso aunque sea "nada".** "Sin conexión. Sigue escaneando: se envía solo cuando vuelva."
10. **Consistencia:** la misma cosa se llama igual en todas partes. Si en el scanner es "Ingreso manual", en el panel también.

## 3. Glosario: lenguaje humano vs técnico

| Decimos (humano) | No decimos (técnico) | Dónde |
|---|---|---|
| Pendientes por enviar | Sync pendiente, cola, outbox | Scanner |
| Conectado / Sin conexión | Online / Offline, WebSocket | Scanner, panel |
| Actualizar datos | Forzar sync, pull, refresh snapshot | Scanner |
| Credencial | Token, pase, QR (el QR es el código, la credencial es el objeto) | Todos |
| Código | QR, token, payload | Scanner, participante |
| ID corto | Serial, credentialId | Todos |
| Credencial anulada | Revocada | Scanner, participante (en el panel sí se dice "Revocar", es acción del Coordinador) |
| Hay una credencial más nueva | Versión anterior, superseded | Scanner |
| Ya entró a [zona] | Anti-passback, ALREADY_INSIDE | Scanner |
| Se usó en otra puerta hace N min | Duplicado, ALERT_DUPLICATE | Scanner |
| Registro de auditoría | Audit log, hash chain | Panel |
| Registro íntegro / registro alterado | Hash válido / inválido | Panel |
| Enrolar este dispositivo | Provisionar, bindear, pair | Scanner |
| Terminar turno | Logout, cerrar sesión | Scanner |
| Clave de acceso (PIN) | Credencial de operador | Scanner |
| Computador central | Host, servidor | Manuales, scanner |
| Copia de seguridad | Backup, snapshot | Panel |
| Equipo de respaldo | Standby | Panel |
| Zona | Área, perímetro, scope | Todos |
| Entrada / Salida | in / out, dirección | Scanner |
| Autorizar (supervisor) | Override, bypass | Scanner |
| Ingreso manual | Fallback, bypass manual | Scanner |
| Cupo lleno | Quota exceeded | Formulario |
| Lista de espera | Waitlist | Formulario |
| Acudiente | Tutor legal, guardian | Formulario |
| Aviso de privacidad | Política de tratamiento de datos (correcto legalmente, pero el botón dice "aviso") | Formulario |

## 4. Catálogo de mensajes del scanner

Formato: **Título** (1 línea, ≤ 28 caracteres) / **Cuerpo** (≤ 2 líneas, ≤ 90 caracteres) / **Acción** (lo que hace el portero, o botón). Variables entre `{}`. Siempre con icono y sonido/vibración (ver §10).

### 4.1 ALLOW (pantalla verde, ✓, bip corto, 1 vibración)

| Código | Título | Cuerpo | Acción |
|---|---|---|---|
| `ALLOW` | Adelante, {nombre} | {nombreCompleto} · {rol} · {club}<br/>Zona: {zona} | (ninguna; se limpia en 3 s) |
| `ALLOW_OUT` | Hasta luego, {nombre} | Salida de {zona} registrada. | — |
| `ALLOW_MANUAL` | Adelante, {nombre} | Ingreso manual registrado · {motivo} | — |
| `ALLOW_OVERRIDE` | Adelante, {nombre} | Autorizado por supervisor · {motivo} | — |
| `ALLOW_NO_PHOTO` | Adelante, {nombre} | Credencial sin foto (General). No hay que comparar. | — |
| `ALLOW_DELIVERY` | Entregada a {nombre} | {rol} · {club}. Marcada como entregada. | — |

### 4.2 DENY (pantalla roja, ✕, bop grave, 2 vibraciones)

| Código | Título | Cuerpo | Acción |
|---|---|---|---|
| `ALREADY_INSIDE` | No puede entrar | Esta credencial ya entró a {zona} a las {hora}. | Pide que salga y vuelva a escanear, o llama al supervisor. [Autorizar (supervisor)] |
| `ZONE_NOT_ALLOWED` | No puede entrar | Esta credencial no vale para {zona}.<br/>Puede ir a: {zonasPermitidas}. | Indícale su zona. |
| `REVOKED` | No puede entrar | Esta credencial fue anulada. | Que vaya a la mesa de acreditación con su documento. |
| `SUPERSEDED` | No puede entrar | Hay una credencial más nueva para esta persona. | Que use la nueva o vaya a acreditación. |
| `OUT_OF_DATES` | No puede entrar | Esta credencial no es de hoy. Vale del {desde} al {hasta}. | Que vaya a la mesa de acreditación. |
| `ROLE_RULE` | No puede entrar | {rol} no tiene acceso a {zona} en este horario. | Indícale cuándo puede entrar: {horario}. |
| `EXPIRED_CODE` | No puede entrar | Este código ya venció. | Pide que actualice su credencial digital y vuelva a mostrarla. |
| `WRONG_EVENT` | No puede entrar | Esta credencial es de otro evento. | Que vaya a la mesa de acreditación. |
| `SIGNATURE_INVALID` | No puede entrar | Esta credencial no es válida. | Llama al supervisor. No la devuelvas todavía. |
| `KEY_UNKNOWN` | No puede entrar | No reconozco la clave de esta credencial. | Toca Actualizar datos. Si sigue, llama al supervisor. [Actualizar datos] |
| `NOT_FOUND` | No reconozco esta credencial | No está en mi lista. Puede ser muy reciente. | Toca Actualizar datos o usa Ingreso manual con el ID corto. [Actualizar datos] [Ingreso manual] |
| `FORMAT_UNKNOWN` | Este código no es de Tatami Pass | Parece otro tipo de código. | Pide la credencial del evento. |
| `PHOTO_MISMATCH` | No puede entrar | Marcaste que no es la persona de la foto. | Llama al supervisor. |
| `DEVICE_DISABLED` | Este scanner está desactivado | Un supervisor lo desactivó. | Pide el scanner de reserva. |

### 4.3 ALERT (pantalla ámbar, !, alarma corta, 3 vibraciones)

| Código | Título | Cuerpo | Acción |
|---|---|---|---|
| `ALERT_DUPLICATE` | Revisa con el supervisor | Esta credencial se usó en {otraPuerta} hace {min} min. | Pide que espere a un lado y llama al supervisor. |
| `ALERT_KEY_REVIEW` | Revisa con el supervisor | Esta credencial requiere verificación con documento. | Compara foto y documento. Si coincide, toca Autorizar. [Autorizar (supervisor)] |
| `ALERT_MANY_MANUAL` | Muchos ingresos manuales | Este scanner lleva {n} ingresos manuales en 1 hora. | Avisa al supervisor. |
| `ALERT_REVOKED_SCAN` | Revisa con el supervisor | Esta credencial está anulada por uso indebido. | Retén la credencial si puedes y llama al supervisor. |

### 4.4 Estado y sistema (barra superior o aviso discreto, sin sonido)

| Código | Texto | Nota |
|---|---|---|
| `STATUS_ONLINE` | ● Conectado | Punto verde. |
| `STATUS_OFFLINE` | ○ Sin conexión · sigue escaneando | Punto gris. No es error. |
| `STATUS_PENDING` | {n} pendientes por enviar | Abajo a la derecha. En 0 se atenúa. |
| `STATUS_SYNCING` | Enviando {n}… | Breve. |
| `STATUS_ZONE` | {puerta} · {zona} · {direccion} | Siempre visible arriba. |
| `UPDATE_AVAILABLE` | Hay una versión nueva. Toca para actualizar. | Solo entre escaneos. |
| `CAMERA_ERROR` | No puedo abrir la cámara. | Cierra y abre la app. Si sigue, reinicia el celular. [Reintentar] |
| `CAMERA_PERMISSION` | Necesito permiso para usar la cámara. | Toca Permitir cuando el celular lo pregunte. [Dar permiso] |
| `INSECURE_CONTEXT` | Esta página no es segura para la cámara. | Instala el certificado y abre la dirección con https. [Ver guía] |
| `SCAN_TIMEOUT` | No pude leer el código. | Acércalo, evita reflejos o usa Ingreso manual. [Ingreso manual] |
| `SESSION_EXPIRED` | Tu turno terminó por tiempo. | Escribe tu PIN para continuar. |
| `PIN_WRONG` | PIN incorrecto. Te quedan {n} intentos. | |
| `PIN_LOCKED` | PIN bloqueado 5 minutos. | Si lo olvidaste, pide uno nuevo al supervisor. |
| `LOW_BATTERY` | Batería al {n} %. Conecta el power bank. | A 20 % y 10 %. |
| `CLOCK_SKEW` | La hora del celular está desfasada. | Activa Fecha y hora automática en Ajustes. |
| `ENROLL_OK` | Listo. Este scanner es {puerta} · {zona}. | Tras enrolar. |
| `ENROLL_EXPIRED` | Este código de enrolamiento venció. | Pide uno nuevo al supervisor. |
| `SHIFT_SUMMARY` | Turno terminado. {n} escaneos · {r} rechazos · {m} manuales · {p} pendientes | Si p > 0: "Acércate al router un minuto antes de entregar." |

### 4.5 Tatami Radio (panel deslizable "Radio" del scanner, docs/34)

| Código | Texto | Nota |
|---|---|---|
| `RADIO_PILL` | ● Radio · {hablante} 🎙 · Hablando · Orden sin confirmar | Píldora en la barra superior; punto verde conectada, rojo reconectando. |
| `RADIO_HEAD` | Radio · {canal} · Conectada · {n} en el canal | Cabecera del panel. Sin host: "Sin host · reconectando · {n} equipos conectados". |
| `RADIO_PTT_IDLE` | Escuchando · Mantén pulsado para hablar | Botón grande azul claro. |
| `RADIO_PTT_TALKING` | Hablando · Suelta para terminar | Verde; tono `ok` al concederse la palabra. |
| `RADIO_PTT_BUSY` | Ocupado · {nombre} está hablando · sigue pulsando y te toca | Ámbar. En cola; al soltar, sale de la cola. |
| `RADIO_PTT_REQUESTING` | Pidiendo la palabra… | Breve, entre pulsar y la respuesta del host. |
| `RADIO_PTT_SPEAKER` | {nombre} hablando · Mantén pulsado para pedir la palabra | Alguien habla y no has pulsado. |
| `RADIO_PTT_LOCAL` | Hablando (sin host) · Te oyen {n} equipos que ya estaban | Host caído: habla sin arbitraje. |
| `RADIO_PTT_NOHOST` | Escuchando (sin host) · Sin host: hablas solo con {n} equipos ya conectados | Host caído con pares vivos. |
| `RADIO_PTT_OFF` | Sin radio · Sin conexión con el host · reconectando | Gris. Sin host y sin pares. |
| `RADIO_NO_MIC` | Sin micrófono · Solo escuchas. Da permiso al micrófono para hablar. | Permiso denegado. |
| `RADIO_SPEAKER` | {nombre} hablando · Estás hablando · Nadie habla ahora | Indicador sobre el botón. |
| `RADIO_EMERGENCY` | 🚨 Emergencia · {nombre} está hablando a todos | Banner rojo; sirena de dos tonos + vibración larga; salta al canal Emergencia. |
| `RADIO_EMERGENCY_BTN` | 🚨 Emergencia | Botón rojo: mantén pulsado para hablar a todos. |
| `RADIO_ORDER` | {orden} · {quién} · {hora} [Recibido] | Suena `order`, vibra y se lee en voz alta "Orden: {orden}" (es-CO). Emergencia: "Emergencia. {orden}". |
| `RADIO_ORDER_ACKED` | … · recibido ✓ · recibido (se confirma al volver el host) | Tras tocar Recibido. |
| `RADIO_ORDERS_EMPTY` | Sin órdenes todavía. Cuando llegue una, suena, vibra y se lee en voz alta. | Estado vacío. |
| `RADIO_PARTICIPANTS_EMPTY` | Nadie más en el canal todavía. | Estado vacío. |
| `RADIO_ERR_CHANNEL` | Ese canal no existe. · Tu rol no puede entrar al canal {canal}. · El canal {canal} está lleno ({n}). Usa otro canal o pide al supervisor que lo amplíe. | Errores del host. |
| `RADIO_ERR_TALK` | Entra a un canal antes de hablar. · En {canal} solo escuchas: tu rol no puede hablar aquí. | |
| `RADIO_ERR_ORDER` | Solo supervisores, coordinación o administración envían órdenes. · Esa orden no está en el catálogo. · Indica la puerta para esta orden. · Ese equipo no está conectado a la radio. · Indica el canal al que va la orden. · Esa orden ya no existe. | |

Órdenes del catálogo por defecto (editable): Abrir Puerta {n} · Cerrar Puerta {n} · Pausar ingreso · Reanudar ingreso · Supervisor a Puerta {n} · Evacuación (emergencia).

## 5. Mensajes del formulario de inscripción

### 5.1 Edad y categoría

| Código | Mensaje |
|---|---|
| `AGE_MISMATCH` | La fecha de nacimiento no corresponde a {categoriaElegida}. Para el {fechaEvento}, {nombre} tendrá {edad} años: la categoría es **{categoriaCorrecta}**. [Usar {categoriaCorrecta}] |
| `AGE_TOO_YOUNG` | Para competir hay que tener al menos {min} años el {fechaEvento}. |
| `AGE_INVALID_DATE` | Revisa la fecha de nacimiento. Escríbela como día / mes / año. |
| `MINOR_CONSENT_REQUIRED` | {nombre} es menor de edad. Necesitamos el nombre y documento de su padre, madre o acudiente, y su autorización. |
| `MINOR_CONSENT_DOC` | Escribe el documento del acudiente sin puntos ni espacios. |

### 5.2 Cupos y lista de espera

| Código | Mensaje |
|---|---|
| `QUOTA_FULL_ROLE` | Cupo lleno para {rol}. Puedes dejar a {nombre} en lista de espera: te avisamos por correo si se abre un lugar. [Lista de espera] [Cancelar] |
| `QUOTA_FULL_CATEGORY` | Cupo lleno en {categoria}. Puedes dejar a {nombre} en lista de espera. [Lista de espera] |
| `QUOTA_FULL_GLOBAL` | El evento alcanzó su cupo total. Puedes dejar a {nombre} en lista de espera. [Lista de espera] |
| `QUOTA_FULL_CLUB_COACH` | Tu club ya tiene {n} coaches inscritos, el máximo permitido. Si necesitas cambiar uno, escribe al Coordinador. |
| `WAITLIST_OK` | {nombre} está en lista de espera, puesto {pos}. Te escribimos a {correo} si se abre un lugar. |
| `WAITLIST_PROMOTED` (correo) | Buenas noticias: se abrió un lugar para {nombre} en {rol}. Su inscripción pasó a revisión del Coordinador. |

### 5.3 Datos y validación

| Código | Mensaje |
|---|---|
| `REQUIRED` | Este dato es obligatorio. |
| `NAME_SHORT` | Escribe nombre y apellido completos, como en el documento. |
| `DOC_FORMAT` | Escribe el documento sin puntos ni espacios. |
| `PHOTO_REQUIRED` | Sube una foto de frente, con la cara completa y fondo claro. Se usa para la credencial. |
| `PHOTO_TOO_SMALL` | La foto es muy pequeña. Necesita al menos 400 × 500 píxeles. |
| `PHOTO_FACE` | No vemos una cara clara en la foto. Prueba con otra. |
| `DUPLICATE_PERSON` | Ya existe una inscripción con este nombre y fecha de nacimiento en {club}. Si es la misma persona, no la inscribas de nuevo: escribe al Coordinador. |
| `EMAIL_INVALID` | Revisa el correo. Ejemplo: nombre@correo.com |

Contacto de emergencia y EPS (sección opcional del formulario; obligatoria si `registration.requireEmergencyContact`):

| Código | Mensaje |
|---|---|
| `EMERGENCY_INTRO` | {Obligatorio\|Opcional}: van impresos en el reverso de la credencial para que el equipo médico sepa a quién llamar. |
| `EMERGENCY_NAME_REQUIRED` | Escribe el nombre de a quién llamar en una emergencia. |
| `EMERGENCY_PHONE_REQUIRED` | Escribe el teléfono del contacto de emergencia. |
| `EMERGENCY_INCOMPLETE` | El contacto de emergencia necesita nombre y teléfono. |
| `EMERGENCY_PHONE_INVALID` | Revisa el teléfono. Ejemplo: 310 234 5678 |

### 5.4 Consentimiento

| Código | Mensaje |
|---|---|
| `CONSENT_REQUIRED` | Para continuar, lee el aviso de privacidad y marca la casilla. |
| `CONSENT_LABEL` | He leído el aviso de privacidad y autorizo el tratamiento de mis datos (y de los del menor que inscribo, si aplica) para el campeonato. |
| `CONSENT_MINOR_LABEL` | Soy el padre, madre o acudiente de {nombre} y autorizo su inscripción y el tratamiento de sus datos. |

### 5.5 Estados y confirmaciones

| Código | Mensaje |
|---|---|
| `SUBMIT_OK` | Inscripción recibida. Te enviamos un correo a {correo}. El Coordinador la revisará y te avisaremos cuando esté aprobada. |
| `STATUS_REGISTERED` | Inscrito · en revisión |
| `STATUS_VALIDATED` | Validado · pendiente de aprobación |
| `STATUS_APPROVED` | Aprobado · credencial en preparación |
| `STATUS_ISSUED` | Credencial lista · recoger en acreditación |
| `STATUS_DELIVERED` | Credencial entregada |
| `STATUS_WAITLIST` | En lista de espera · puesto {pos} |
| `STATUS_REJECTED` | No aprobada · {motivo} |
| `DIGITAL_READY` (correo) | Tu credencial digital está lista. Ábrela el {fecha} desde este enlace. El código cambia cada minuto: no sirve en pantallazo. |
| `DIGITAL_OFFLINE` | Sin internet. Este código vence a las {hora}. Si vence, acércate a taquilla con tu ID: {idCorto}. |

## 6. Mensajes del panel admin

### 6.1 Acciones y confirmaciones

| Código | Mensaje |
|---|---|
| `REVOKE_CONFIRM` | ¿Anular la credencial {id} de {nombre}? Dejará de servir en todas las puertas en menos de un minuto. [Anular] [Cancelar] |
| `REVOKE_OK` | Credencial {id} anulada. |
| `REISSUE_CONFIRM` | ¿Emitir una nueva versión para {nombre}? La actual ({id}) queda anulada. [Emitir nueva] [Cancelar] |
| `REISSUE_OK` | Nueva credencial {idNuevo} lista para imprimir. |
| `ISSUE_BATCH_OK` | {n} credenciales emitidas. {m} quedaron pendientes: {motivos}. |
| `PRINT_BATCH_OK` | PDF listo: {n} credenciales. [Descargar] [Marcar como impreso] |
| `RADIO_ORDER_SENT` | Orden enviada: {orden} | Toast de panel › Radio. |
| `RADIO_ACK_TAG` | {puerta} recibió {hora} · sin acuse | Etiqueta junto a cada orden enviada, en tiempo real. |
| `RADIO_NO_WS` | Sin conexión con la radio. Reintenta en unos segundos. | Toast de error al enviar una orden sin WebSocket. |
| `RADIO_CONFIG_OK` | Canales y órdenes guardados. Los scanners los reciben al instante. | |
| `RADIO_HISTORY_EMPTY` | Sin actividad de radio ese día. | Estado vacío del historial. |
| `RADIO_SIDEBAR` | Radio: {n} equipos conectados | Semáforo de la barra lateral. |
| `BADGE_TEMPLATE_SAVED` | Diseño guardado. Los próximos PDF salen con esta plantilla. |
| `BADGE_TEMPLATE_INVALID` | El diseño tiene errores. Revisa los campos marcados. (Por campo: "El color debe ser hexadecimal de 6 dígitos, como #0F2A6B." · "El QR mide entre 18 y 60 mm; por debajo de 18 mm los scanners fallan." · "El logo "{id}" no existe. Súbelo o quítalo de la lista." · "Máximo 6 campos en el anverso: no caben más junto a la foto." · "Cada línea tiene máximo 110 caracteres.") |
| `BADGE_ASSET_OK` | Archivo "{nombre}" subido. Ya puedes usarlo en el pie o en patrocinadores. |
| `BADGE_ASSET_TOO_BIG` | El archivo pesa más de 1 MB. Reduce la imagen antes de subirla. |
| `BADGE_ASSET_BAD_TYPE` | Solo se aceptan imágenes PNG, JPG o SVG. |
| `BADGE_ASSET_BAD_ID` | Pon un id corto para el archivo: minúsculas, números y guiones (p. ej. logo-liga). |
| `BADGE_ASSET_REMOVED` | Archivo quitado de la plantilla. |
| `BADGE_RESET_CONFIRM` | Vuelve a la plantilla "Nacional 2026" con logos de ejemplo. Se pierden los colores, textos y logos que hayas cambiado. Exporta la plantilla antes si quieres conservarla. [Restablecer] [Cancelar] |
| `BADGE_RESET_OK` | Diseño restablecido al del piloto. |
| `BADGE_EXPORT_OK` | Plantilla exportada. Guárdala como copia o compártela con otro host. |
| `BADGE_IMPORT_OK` | Plantilla importada. Revisa la vista previa y guarda para aplicarla. |
| `BADGE_PREVIEW_NOTE` | La muestra se firma con una clave de prueba: su QR no vale en ninguna puerta. |
| `BADGE_PRIVACY_NOTE` | Una credencial se pierde, se fotografía y se presta. Imprime solo lo que la operación necesita (Ley 1581 de 2012): el documento y la EPS son datos personales; el contacto de emergencia es de un tercero. Lo que apagues aquí no sale en ningún PDF aunque la persona lo haya dado. |
| `IMPORT_PREVIEW` | Vamos a crear {c} personas, actualizar {u} y omitir {s}. Revisa el mapeo antes de confirmar. |
| `IMPORT_OK` | Importación terminada: {c} creadas, {u} actualizadas, {s} omitidas. |
| `IMPORT_COLUMN_UNMAPPED` | Falta asignar la columna de {campo}. Elige cuál columna del archivo corresponde. |
| `CONFIG_SAVED` | Configuración guardada. Los scanners la reciben en menos de un minuto. |
| `CONFIG_QUOTA_BELOW_ISSUED` | Ya hay {n} credenciales emitidas para {rol}. Bajar el cupo a {m} no anula ninguna; solo bloquea nuevas emisiones. [Guardar igual] [Cancelar] |
| `ENROLL_QR_TITLE` | Escanea con el celular. Vence en {min}:{seg}. |
| `DEVICE_DISABLE_CONFIRM` | ¿Desactivar {dispositivo}? Dejará de enviar datos. Lo que tenga guardado no se pierde. [Desactivar] [Cancelar] |
| `PROMOTE_CONFIRM` | ¿Convertir este equipo en el principal? Hazlo solo si el principal no responde. [Promover] [Cancelar] |
| `EXPORT_PASSWORD` | Este archivo contiene datos personales. Ponle una contraseña antes de descargarlo. |
| `PURGE_CONFIRM` | Se borrarán los datos personales de {n} personas de forma definitiva. Esta acción no se puede deshacer. Escribe el nombre del evento para confirmar. |
| `AUDIT_OK` | Registro íntegro hasta el número {seq}. |
| `AUDIT_BROKEN` | El registro fue alterado a partir del número {seq}. No modifiques nada y avisa al Administrador. |

### 6.2 Semáforo de salud

| Estado | Texto | Color |
|---|---|---|
| OK | Todo en orden | Verde |
| Dispositivo sin reportar | {dispositivo} sin reportar hace {min} min | Ámbar > 1 min, rojo > 5 min |
| Pendientes acumulados | {dispositivo} tiene {n} pendientes por enviar | Ámbar > 50, rojo > 200 |
| Backup atrasado | Última copia de seguridad hace {min} min | Ámbar > 6, rojo > 10 |
| Standby atrasado | Equipo de respaldo con {n} eventos de retraso | Ámbar > 10, rojo > 100 |
| Nube | Sin conexión con la nube hace {h} h (no afecta las puertas) | Gris, informativo |
| Hora | Hora del equipo no sincronizada | Ámbar |
| Disco | Quedan {gb} GB de espacio | Ámbar < 5, rojo < 1 |

### 6.3 Notificaciones (toasts)

- Breves, ≤ 60 caracteres, desaparecen en 4 s. Las de error no desaparecen hasta cerrarlas.
- "Guardado." / "Credencial anulada." / "No se pudo guardar. Inténtalo de nuevo." / "Sin conexión con el computador central. Reintentando…"

### 6.4 Estados vacíos

| Pantalla | Texto |
|---|---|
| Inscripciones (sin datos) | Todavía no hay inscripciones. Comparte el enlace del formulario con los clubes. [Copiar enlace] |
| Credenciales (sin emitir) | No hay credenciales emitidas. Aprueba inscripciones y luego emite. [Ver inscripciones] |
| Dispositivos | No hay scanners enrolados. Enrola el primero desde aquí. [Enrolar] |
| Incidencias | Sin incidencias. Ojalá siga así. |
| Alertas | Sin alertas activas. |
| Lista de espera | Nadie en lista de espera. |
| Reportes (evento no iniciado) | Los reportes aparecen cuando empiecen los escaneos. |
| Búsqueda sin resultados | No encontré a nadie con "{busqueda}". Prueba con el apellido o el ID corto. |
| Scanner, lista de pendientes | Nada pendiente. Todo enviado. |

## 7. Microcopy de botones

Verbo en infinitivo o imperativo corto. Máximo 3 palabras. Sin "Aceptar/Cancelar" genérico cuando se puede decir la acción.

| Contexto | Primario | Secundario |
|---|---|---|
| Confirmar acción destructiva | Anular / Desactivar / Borrar | Cancelar |
| Formulario de inscripción | Enviar inscripción | Guardar borrador |
| Lista de espera | Entrar a lista de espera | Ahora no |
| Scanner, rechazo | Autorizar (supervisor) | Ingreso manual |
| Scanner, foto | No es la persona | — |
| Scanner, menú | Terminar turno · Cambiar zona · Actualizar datos · Reportar incidencia | |
| Enrolar | Enrolar este dispositivo | |
| Impresión | Generar PDF · Marcar como impreso · Reimprimir IDs | |
| Entrega | Entregada | No es la persona |
| Panel, credencial | Re-emitir · Anular · Editar zonas | |
| Exportes | Descargar con contraseña | |
| Promoción | Promover | Cancelar |
| Errores | Reintentar | Ver guía |

Reglas:
- El botón dice lo que pasa al tocarlo: "Anular", no "Sí".
- El botón destructivo nunca es el primario por defecto en un diálogo; el foco está en Cancelar.
- Sin signos de exclamación en botones.

## 8. Mayúsculas y puntuación

- **Mayúscula inicial solo en la primera palabra** (sentence case): "Ingreso manual", no "Ingreso Manual".
- Nombres propios con su mayúscula: Tatami Pass, Tatamis (como nombre de zona), Coordinador (como rol del sistema), Academia Caucana de Taekwondo.
- Roles de acceso en mayúsculas **solo en la credencial impresa** (COMPETIDOR). En pantalla, sentence case ("Competidor").
- **Títulos del scanner sin punto final.** Cuerpos y acciones con punto final.
- Un solo signo de exclamación como máximo por pantalla, y solo en ALLOW si se quiere celebrar algo (en v1 no se usa).
- Signos de apertura obligatorios: ¿ ¡.
- Números: cifras siempre ("3 intentos", no "tres intentos"). Horas en formato 24 h ("9:14", "14:30"). Fechas largas en texto ("20 de noviembre") en correos; cortas ("20/11") en el scanner.
- Sin puntos suspensivos salvo en estados de progreso ("Enviando…"), con el carácter … único.
- Separador de miles: punto (2.000). Decimales: coma.
- Nada en mayúsculas sostenidas para "gritar". Si es urgente, el color y el icono lo dicen.
- Sin emojis en la interfaz. Iconos del sistema sí (✓ ✕ !).

## 9. Lenguaje inclusivo y neutro

- Español neutro: evitar regionalismos ("celular" es aceptable en Colombia y entendible en toda Hispanoamérica; evitar "móvil", "ordenador", "vale").
- Usar nombres de rol neutros cuando es posible: "persona", "participante", "acudiente", "coach". Donde no hay forma neutra natural, masculino genérico sin desdoblar ("los competidores").
- El scanner saluda con el **primer nombre** registrado tal como lo escribió la persona.

## 10. Accesibilidad

### Contraste y tamaño
- Contraste mínimo AA (4,5:1 en texto, 3:1 en texto grande e iconos). Texto blanco sobre verde `#16A34A`, rojo `#E0323B` y ámbar (`#D97706`, no el lima) cumple; el lima `#C8F560` **solo** como acento sobre texto oscuro.
- Título del scanner: ≥ 32 px. Cuerpo: ≥ 20 px. Botones: altura ≥ 48 px, texto ≥ 18 px.
- Modo exterior (alto contraste): fondo pleno, sin gradientes, texto negro sobre verde claro / blanco sobre rojo oscuro. Se activa a mano o por sensor de luz.

### No depender solo del color
Cada decisión tiene **cuatro señales redundantes**:

| Decisión | Color | Icono | Sonido | Vibración |
|---|---|---|---|---|
| ALLOW | Verde | ✓ grande, arriba a la izquierda | Bip corto agudo (100 ms) | 1 pulso corto |
| DENY | Rojo | ✕ grande | Bop grave doble (2 × 150 ms) | 2 pulsos |
| ALERT | Ámbar | ! grande | Alarma corta (3 tonos ascendentes) | 3 pulsos largos |

Además, el título ya dice la decisión en texto. Una persona daltónica lo ve por el icono y el título; en ambiente ruidoso lo siente por la vibración; con el celular en el bolsillo lo oye.

### Lectura y uso
- Modo una mano: botones principales en el tercio inferior.
- Botones grandes para guantes táctiles: ≥ 48 × 48 px y separación ≥ 8 px.
- Sin gestos ocultos: todo se puede hacer con toques simples.
- Textos alternativos en iconos de zonas (pictogramas) y en la foto ("Foto de Juan Pérez").
- Lectores de pantalla: la decisión se anuncia como `aria-live="assertive"` con título + cuerpo.
- Sin parpadeos: las animaciones duran ≤ 300 ms y respetan `prefers-reduced-motion`.
- Formulario: etiquetas visibles siempre (no solo placeholder), errores junto al campo y en un resumen arriba, foco al primer error.
- Tiempo: ningún mensaje importante desaparece solo salvo ALLOW (3 s); DENY y ALERT se quedan hasta el siguiente escaneo o toque.

## 11. Checklist antes de aprobar un texto nuevo

- [ ] ¿Dice qué pasó, por qué y qué hacer?
- [ ] ¿Cabe en 2 líneas en un celular de 6"?
- [ ] ¿Usa palabras del glosario (humano) y ninguna de la columna técnica?
- [ ] ¿Está en tuteo y sentence case?
- [ ] ¿Culpa a alguien? Si sí, reescribir.
- [ ] ¿Tiene icono y, si es decisión, sonido y vibración?
- [ ] ¿Se llama igual a lo mismo en scanner, panel y formulario?
- [ ] ¿Está en `messages.es.ts` con su código?

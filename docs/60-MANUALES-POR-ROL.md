# 60 · Manuales por rol — Tatami Pass

> Coherente con `00-DECISIONES.md` v1.0 §6. Escrito para personas que no son técnicas. Cada manual se puede imprimir por separado y entregar a quien tenga ese rol.

Antes de empezar, dos ideas que aplican a todos:

- **Tatami Pass funciona aunque no haya internet, ni Wi-Fi, ni luz.** Si algo se cae, tu trabajo sigue igual.
- **Si tienes duda, llama al supervisor.** Nadie te va a regañar por preguntar. Sí hay problema si dejas pasar a alguien que no debía.
- **El panel del host** se abre en el navegador, desde cualquier equipo de la Wi-Fi de staff: `http://<ip-del-host>:8787/admin` (o `https://tatami-host.local/admin` si el técnico configuró el certificado). Entras con tu usuario y contraseña; solo ves las páginas de tu rol. En el equipo de respaldo el panel abre igual, pero en modo consulta.

---

## 1. Administrador del evento

### Qué haces
Configuras el evento completo: fechas, zonas, roles de acceso, cupos, categorías de edad y claves. Eres la única persona que puede cambiar la configuración durante el evento. Ves todo.

### Qué necesitas
- Usuario con rol Administrador en la nube y en el host.
- La passphrase de la clave de firma y la de los discos (compartida con el Coordinador en sobre sellado).
- Un portátil propio para el panel. Nunca uses el host directamente.

### Antes del evento
1. Crea el evento en la nube: nombre, fechas, zona horaria.
2. Revisa las zonas y los roles de acceso. Ajusta cupos y colores. Si necesitas un rol nuevo (por ejemplo "Voluntario"), créalo desde Evento › Roles › Nuevo rol. No hace falta programar nada.
3. Revisa las categorías de edad. Las de ITF ya vienen por defecto.
3b. Revisa el **diseño de la credencial** (Panel › Impresión › Diseño de la credencial): sube los logos definitivos (ITF, federación, Alcaldía, Secretaría, patrocinadores), comprueba textos y fechas en la vista previa y decide con el Coordinador qué datos personales se imprimen (documento, EPS, contacto de emergencia). Guarda y exporta la plantilla como copia. Detalle en [33-DISENO-CREDENCIAL.md](./33-DISENO-CREDENCIAL.md).
4. Publica el aviso de privacidad en el formulario (está en `40 §6.6`; cambia los datos del comité).
5. Crea los usuarios: un Coordinador, Operadores de impresión, Supervisores, Auditor. Cada persona con su propio usuario. **Nunca cuentas compartidas.**
6. Genera la clave de firma del evento con el técnico (`tatami keys generate`). Anota la huella en el acta. Guarda la passphrase en tu gestor de contraseñas y en el sobre sellado.
7. Participa en el simulacro de T-7. Firma el checklist de `40 §9`.

### Durante el evento
- Mira el panel cada hora: **Puertas en vivo** (scanners conectados, pendientes de enviar, alertas) y **Sistema** (copia de seguridad reciente, segundo destino USB, equipo de respaldo replicando, nube).
- Si alguien pide subir un cupo o abrir una zona a un rol, decides tú. Todo cambio queda registrado con tu nombre.
- Si hay una alerta de fraude grave, el supervisor te avisa. Tú decides si se desactiva un dispositivo.

### Después del evento
1. Revisa los exportes del Auditor.
2. Desactiva los usuarios de Control, Supervisor y Operador.
3. Destruye la clave privada (con el técnico). Guarda la pública.
4. A los 90 días, confirma que la purga de datos se ejecutó.

### Paso a paso: cambiar un logo o un texto de la credencial
1. Panel › **Impresión** › pestaña **Diseño de la credencial**.
2. **Logos y archivos**: elige el archivo (PNG, JPG o SVG, hasta 1 MB), ponle un id corto (`logo-liga`) y súbelo; luego añádelo al pie del anverso, al del reverso o a patrocinadores con el desplegable "Añadir logo subido…". Para reemplazar uno de ejemplo, usa su mismo id (`logo-itf`, `logo-alcaldia`…).
3. **Textos de cabecera** y **Reverso** para títulos, fecha (vacío = automática) y las viñetas de "Información importante".
4. Mira la vista previa (se actualiza sola) y pulsa **Guardar diseño**. Los lotes nuevos salen con el cambio; los PDF ya descargados no.
5. Si algo quedó mal, **Restablecer diseño del piloto** vuelve al de referencia.

### Paso a paso: cambiar un cupo
1. Panel › **Evento y roles** › tabla "Roles de acceso" › columna **Cupo** del rol (marca "sin límite" si no quieres tope).
2. Escribe el nuevo número y pulsa **Guardar cambios**. Si el cupo queda por debajo de lo ya emitido, el panel te lo avisa antes de guardar.
3. Si hay lista de espera, el Coordinador verá a quién aprobar.

### Paso a paso: crear un rol nuevo
1. Panel › **Evento y roles** › **Nuevo rol**.
2. Código corto (máximo 6 letras mayúsculas), nombre, color, zonas, cupo, si requiere foto, si admite credencial digital y en qué zonas aplica anti-passback.
3. **Guardar cambios**. El archivo `event.config.json` se actualiza y en menos de un minuto los scanners lo reconocen.
4. Consigue lanyards de ese color.

### Si algo sale mal
- **El host no responde:** llama al técnico. Él promueve el equipo de respaldo (su panel › Sistema › **Convertir este equipo en el principal**, o `npm run promote -w apps/host`). Las puertas siguen funcionando.
- **Sospechas que la clave privada se filtró:** sigue `40 §5.5`. Primer paso: marca la clave como comprometida en Panel › Claves. Las puertas pasan a revisar foto obligatoriamente, no se detienen.
- **Un cambio de configuración salió mal:** Panel › Auditoría › filtra "Configuración guardada": el registro guarda la versión anterior; vuelve a poner el valor en Evento y roles. No edites el archivo a mano durante el evento.

### Qué NO debes hacer
- No compartas tu contraseña ni la passphrase por chat o correo.
- No cambies el ID del evento ni las fechas después de emitir credenciales.
- No uses el host como computador de trabajo.
- No borres usuarios durante el evento: desactívalos.

---

## 2. Coordinador de acreditación

### Qué haces
Apruebas inscripciones, resuelves duplicados, emites y re-emites credenciales, revocas las que ya no valen. Eres quien atiende los problemas de credenciales en la mesa de acreditación.

### Qué necesitas
- Usuario Coordinador en nube y host.
- Portátil con el panel, en la mesa de acreditación.
- Un scanner enrolado como "Mesa de acreditación" para registrar entregas.
- Acceso a la impresora (con el Operador).

### Antes del evento
1. Entra al **panel de la nube** (`/panel`, con tu correo y contraseña; la invitación te llega por correo y vence en 7 días). Revisa **Inscripciones** a diario: el filtro arranca en "Validadas (pendientes)". Abre la ficha, revisa foto, edad, categoría y consentimiento del acudiente; **Aprobar** o **Rechazar** escribiendo el motivo (la persona lo recibe por correo). "Aprobar todas las validadas" sirve cuando ya revisaste la lista.
2. Si un dato está mal (nombre, documento, fecha, club, categoría, foto), corrígelo en la ficha › **Editar datos**. Queda en el registro de auditoría con tu nombre. Puedes agregar o quitar acompañantes dentro del límite.
3. Importa SportData con el Administrador (Panel › **Importar SportData**): sube el archivo, confirma el mapeo de columnas y revisa el resumen (creados / actualizados / omitidos). Si hay dudas, reimporta: no se duplica.
4. Resuelve **Duplicados**: personas con el mismo documento, o mismo nombre y fecha de nacimiento con el club escrito distinto. **Fusionar** conserva una y completa sus datos con la otra; "Son personas distintas" cierra el aviso.
5. Revisa los menores: la ficha dice "Menor de edad. Acudiente … autorizó". Si falta, rechaza con motivo "Falta autorización del acudiente" para que el club corrija.
6. Crea los clubes e invita a sus inscriptores (Panel › **Clubes e inscriptores**): cada inscriptor solo ve y edita lo de su club, hasta la fecha de cierre que fijes en **Configuración del evento**.
7. A T-2, trae al host todo lo aprobado: panel del host › **Nube** › **Ver qué hay por traer** y luego **Traer ahora**. Cada inscripción aprobada llega con su credencial ya emitida y aparece en **Inscripciones** como pendiente de imprimir. Desde ahí pulsa **Crear lote** y pide al Operador que lo imprima.
8. Arma los paquetes por club con el Operador.

### Durante el evento
- Entregas credenciales a las delegaciones: pide documento del coach, escanea cada credencial con el scanner de la mesa y marca "Entregada".
- Re-emites credenciales perdidas o con error.
- Revocas cuando el supervisor te lo pide por una alerta de fraude.
- Atiendes solicitudes de datos personales (ver `40 §6.5`).

### Después del evento
1. Exporta el reporte de credenciales emitidas, re-emitidas y revocadas (host) y, si lo necesitas, el CSV/JSON de aprobados (Panel › **Exportar**). Contienen datos personales: guárdalos cifrados.
2. Responde solicitudes de datos que lleguen al correo `datos@` hasta T+90.

### Paso a paso: re-emitir una credencial perdida
1. Pide el documento de identidad. Compáralo con la foto (o el documento) en la ficha del panel.
2. Panel › **Credenciales** › busca por nombre, ID corto, club o documento › toca la fila.
3. Clic en **Re-emitir**. Escribe el motivo (perdida / dañada / error de datos / cambio de zona).
4. Se genera una versión nueva. La anterior queda **anulada automáticamente** y los scanners la rechazan en menos de un minuto.
5. En la misma ficha, **Ver / imprimir PDF** (o pide al Operador que la meta en el siguiente lote). Entrégala y pulsa **Marcar entregada**.

### Paso a paso: anular por fraude
1. El supervisor te da el ID corto y el motivo.
2. Panel › **Credenciales** › busca › abre la ficha › **Anular** › motivo "Uso fraudulento" › confirma.
3. Si el titular legítimo está identificado con documento, re-emite para él.
4. Si la alerta de duplicado sigue abierta, Panel › **Alertas** › **Resolver** con una nota de lo que se decidió (si el supervisor no lo hizo).

### Paso a paso: liberar un cupo de la lista de espera
1. Alguien rechazado o un cupo subido en Panel › **Cupos** deja un lugar libre. Panel › **Lista de espera**: la gente aparece por rol y categoría, en orden de llegada, con cuántos cupos quedan.
2. Pulsa **Liberar un cupo → avisar al primero**. La persona recibe un correo con un enlace que vale 48 horas; al abrirlo su inscripción pasa a "Validada (pendiente)" y la apruebas como a cualquiera.
3. Si no confirma a tiempo, el sistema la marca "Oferta vencida" y avisa al siguiente solo. Si te confirma por teléfono, usa **Pasar a pendiente**.
4. Si no dejó correo, "Liberar" la pasa directo a pendiente y te lo dice.

### Si algo sale mal
- **No hay internet y necesitas emitir una credencial nueva (prensa, staff de última hora, un acompañante):** Panel › **Inscripciones** › **Emitir en sitio**: nombre, apellido, rol, documento (opcional, evita duplicados), fecha de nacimiento si es competidor (la categoría se calcula sola; si es menor pide acudiente). La credencial sale firmada por el host y se imprime desde la ficha. Queda en la auditoría con tu nombre y la nota que escribas.
- **Dos personas tienen la misma credencial (una es copia):** la que coincide con el documento se queda. Revoca y re-emite a esa persona. La otra credencial se retiene.
- **Una persona dice que su edad está mal:** verifica el documento. Corrige la fecha de nacimiento en la nube (Panel › ficha › Editar datos) y vuelve a **Traer ahora**; el nombre, club y categoría se actualizan sin re-emitir. Si la inscripción se hizo en sitio, re-emite con los datos correctos. Si cambia de categoría, avisa a quien lleva las llaves de competencia (SportData): Tatami Pass **no** cambia resultados ni llaves.

### Qué NO debes hacer
- No apruebes inscripciones sin consentimiento de acudiente para menores.
- No emitas credenciales "de favor". La emisión en sitio es para quien sí debe entrar y no alcanzó a inscribirse; todo queda en el registro con tu nombre y el motivo.
- No envíes listas de participantes por WhatsApp ni correo sin cifrar.
- No marques "Entregada" una credencial que no entregaste en mano.

---

## 3. Operador de impresión

### Qué haces
Imprimes las credenciales por lotes, las cortas, les pegas el holograma, las armas con lanyard y marcas como entregadas las que salen de la mesa.

### Qué necesitas
- Usuario Operador en el host.
- Impresora láser color configurada, tóner de repuesto, guillotina, papel/PVC 100 × 150, hologramas, lanyards por color, portacredenciales.
- Un scanner de mesa compartido con el Coordinador.

### Antes del evento
1. Haz una impresión de prueba de 10 credenciales en T-14 **con el diseño ya aprobado** (Panel › Impresión › Diseño de la credencial; tú lo ves en solo lectura, lo cambia el Administrador o el Coordinador). Léelas con un scanner. Todas deben salir en verde. El reverso lleva código de barras: pruébalo también si la mesa usa lector de barras.
2. Verifica que el QR mida lo que dice la plantilla (30 mm por defecto) y no esté borroso. Calidad alta, 600 dpi. Cada credencial son **dos páginas** (anverso y reverso): configura la impresora a doble cara con giro por el borde corto, o usa el PDF "ambos lados en una hoja" (`?layout=duplex`) si la impresora no tiene dúplex.
3. A T-2, imprime en este orden: STAFF, JUR, MED, COMP (por club), COACH, VIP, SPON, PRESS, GEN de preventa.
4. Corta, pega holograma sobre el ID corto (todos los roles menos GEN), arma con lanyard del color del rol.
5. Guarda por club en cajas etiquetadas.

### Durante el evento
- Imprimes re-emisiones individuales que te pide el Coordinador.
- Marcas "Entregada" cuando sale de la mesa (escaneando).

### Después del evento
- Devuelve el material sobrante. Las credenciales impresas que no se entregaron se destruyen con acta (tienen nombre y foto).

### Paso a paso: imprimir un lote
1. Panel › **Impresión** › Nuevo lote.
2. Filtra: rol, club y estado **Emitida** (= todavía sin imprimir). El panel te dice cuántas entrarían. **Crear lote**.
3. En la lista de lotes, **Vista previa** muestra quién va en el lote; **Descargar PDF** genera el archivo (500 credenciales tardan menos de un minuto).
4. Abre el PDF, imprime en la impresora de credenciales. Revisa la primera hoja antes de dejar correr el resto.
5. Cuando termine, **Marcar como impreso**. Cuando entregues el paquete al club, **Marcar entregado** (o credencial por credencial desde su ficha).
6. Corta y arma.

### Paso a paso: marcar como entregada
1. Abre el scanner de mesa › modo **Entrega**.
2. Escanea la credencial. Verás el nombre y la foto.
3. Compara con la persona (o con el documento del coach que recoge por su club).
4. Toca **Entregada**.

### Si algo sale mal
- **El PDF sale con credenciales en blanco o sin foto:** la persona no tiene foto cargada. Avisa al Coordinador; imprime el resto.
- **Un campo sale con "—" (delegación, contacto de emergencia, EPS):** la persona no lo dio en la inscripción. El Coordinador lo completa en su ficha o se deja en blanco; no inventes datos.
- **El diseño salió con logos "placeholder" (recuadros con un nombre):** faltan los logos reales. Avisa al Administrador antes de imprimir el lote.
- **La impresora atasca:** saca el papel con cuidado, no reimprimas lo que ya salió. Marca a mano en el lote qué IDs faltaron y reimprímelos uno a uno: Panel › Impresión › "Imprimir una sola credencial" › ID corto › **Ver / imprimir PDF**.
- **Se fue la luz:** la impresora no está en el UPS. Para. Se retoma cuando vuelva.
- **Un QR impreso no se lee:** revisa que no esté estirado o cortado. Reimprime esa credencial. Si sigue, avisa al técnico.

### Qué NO debes hacer
- No imprimas credenciales que no estén en estado "Emitida". El sistema no te deja, y si pudieras, quedaría registrado.
- No dejes credenciales impresas sin vigilancia. Tienen nombre, foto y dan acceso.
- No marques como entregadas credenciales en bloque "para adelantar".
- No conectes la impresora al UPS.

---

## 4. Inscriptor de club / delegación

### Qué haces
Inscribes a los participantes de tu club en el formulario online y sigues su estado en el panel. Solo ves a tu club.

### Qué necesitas
- La invitación por correo del Coordinador (enlace "Crear contraseña", vence en 7 días). Con ella entras en `/panel`.
- Los datos de cada participante: nombre completo, documento, fecha de nacimiento, categoría, correo de contacto y foto tipo carné (fondo claro, de frente, sin gorra).
- Para menores: nombre y documento del padre, madre o acudiente, y su autorización.
- Nombre, documento (opcional) y parentesco de los acompañantes (máximo según el evento, normalmente 2 por participante).

### Antes del evento
1. Activa tu acceso con el enlace del correo. Si venció, pide al Coordinador que reenvíe la invitación.
2. En el panel pulsa **Inscribir a alguien**: abre el formulario público. Escribe el nombre de tu club tal como aparece en el panel para que la inscripción quede en tu lista.
3. Elige la categoría de edad. Si no corresponde a la fecha de nacimiento, el formulario te lo dirá y no te dejará seguir.
4. Para menores, marca la casilla de consentimiento y escribe nombre y documento del acudiente. Lee el aviso de privacidad y marca la casilla.
5. Guarda el código `N26-XXXXXX` de cada inscripción (también llega al correo que escribiste).
6. En Panel › **Inscripciones** sigues el estado: **Pendiente → Aprobada → Credencial emitida → Entregada**. **Cupos** te dice cuántos lugares quedan por rol y categoría.
7. Hasta la **fecha de cierre** puedes abrir cada ficha y corregir datos, cambiar la foto y agregar o quitar acompañantes. Después del cierre solo el Coordinador puede cambiar algo.
8. Inscribe a tus coaches (máximo según el evento, normalmente 3 por club).

### Durante el evento
- Recoge las credenciales de tu club en la mesa de acreditación con tu documento. Firma la entrega.
- Reparte las credenciales a tus participantes. Explícales que no se prestan.
- Los acompañantes reciben su credencial digital por el correo del participante: cada uno abre su enlace en su propio celular.

### Después del evento
- Nada. Tus datos se borran a los 90 días.

### Paso a paso: inscribir a una persona
1. Panel › **Inscribir a alguien** (o el enlace público del formulario).
2. Tipo de inscripción, nombre, apellido, fecha de nacimiento, documento, club, correo, categoría.
3. **Elegir foto**: en el celular abre la cámara; arrastra para encuadrar la cara y usa "Acercar". Se guarda recortada en cuadrado.
4. **Acompañantes**: "Agregar acompañante" (nombre obligatorio). El contador dice "1 de 2".
5. Si es menor, llena los datos del acudiente y marca la autorización.
6. Lee el aviso de privacidad y marca la casilla. **Enviar inscripción**. Verás "¡Inscripción recibida!" con el código.

### Si algo sale mal
- **"Cupo lleno":** marca "Quiero quedar en lista de espera". Si se abre un lugar, llega un correo con un enlace que vale 48 horas: ábrelo para confirmar.
- **"La edad no corresponde a la categoría":** revisa la fecha de nacimiento. Si está bien, la categoría está mal; elige la que indica el mensaje.
- **"Ya tenías una inscripción con estos datos; la actualizamos":** la persona ya estaba (por ejemplo importada de SportData). No pasa nada: se actualizó, no se duplicó.
- **No ves una inscripción en tu lista:** el club se escribió distinto. Pide al Coordinador que la corrija desde la ficha.
- **Olvidaste la contraseña:** pide al Coordinador "Enviar enlace de contraseña"; te llega un correo para crear una nueva.
- **Un participante perdió su credencial en el evento:** que vaya a la mesa de acreditación con su documento.

### Qué NO debes hacer
- No inscribas a nadie sin su autorización (o la de su acudiente).
- No uses fotos de redes sociales con filtros o recortadas.
- No compartas tu cuenta con otro club.
- No inscribas a la misma persona dos veces "por si acaso".

---

## 5. Control de entradas (portero con scanner)

Este es el manual más importante. Léelo completo antes de tu turno.

### Qué haces
Estás en una puerta con un celular. Cada persona que quiere entrar te muestra su credencial. Tú la escaneas, miras la pantalla y la foto, y dejas pasar o no según lo que dice la app. Si la app dice que no, no entra. Si hay duda, llamas al supervisor.

### Qué necesitas
- El scanner (celular) de tu puerta, cargado, con power bank.
- Tu PIN de 6 dígitos (te lo da el supervisor; es solo tuyo).
- Saber en qué puerta y zona estás.
- La radio del scanner (píldora **Radio** arriba) y, como respaldo, el número del supervisor.
- El sobre sellado de modo degradado (solo se abre si el supervisor lo dice).

### Antes del turno
1. Toma el scanner etiquetado con tu puerta (por ejemplo "P4-TATAMI-IN").
2. Abre la app Tatami Pass (está en la pantalla de inicio; si la abres en el navegador, la app te muestra "Instala la app" con los pasos).
3. Escribe tu PIN.
4. Pantalla **Inicio de turno**: escribe **tu nombre** en "¿Quién controla esta puerta?". Debajo ves la **zona** y el **modo de la puerta** (Entrada / Salida / Entrada + Salida) ya marcados. Si no son los tuyos, llama al supervisor: **no los cambies tú** (cambiarlos pide PIN de supervisor). Toca **Empezar a escanear**.
5. Mira la parte de arriba de la pantalla: dice la **puerta**, la **zona** y el **modo**; y el puntito de conexión: verde "Conectado"; gris "Sin conexión · sigue escaneando". **Sin conexión también funciona.**
6. Haz un escaneo de prueba con la credencial del supervisor. Debe salir verde.

### Qué ves en la pantalla

La pantalla es grande y de un solo color. No hay que leer letra pequeña.

**Pantalla VERDE — puede entrar**
```
✓  Adelante, Juan
   [FOTO]  Juan Pérez
           (Competidor)  Academia Caucana de Taekwondo
           Entrada · Tatamis · 9:14
           TP-2026-00123-C · v1
   [ Siguiente · 3 ]
```
Suena un "bip" corto y vibra una vez. El nombre va grande; el rol va en una etiqueta con el color de su credencial. El botón **Siguiente** cuenta 3, 2, 1 y la pantalla vuelve sola a la cámara; tócalo si quieres ir más rápido.

**Pantalla ROJA — no puede entrar**
```
✕  No puede entrar
   Esta credencial ya entró a Tatamis a las 9:14 y no registró salida.
   Pide que salga por el punto de salida y vuelva a escanear, o llama al supervisor.
   [FOTO] Juan Pérez · (Competidor) · Entrada · Tatamis · 9:20
   [ Autorizar (supervisor) ]   [ Siguiente ]
```
Suena un "bop" grave y vibra dos veces. **No se cierra sola**: tienes que tocar **Siguiente** (o el supervisor toca **Autorizar**).

**Pantalla ÁMBAR — revisa con el supervisor**
```
!  Revisa con el supervisor
   Esta credencial se usó en otra puerta hace 1 minuto.
   Pide a la persona que espere a un lado y llama al supervisor.
```
Suena una alarma corta y vibra tres veces. Tampoco se cierra sola.

Si el scanner está en modo **Entrada + Salida**, antes de la pantalla de color aparece **¿Entra o sale?** con dos botones grandes: toca el que corresponda.

Siempre hay tres partes: **qué pasó**, **por qué**, y **qué hacer**. Haz lo que dice la tercera línea.

### Cómo escanear
1. Pide la credencial. Que la sostengan de frente, a unos 15 cm de la cámara.
2. La app lee sola, no hay botón. Si hay poca luz, toca la linterna 🔦 del visor; si la cámara abre la frontal, toca ⟳.
3. En menos de medio segundo sale la pantalla de color. Si la misma credencial sigue delante de la cámara no se vuelve a leer hasta pasados 2 segundos (el visor dice "Ya leído · espera 2 s").
4. **Mira la foto de la pantalla y mira a la persona.** Esto es obligatorio para competidores, jueces, VIP, staff. Si no es la misma persona, no entra, aunque esté en verde: toca **"No es la persona"** y llama al supervisor.
5. Dile "Adelante" y pasa al siguiente. La pantalla se limpia sola a los 3 segundos.

### Cómo comparar la foto
- Mira ojos, nariz, forma de la cara. El pelo cambia; la cara no.
- Si la persona tiene gorra o mascarilla, pídele que se la quite un momento.
- Si tienes duda, mira también la foto impresa en la credencial. Deben coincidir las tres: pantalla, credencial, persona.
- Si la credencial no tiene foto (público General), no hay que comparar.

### Qué hacer en cada motivo de rechazo

| Lo que dice la pantalla | Qué significa | Qué haces |
|---|---|---|
| **Esta credencial ya entró a [zona] a las [hora]** | Alguien ya entró con ese QR y no registró salida. | Pregunta si salió por otra puerta. Pídele que pase por el scanner de salida y vuelva. Si no hay scanner de salida o insiste, llama al supervisor. |
| **Esta credencial no vale para [zona]** | Su rol no tiene permiso en tu zona. | Dile a qué zonas puede entrar (aparece en pantalla). No entra. |
| **Esta credencial fue anulada** | El Coordinador la revocó (perdida, re-emitida, fraude). | No entra. Dile que vaya a la mesa de acreditación con su documento. |
| **Hay una credencial más nueva para esta persona** | Le re-emitieron una y te muestra la vieja. | No entra con esa. Que use la nueva o vaya a acreditación. |
| **Esta credencial no es de hoy** | Entrada de otro día o fuera de fechas. | No entra. Mesa de acreditación. |
| **Este código ya venció** | QR digital (celular) caducado. | Pídele que refresque la pantalla de su credencial digital. Si no tiene internet, que vaya a taquilla. |
| **Este código no es de Tatami Pass** | Escaneaste otra cosa (otro QR, un código de barras). | Pide la credencial correcta. |
| **No reconozco esta credencial** | El scanner no la tiene en su lista (muy nueva o error). | Ingreso manual con el ID corto si el supervisor lo autoriza; si no, acreditación. |
| **La firma no coincide** | QR falso o dañado. | No entra. Llama al supervisor. Retén la credencial si puedes sin conflicto. |
| **Revisa con el supervisor (ámbar)** | Posible copia en uso en dos puertas, o la clave fue marcada en revisión. | La persona espera a un lado. Supervisor verifica documento. |

### Cómo registrar una salida
Si tu scanner está en modo **Salida** (franja roja arriba: "← Salida · Tatamis"), escaneas igual y la pantalla dice "Salida registrada, Juan" en verde. En modo **Entrada + Salida** (franja negra "⇄"), la app te pregunta **¿Entra o sale?** en cada lectura. Si tu scanner es de entrada y alguien quiere salir, no hace falta escanear salvo que el supervisor lo indique para esa zona (en Tatamis y Calentamiento sí hay scanner de salida). El modo lo cambia el supervisor con su PIN.

### Cómo hacer un ingreso manual
Solo cuando el QR no se lee o la credencial no está en el sistema, y **con el supervisor de acuerdo**.
1. Toca **Ingreso manual (ID corto o nombre)** (debajo del visor).
2. Escribe el **ID corto** que está impreso grande bajo el QR (ejemplo `TP-2026-00123-C`; da igual mayúsculas o guiones). Mientras escribes, la app comprueba el último carácter: si sale rojo "El último carácter no coincide", revisa el número. Cuando sale "✓ ID correcto", aparece la persona con foto (o iniciales), rol, club y zonas. También puedes escribir el **apellido** y elegir de la lista.
3. Compara la foto.
4. Toca **Registrar ingreso con motivo** y elige el motivo: *QR no se lee* / *Credencial provisional* / *Autorizado por supervisor* / *Planilla (modo degradado)* / *Otro* (con texto). Puedes añadir un detalle.
5. Toca **Registrar ingreso**. La app aplica las mismas reglas que con el QR: si esa credencial no puede entrar, sale rojo igual (entonces, supervisor).
**Solo validar (sin motivo)** sirve para comprobar una credencial sin registrar motivo.
Cada ingreso manual queda registrado con tu nombre. Si haces muchos, el supervisor te preguntará por qué.

### Qué significa el contador de "Pendientes"
Arriba hay una pastilla **Pendientes: N**. Es la cantidad de registros que el celular todavía no ha enviado al computador central. Cuando hay Wi-Fi, está en 0 o baja rápido. Si no hay Wi-Fi, sube. **No importa.** Se envían solos cuando vuelva la conexión. Si la tocas, ves la bandeja: el estado del host (verde conectado / gris sin conexión, con la hora de la última sincronización), una explicación, la lista y **Reintentar ahora**. Tú no haces nada más; solo no apagues ni desenroles el scanner mientras haya pendientes.

### Si no hay red
Nada. Sigue escaneando igual. La app tiene toda la lista de credenciales adentro del celular. Lo único que no puede hacer sin red es saber si alguien entró por **otra** puerta hace un momento; por eso, si tu zona es Tatamis, Jueces o Palco, compara la foto con más cuidado.

### Cómo usar la radio

La radio va dentro del scanner y funciona por la Wi-Fi del evento, sin internet. Se enciende sola cuando empiezas el turno; si el celular pregunta por el **micrófono**, toca **Permitir**.

1. Toca la píldora **Radio** arriba. Verás el canal (normalmente **Puertas**), quién está y un botón grande.
2. **Mantén pulsado** el botón grande, espera el tono corto, di quién eres y qué necesitas ("Puerta 3: fila de 40, necesito supervisor"), **suelta**. Mensajes cortos.
3. Si el botón dice **Ocupado · Puerta 1 está hablando**, alguien más habla: sigue pulsando y cuando termine te toca a ti (el micrófono se abre solo).
4. **Órdenes**: cuando el supervisor manda una ("Cerrar Puerta 3"), el scanner suena, vibra, la lee en voz alta y abre la radio. Léela y toca **Recibido**. El supervisor ve que la recibiste. Si no la entiendes, pulsa y pregunta.
5. **🚨 Emergencia**: si suena la sirena de dos tonos y vibra largo, para y escucha: alguien habla a todos. Solo mantén pulsado el botón rojo **Emergencia** si hay un riesgo real para personas; interrumpe a todo el evento.
6. "Sin host" o "Sin radio": sigue escaneando (eso no depende de la radio); si necesitas al supervisor, usa el número o la radio física.
7. Mantén la pantalla encendida y el scanner en primer plano: con la pantalla bloqueada el celular corta el micrófono.

### Cómo cambiar de zona o de modo
Tú no cambias ni la zona ni el modo. Si te mueven de puerta, el **supervisor** lo cambia en el scanner con su PIN (menú ⋯ › Cambiar zona o modo), o te da el scanner de esa puerta. Si ves que la zona o el modo de la pantalla no es el tuyo, avisa.

### Cómo terminar tu turno
1. Toca el menú ⋯ (arriba a la derecha) › **Terminar turno**.
2. Mira el resumen: entradas, salidas, negados (y por qué motivo), alertas, manuales y excepciones, pendientes. Si pendientes no es 0, llévalo cerca del router un minuto o avísale al supervisor.
3. Toca **Cerrar sesión**. Vuelve a la pantalla de PIN.
4. Entrega el scanner y el power bank al supervisor o al siguiente portero.
5. El siguiente pone **su** PIN y escribe su nombre en Inicio de turno. No le des el tuyo.

### Si la pantalla se bloquea
Si pasan 5 minutos sin tocar la pantalla, aparece **Pantalla bloqueada**. Escribe tu PIN y sigues en el mismo turno. También puedes bloquearla tú desde el menú ⋯ › **Bloquear pantalla** si tienes que soltar el scanner un momento.

### Guantes y sol
Menú ⋯ › **Modo guantes** hace los botones aún más grandes; **Alto contraste** quita los degradados y marca los bordes para leer con sol. Se recuerdan en el scanner.

### Si algo sale mal
- **El scanner se apagó / se quedó sin batería:** conecta el power bank. Mientras tanto, pide el scanner de reserva al supervisor. Si no hay, el supervisor te dirá si abres el sobre de modo degradado (lista impresa + planilla).
- **La cámara no abre:** cierra la app y ábrela de nuevo. Si sigue, reinicia el celular. Si sigue, scanner de reserva.
- **La pantalla dice "Tu turno terminó por tiempo":** pasaron 12 horas. Escribe tu PIN de nuevo y tu nombre en Inicio de turno.
- **Aparece "Hay una versión nueva · Actualizar":** tócalo entre dos personas; la app se recarga en un par de segundos sin perder nada.
- **Olvidaste el PIN:** el supervisor te asigna uno nuevo.
- **Una persona se pone agresiva:** no discutas. Di "Un momento, llamo al supervisor". No bloquees la fila: hazla esperar a un lado.
- **Se arma fila larga:** no aceleres saltándote la foto. Avisa al supervisor para que abra otro scanner o aparte a quien tiene problemas a la mesa de ayuda.

### Qué NO debes hacer
- No dejes pasar a nadie en rojo "porque dice que es amigo del organizador".
- No prestes tu PIN ni dejes el scanner solo.
- No tomes fotos ni pantallazos de la app.
- No cambies la zona ni el modo ni la configuración.
- No uses el celular para otra cosa (chat, redes, llamadas).
- No abras el sobre de modo degradado sin que el supervisor lo diga.

---

## 6. Supervisor de puerta

### Qué haces
Todo lo del Control de entradas, y además: autorizas excepciones, atiendes alertas de fraude, cambias la zona de un scanner, enrolas scanners, cubres varias puertas y decides cuándo se pasa a modo degradado.

### Qué necesitas
- Scanner propio enrolado con rol **Supervisor**: su PIN es tu PIN de supervisor y vale **sin red** en ese scanner. En los scanners de los porteros (rol Control) autorizas con tu **usuario y contraseña** del panel, que valida el host (hace falta conexión), salvo que el host publique tu PIN en el snapshot.
- Acceso al panel del host (desde el portátil de panel o el navegador de tu celular en la Wi-Fi de staff) para ver alertas.
- Radio.
- Tu credencial de STAFF para escaneos de prueba.
- Los PIN de los porteros de tu turno (los asignas tú desde el panel).

### Antes del evento
1. Asiste a la capacitación de T-7 y al simulacro.
2. Aprende a enrolar un scanner (abajo).
3. En T-1, enrola los scanners de tus puertas y verifica cobertura con el técnico.
4. Prepara los sobres de modo degradado de tus puertas.

### Durante el evento
- Recorre tus puertas cada 20–30 min. Mira que la pantalla de cada scanner diga la puerta correcta y el puntito esté verde.
- Coordina por **Tatami Radio** (panel › Radio o tu scanner): canal Puertas para hablar con las puertas, Supervisores para decidir sin ruido; manda órdenes del catálogo y revisa los acuses ("Puerta 3 recibió"). Si una puerta no acusa en 30 s, repite por radio física o ve. Protocolo completo: `50 §12`.
- Atiende alertas ámbar y rechazos conflictivos.
- Cambia turnos: el portero saliente termina turno; el entrante pone su PIN.
- Vigila que los porteros comparen la foto.
- Registra incidencias.

### Después del evento
- Recoge los scanners, verifica pendientes = 0 (bandeja Pendientes › Reintentar ahora si hace falta), termina el turno en cada uno (el resumen queda en el log como `shift_end`).
- Devuelve los sobres de modo degradado (abiertos o no) al Coordinador.
- Participa en la retrospectiva de T+1.

### Paso a paso: instalar el certificado y enrolar un scanner
Esto se hace **una vez por celular**, en T-1.
1. Conecta el celular a la Wi-Fi de staff (el técnico te da la contraseña; el SSID está oculto: hay que escribirlo).
2. Abre el navegador y entra a `http://10.10.0.2/ca.crt`. Descarga el archivo.
3. **Android:** Ajustes › Seguridad › Más ajustes › Instalar desde almacenamiento › Certificado de CA › elige `ca.crt` › acepta el aviso. **iPhone:** abre el archivo descargado › Ajustes › Perfil descargado › Instalar; luego Ajustes › General › Información › Ajustes de confianza de certificados › activa "Tatami Pass CA".
4. En el panel (portátil o tu celular): **Dispositivos** › "Enrolar un scanner". Escribe el nombre de la puerta (`Puerta 4 · Tatamis`), la zona y el rol del scanner (Control o Supervisor) › **Generar código**. Sale un QR con cuenta regresiva de 10 minutos (y el código en texto por si la cámara no lo lee).
5. En el celular, abre la cámara normal y escanea el QR, o escribe la dirección que aparece. Se abre Tatami Pass en **Enrolar este dispositivo** (host + código + PIN). También puedes tocar "Escanear código QR" dentro de la app.
6. Pon el PIN del portero de ese turno (6 dígitos, dos veces) y toca **Enrolar**.
7. Pantalla **Inicio de turno**: comprueba la zona y elige el **modo** (Entrada / Salida / Entrada + Salida). Escribe el nombre del portero y toca **Empezar a escanear**. La lista de credenciales baja en segundos (menú ⋯ muestra "N credenciales").
8. Instalar como app: la tarjeta **Instala la app** (en Enrolar o en menú ⋯ › Instalar la app) tiene los pasos: Android/Chrome ⋮ › "Instalar aplicación" (o el botón "Instalar ahora"); iPhone/Safari Compartir › "Añadir a pantalla de inicio". Ábrela siempre desde el icono.
9. Activa el modo kiosk (menú ⋯ › Modo kiosk: pantalla completa y sin apagado) y, si quieres, Android "Fijar pantalla" / iPhone "Acceso guiado".
10. Pega la etiqueta con el nombre.
El QR de enrolamiento vence en 10 minutos. Si venció, genera otro.

### Paso a paso: cambiar la zona o el modo de un scanner
1. En el scanner: menú ⋯ › **Cambiar zona o modo (supervisor)**.
2. Elige la **zona** y el **modo** (Entrada / Salida / Entrada + Salida: este último pregunta "¿Entra o sale?" en cada lectura). El botón dice qué vas a cambiar: "Cambiar zona T → W (pide supervisor)".
3. Autorización: escribe tu **PIN de supervisor** (si el scanner es tuyo o el host publicó tu PIN) o toca "Validar con el host" y pon usuario y contraseña.
4. Verifica que arriba de la pantalla aparezca lo nuevo; sale el aviso "Zona cambiada a W por <tu usuario>". Queda un evento `zone_change`/`mode_change` en el log con tu nombre.

### Paso a paso: autorizar una excepción
Ejemplo: "Ya entró a Tatamis" pero verificaste con documento que es la persona y nunca salió por scanner.
1. En el scanner del portero, en la pantalla roja o ámbar (no se cierran solas), toca **Autorizar (supervisor)**.
2. Escribe tu **PIN de supervisor** en el teclado; si ese scanner no tiene PIN de supervisor guardado, aparece "Validar con el host": usuario y contraseña (necesita conexión).
3. Elige motivo: *Salió sin escanear* / *Error de puerta* / *Autorización del Coordinador* / *Otro* (escribe al menos 5 caracteres). Puedes añadir un detalle.
4. Toca **Autorizar ingreso**. Sale verde "Ingreso manual autorizado por <tú>". Queda registrado como excepción con tu nombre (quién autorizó) y el del portero (quién operaba), y el motivo que anulaste.

### Paso a paso: atender una alerta de duplicado
1. Te suena el radio o ves la alerta en el panel: "Credencial TP-2026-00123-C escaneada en P1 y P4 con 1 min de diferencia".
2. Ve a la puerta más cercana. Pide el documento a la persona retenida.
3. Por radio, pide al otro portero que retenga a la otra persona si sigue ahí.
4. La que coincide con el documento es la legítima. Retén la otra credencial.
5. Llama al Coordinador: revoca y re-emite.
6. Panel › **Alertas** › la alerta de duplicado › **Resolver**: escribe qué pasó y qué se decidió. Queda en la auditoría.

### Paso a paso: dar una orden por la radio

1. Panel › **Radio** (o en tu scanner con rol Supervisor: píldora Radio). Arriba ves cada canal con quién está y quién habla.
2. **Hablar**: elige el canal (Puertas o Supervisores) y mantén pulsado el botón grande o la **barra espaciadora** del portátil; suelta al terminar. Si está Ocupado, sigue pulsando y te toca.
3. **Orden**: en "Enviar una orden" elige la orden del catálogo, la puerta si la pide (se sustituye en el texto y se lee en voz alta), el destino (un canal o una puerta concreta) y **Enviar orden**.
4. Mira los **acuses** en "Órdenes enviadas": "Puerta 3 recibió 10:42". Sin acuse en 30 s → repite por radio física o ve a la puerta.
5. **Emergencia**: mantén pulsado **🚨 Emergencia a todos** (interrumpe cualquier canal) o envía la orden **Evacuación**. Úsalo solo por riesgo real para personas. Al terminar, confirma por Puertas "Emergencia terminada, reanudar".
6. Historial del día (quién habló dónde y cuánto, órdenes y acuses) en la pestaña Historial; canales y catálogo en "Canales y órdenes" (solo Administrador).

### Paso a paso: pasar una puerta a modo degradado
Solo si **no hay ningún scanner funcional** para esa puerta (ni el de reserva).
1. Dile al portero que abra el sobre.
2. Explica en 1 minuto: buscar ID en la lista, comparar foto, anotar en planilla.
3. Avisa al técnico y al Coordinador.
4. Cuando haya scanner otra vez, captura la planilla (scanner › Ingreso manual › Captura de planilla) o entrégasela al Coordinador.

### Si algo sale mal
- **Un portero deja pasar en rojo:** corrígelo en privado. Si se repite, cámbialo de puesto y avisa al Coordinador.
- **Un scanner se perdió:** Panel › **Dispositivos** › el scanner › **Desactivar**. El host rechaza sus conexiones desde ese momento. Entrega el de reserva. Reporta al técnico y al Coordinador.
- **Un scanner tiene que cambiar de puerta:** Panel › Dispositivos › cambia la **zona** en la lista (o el portero lo hace desde el scanner con tu usuario y contraseña).
- **Muchos rechazos en una puerta:** Panel › **Alertas** › "Intentos denegados hoy" muestra rechazos y porcentaje por puerta, y los últimos casos con motivo. Si es "no vale para la zona", probablemente la gente se equivoca de puerta: pon señalización. Si es "ya había entrado", falta scanner de salida.
- **El panel no abre:** el host puede estar caído. Los scanners siguen. Llama al técnico.
- **No sabes qué decidir:** no dejes pasar. Llama al Coordinador. Es mejor que alguien espere 5 minutos a que entre quien no debía.

### Qué NO debes hacer
- No autorices excepciones sin ver el documento.
- No des tu PIN a un portero "para que se defienda".
- No cambies la zona de un scanner que no es de tu sector sin avisar.
- No abras modo degradado porque "no hay Wi-Fi": sin Wi-Fi el scanner funciona.

---

## 7. Auditor

### Qué haces
Revisas, sin poder cambiar nada, que todo lo que pasó quedó registrado y es coherente: quién entró, quién emitió, quién autorizó excepciones, qué incidencias hubo. Verificas que el registro no fue alterado y que los datos personales se borraron a tiempo.

### Qué necesitas
- Usuario Auditor (solo lectura) en host y nube.
- Acceso al panel › Auditoría y › Reportes.
- El acta del simulacro y el checklist de `40 §9`.

### Antes del evento
1. Revisa el checklist de auditoría previa (`40 §9`). Confirma que cada ítem tiene fecha y responsable.
2. Asiste al simulacro como observador. Anota tiempos.
3. Verifica que existen usuarios nominales y no hay cuentas compartidas (Panel › Usuarios).

### Durante el evento
- Al final de cada día: Panel › **Auditoría** › **Verificar cadena**. Debe decir "Registro íntegro hasta el número N".
- Panel › **Alertas** › pestaña Resueltas › tipo "Ingresos manuales": cada uno con motivo, puerta y quién autorizó. Si una puerta destaca, pregunta al supervisor. El cierre del día (Sistema › Reportes › CSV) trae el mismo detalle agrupado.
- Mira emisiones del día: ¿cada credencial emitida tiene inscripción aprobada?

### Después del evento (T+1)
1. **Verificar cadena** sobre la base final (Auditoría) y sobre la última copia de la USB (Sistema › Copias de seguridad › **Verificar** abre la copia y cuenta credenciales, escaneos y registros de auditoría). Ambos deben coincidir.
2. Exporta: Auditoría › **Exportar CSV / JSON** (anota la huella SHA-256 que muestra el panel junto al archivo) y Sistema › Reportes › **Descargar cierre del día** por cada día del evento (asistencia por zona, ingresos manuales por dispositivo, alertas, credenciales anuladas y re-emitidas, cambios de configuración).
3. Cruza: emitidas vs aprobadas; impresas vs entregadas; cupos vs emitidas por rol.
4. Escribe un informe corto (2 páginas): qué funcionó, anomalías, recomendaciones.
5. Verifica que se destruyeron las listas impresas y la clave privada (actas).

### T+90
- Verifica el log de purga: personas borradas, fotos borradas, backups eliminados. Firma el acta.

### Paso a paso: verificar la cadena de auditoría
1. Panel › **Auditoría** › **Verificar cadena**.
2. Espera (unos segundos). Resultado: "Registro íntegro hasta el número 48213" o "El registro fue alterado a partir del número N".
3. Si está alterado: no toques nada. Avisa al Administrador. Pide comparar con la copia del equipo de respaldo y la de USB (Sistema › Copias › Verificar; `40 §8.6`).

### Paso a paso: revisar ingresos manuales sospechosos
1. Panel › **Alertas** › tipo "Ingresos manuales" (abiertas y resueltas), o Sistema › Reportes › cierre del día › sección `ingreso_manual`.
2. Lo normal: 0–5 por puerta por día. Más de 15 en una puerta merece explicación.
3. Cada caso trae motivo, hora, puerta, quién autorizó e ID de credencial; la ficha de la credencial (Credenciales) muestra su historial completo de escaneos.
4. Pregunta al supervisor de esa puerta. Anota la respuesta en el informe.

### Si algo sale mal
- **No tienes acceso a algo:** es normal, eres solo lectura. Pide al Administrador el exporte, no una cuenta con más permisos.
- **Los números no cuadran:** revisa primero si hay escaneos pendientes de enviar (Panel › Puertas en vivo › "Pendientes de enviar", o Dispositivos). Espera a que llegue a 0 y repite.

### Qué NO debes hacer
- No pidas acceso de escritura ni SSH al host.
- No saques los exportes del portátil del comité sin cifrar.
- No "corrijas" datos tú mismo: reporta.

---

## 8. Participante y público

### Cómo inscribirte
- **Competidores:** tu club te inscribe. Pregunta a tu coach. Si ya estás en SportData, tu inscripción llega sola; igual revisa con tu club que tu foto esté cargada.
- **Público general:** entra al formulario del evento, llena tus datos, deja un correo, acepta el aviso de privacidad y envía. Tu credencial es **digital** (en tu celular): te llega por correo cuando la organización apruebe la inscripción.
- **Acompañantes:** el participante te inscribe junto con él. Entras a gradería con credencial digital; el enlace llega al correo del participante y cada acompañante lo abre en su propio celular.
- **Menores:** un adulto responsable debe autorizar la inscripción con su nombre y documento.

### Cómo recibes tu credencial
- **Competidores, coaches, jurado, VIP, prensa, staff:** credencial física. La recoge tu coach o tú en la mesa de acreditación con tu documento. Viene con lanyard del color de tu rol.
- **Público y acompañantes:** te llega un enlace por correo ("Abrir mi credencial digital"). Ábrelo el día del evento: muestra un código que cambia solo cada minuto y, debajo, tu ID corto por si el lector falla. Si dice "Credencial en preparación", vuelve más tarde: se activa cuando la organización emite las credenciales.
- **Consultar el estado:** con el código `N26-XXXXXX` del correo entra en `/estado`: verás recibida → validada → aprobada → credencial emitida → entregada, y por qué si no fue aprobada.

### Cómo cuidarla
- Llévala siempre colgada y visible.
- No la prestes. La credencial es tuya y tiene tu foto; en la puerta comparan tu cara con la pantalla.
- No la fotocopies ni le tomes foto para "compartirla". No funciona y queda registrado.
- No la dobles ni mojes: el código se daña.
- Si tienes credencial digital, no la compartas por chat ni mandes pantallazos: el código vence en un minuto y la persona no podrá entrar. Lleva el celular con batería y, si puedes, datos móviles (sin internet el código vence y tendrás que ir a taquilla con tu ID).
- Cuando salgas de Tatamis o Calentamiento, pasa por el scanner de salida. Si no, al volver te dirá "ya entró" y tendrás que esperar.

### Si la pierdes
1. Ve a la **mesa de acreditación** con tu documento de identidad.
2. Te emiten una nueva en pocos minutos. La anterior deja de servir de inmediato.
3. Si alguien encuentra la vieja, no podrá usarla.

### Si en la puerta te dicen que no puedes entrar
- La pantalla dice el motivo y qué hacer. Pregunta al portero.
- Si te dice que vayas a acreditación, ve. Ahí lo resuelven.
- No discutas con el portero: él solo hace lo que dice la app.

### Tus datos
Se usan solo para el campeonato y se borran a los 90 días. Puedes pedir verlos, corregirlos o borrarlos escribiendo al correo que aparece en el aviso de privacidad del formulario.

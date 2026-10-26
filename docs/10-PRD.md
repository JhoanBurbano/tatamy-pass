# 10 · PRD — Tatami Pass

> Documento de requisitos de producto. Deriva de `00-DECISIONES.md` (contrato) y no lo contradice. Donde este PRD detalla algo que las decisiones no cubren, lo marca como supuesto o como pregunta abierta (§13).
> Fecha: 2026-10-09 · Versión: 1.0 · Estado: listo para construcción · Dueño: Jhoan Burbano.

---

## 1. Resumen ejecutivo

Tatami Pass es el sistema de **acreditación y control de accesos** del **Campeonato Nacional de Taekwondo ITF 2026** (Colombia). Cubre desde la inscripción online de clubes y participantes hasta el escaneo en cada puerta del coliseo, pasando por la importación de competidores desde SportData, la emisión de credenciales con QR firmado, su impresión en lotes y la auditoría completa de quién entró, a dónde y cuándo.

El evento reúne entre **1.000 y 2.000 personas** durante **3 días** (supuesto de trabajo: 20 al 22 de noviembre de 2026) en uno o más pabellones con hasta **8 puertas** controladas. En coliseos colombianos no hay internet confiable, la energía puede caer y el personal de puerta no es técnico. Por eso el principio rector es **"funciona aunque no haya nada"**: el scanner valida solo, el host de sede funciona sin internet y la nube es prescindible el día del evento.

Alcance: **solo accesos**. No gestiona llaves, pesajes, puntajes ni pagos. Recibe la lista de competidores de SportData y la convierte en credenciales.

Resultado esperado: filas de ingreso que avanzan a más de 4 personas por minuto por puerta, cero credenciales falsas aceptadas, trazabilidad completa y un equipo de voluntarios que opera el sistema con 15 minutos de capacitación.

---

## 2. Problema y contexto

### 2.1 Cómo es hoy un día de evento

En los campeonatos nacionales de ITF en Colombia la acreditación se resuelve con escarapelas impresas en papelería, listas en Excel por delegación y voluntarios en las puertas que reconocen a la gente "de vista". Esto produce:

| Síntoma | Consecuencia |
|---|---|
| Filas de 30–40 min en la apertura del primer día | Competidores llegan tarde a pesaje o calentamiento; público molesto. |
| Escarapelas fotocopiadas o prestadas | Personas sin acreditar en zonas de tatami y calentamiento; riesgo de seguridad con menores. |
| Listas desactualizadas entre nube y puerta | Nadie sabe si "el de la lista" es el mismo que tiene la credencial; discusiones en la puerta. |
| Sin registro de entradas y salidas | Imposible saber cuánta gente hay en el pabellón ni reconstruir un incidente. |
| Internet caído o compartido con el público | Cualquier sistema "en la nube" se vuelve inútil a las 8:00 a. m. |
| Un corte de energía | Se pierde todo lo que no estaba en papel. |

### 2.2 Restricciones del entorno

- **Conectividad:** sin internet confiable. Un hotspot 4G con cobertura intermitente es lo máximo que se puede asumir. Debe existir una red Wi-Fi propia de staff, sin internet.
- **Energía:** cortes posibles. UPS para host, router y switch; scanners con power bank.
- **Personal:** control de entradas lo hacen voluntarios de clubes, no técnicos. Rotan por turnos.
- **Datos personales:** se manejan menores de edad y documentos de identidad → Ley 1581/2012 y Decreto 1377/2013.
- **Origen de datos:** SportData entrega competidores, pero no hay API garantizada; se asume exportación CSV/XLSX.
- **Hardware:** celulares Android/iOS personales del staff como scanners (PWA), un mini PC o portátil como host, impresora láser o de tarjetas para credenciales.

### 2.3 Por qué no basta "un QR"

Un QR impreso se fotocopia o se captura en pantalla. Si solo se valida la firma, la copia pasa. Tatami Pass trata el QR firmado como **una** de varias capas: foto en pantalla del scanner, anti-passback por zona, alerta de duplicado en tiempo real entre puertas, lista de revocación sincronizada, versión de credencial y, para público general, QR rotativo digital. Ver `00-DECISIONES.md` §4.

---

## 3. Objetivos y métricas de éxito

| # | Objetivo | Métrica | Meta | Cómo se mide |
|---|---|---|---|---|
| O1 | Ingreso rápido | Tiempo desde que la persona presenta el QR hasta pantalla verde/roja | **< 300 ms** validación local; **< 10 s** por persona en puerta incluyendo verificación de foto | Telemetría del scanner (`scan.duration_ms`) + cronometraje en simulacro |
| O2 | Funciona sin red | % de escaneos resueltos localmente sin consultar al host | **100 %** de los escaneos se resuelven en L1; 0 escaneos "pendientes de red" | Log de escaneos: campo `resolved_at=local` |
| O3 | Reconciliación fiable | Escaneos perdidos tras 1 h sin red | **0 perdidos**; reconciliación de 5.000 eventos **< 30 s** | `scripts/simulate.ts` + conteo host vs scanner |
| O4 | Cero fraude aceptado | Credenciales falsas, alteradas, revocadas o fotocopiadas aceptadas en simulacro | **0 aceptadas** sobre ≥ 50 intentos inyectados | Guion de simulacro (ver `20-RF-TEST.md`) |
| O5 | Pico absorbido | Personas ingresadas en 60 min en el pico de apertura | **≥ 1.500** con 6 puertas, sin fila > 10 min | Simulación de carga + conteo en el evento |
| O6 | Resiliencia a energía | Tiempo de recuperación del host tras corte total | **< 10 min** desde backup USB; 0 escaneos perdidos | Prueba de corte en simulacro |
| O7 | Operable por no técnicos | Tiempo de capacitación de un controlador de entradas | **≤ 15 min** y ≥ 90 % de tareas completadas sin ayuda en la prueba de usabilidad | Sesión de usabilidad con 5 voluntarios |
| O8 | Impresión a tiempo | Lote de 500 credenciales a PDF | **< 60 s** | Cronómetro en `apps/print` |
| O9 | Trazabilidad | % de ingresos con registro verificable (hash encadenado íntegro) | **100 %** | Verificación de cadena al cierre de cada día |
| O10 | Privacidad | Datos personales purgados tras retención | **100 %** a los 90 días post-evento | Job de purga + reporte |

---

## 4. Usuarios y roles del sistema

Los siete roles de `00-DECISIONES.md` §6, con sus "jobs to be done" (JTBD).

| Rol | Dónde opera | JTBD principal | Lo que necesita ver/hacer | Lo que NO puede hacer |
|---|---|---|---|---|
| **Administrador del evento** | Nube + host | "Dejar el evento configurado una vez y no tocarlo el día D." | Crear evento, roles de acceso, zonas, cupos, categorías de edad, claves de firma; crear usuarios; ver todo. | Escanear en puerta (no es su tarea; si lo hace, usa un rol de scanner). |
| **Coordinador de acreditación** | Nube + host | "Que cada persona que debe tener credencial la tenga, y nadie más." | Aprobar/rechazar inscripciones, resolver duplicados, importar SportData, emitir y re-emitir credenciales, revocar, resolver alertas de fraude. | Cambiar claves de firma, borrar logs, crear roles. |
| **Operador de impresión** | Host | "Imprimir todo el lote sin errores y saber qué ya entregué." | Generar PDF por lote/rol/club, reimprimir una credencial, marcar como entregada contra documento. | Emitir, aprobar, revocar. |
| **Inscriptor (club/delegación)** | Nube | "Inscribir a mis atletas y coaches en 10 minutos desde el celular." | Crear cuenta de club, inscribir participantes, ver estado de cada uno, corregir datos antes de aprobación, subir fotos. | Ver otros clubes, aprobar, emitir. |
| **Control de entradas** | Scanner | "Saber en un segundo si esta persona pasa o no, sin discutir." | Escanear, ver foto y veredicto, registrar salida, ingreso manual con motivo, llamar al supervisor. | Cambiar zona del dispositivo, autorizar excepciones, ver reportes. |
| **Supervisor de puerta** | Scanner + host | "Resolver las excepciones y detectar fraude sin parar la fila." | Todo lo de Control + autorizar excepciones (anti-passback, zona no permitida), ver alertas de fraude en vivo, cambiar de zona el dispositivo, ver estado de sync de los scanners de su sede. | Emitir o revocar credenciales (lo pide al coordinador). |
| **Auditor** | Host + nube | "Reconstruir qué pasó, cuándo y quién lo hizo, con pruebas." | Solo lectura: logs de auditoría, verificación de cadena de hash, reportes, exportación. | Cualquier escritura. |

**Usuario final no autenticado:** la **persona acreditada** (competidor, coach, público). No usa la app, pero el diseño de la credencial, los mensajes en pantalla y el QR digital existen para ella.

---

## 5. Tipos de entrada (roles de acceso)

Definidos en `event.config.json`, no en código. Valores por defecto de `00-DECISIONES.md` §5:

| Código | Nombre | Zonas por defecto | Foto | Credencial digital | Cupo | Notas |
|---|---|---|---|---|---|---|
| `GEN` | General | G | No | **Sí** | Por día | Única con QR rotativo. |
| `COMP` | Competidor | G, W, T, P | Sí | No | Por categoría | Importado de SportData; control de edad. |
| `COACH` | Coach/Entrenador | G, W, T | Sí | No | Máx. N por club | N configurable. |
| `JUR` | Jurado/Árbitro | G, W, T, J | Sí | No | Global | |
| `VIP` | VIP | G, V, H | Sí | No | Global | |
| `SPON` | Patrocinador | G, H, S | Sí | No | Global | |
| `PRESS` | Prensa | G, M, T* | Sí | No | Global | *T con restricción horaria/por supervisor. |
| `MED` | Médico | Todas | Sí | No | Global | |
| `STAFF` | Staff/Organización | Todas | Sí | No | Global | |

Zonas: G gradería, W calentamiento, T tatamis, P pesaje, J sala de jueces, V palco, H hospitalidad, S stands, M prensa.

Cada rol define: zonas, días válidos, cupo máximo, si requiere foto, color de credencial, si permite credencial digital y reglas de anti-passback por zona. El administrador puede crear roles nuevos sin tocar código (RF-061).

---

## 6. Alcance

### 6.1 Dentro de v1

- Inscripción online pública con cupos, control de edad y consentimiento de acudiente.
- Importación idempotente de competidores desde CSV/XLSX de SportData.
- Emisión de credenciales con QR firmado Ed25519, ID corto con dígito verificador, versión y revocación.
- Diseño de credencial 100 × 150 mm por rol e impresión en lotes PDF.
- Scanner PWA offline-first con validación local, foto en pantalla, anti-passback, alertas de duplicado y sync.
- Host por sede (Fastify + SQLite) con panel admin, sync con scanners, standby en caliente y sync con nube.
- Roles, permisos, PIN, enrolamiento de dispositivos por QR.
- Auditoría con log encadenado por hash, reportes y exportación.
- Backups cada 5 min a USB cifrado, modo degradado documentado.
- Credencial digital con QR rotativo solo para `GEN`.
- Simulacro obligatorio 7 días antes.

### 6.2 Fuera de alcance v1 (de `00-DECISIONES.md` §13)

Cobros y pagos de inscripción (solo marca "pagado" manual o por import), llaves y resultados, control de aforo por sensores, reconocimiento facial, app nativa, multi-idioma, integración por API con SportData (salvo que la federación la confirme, §13).

---

## 7. Requisitos funcionales

Convención: cada RF tiene un ID estable, prioridad (**M** must / **S** should / **C** could) y un criterio de aceptación (CA) en una línea. Los CA son la base de la matriz de trazabilidad en `20-RF-TEST.md`.

### 7.1 Inscripción online con cupos y edad (`apps/registration`)

| ID | Pr. | Requisito | Criterio de aceptación |
|---|---|---|---|
| RF-001 | M | El sistema publica un formulario de inscripción por evento en una URL pública, usable desde celular. | Un usuario sin cuenta abre `/nac2026/inscripcion` y completa una inscripción individual en < 5 min en un móvil de 360 px de ancho. |
| RF-002 | M | Un inscriptor puede crear una cuenta de club/delegación y asociar inscripciones a ese club. | Tras registrarse, el inscriptor solo ve y edita inscripciones de su club. |
| RF-003 | M | El formulario captura los datos mínimos por rol: nombre completo, fecha de nacimiento, documento, club, rol de acceso solicitado, categoría (si `COMP`), foto (si el rol lo exige), contacto. | Enviar sin un campo obligatorio devuelve error por campo, sin perder lo digitado. |
| RF-004 | M | El sistema calcula la edad a la fecha del primer día del evento y valida que corresponda a la categoría elegida (Infantil A 6–9, Infantil B 10–13, Juvenil 14–17, Adulto 18–35, Senior 36+, configurables). | Nacido 2010-05-01 con evento 2026-11-20 tiene 16 años: elegir "Adulto" bloquea con mensaje que indica la categoría correcta. |
| RF-005 | M | Los menores de 18 años requieren consentimiento del acudiente: checkbox, nombre y documento del acudiente. | Un menor sin los tres datos de consentimiento no puede enviar la inscripción. |
| RF-006 | M | El sistema controla cupos globales, por rol y por categoría; al alcanzarse, el formulario muestra "cupo lleno" y ofrece lista de espera. | Con cupo `COACH`=2 para un club, la tercera inscripción de coach queda en estado `lista_espera` y no cuenta para el cupo. |
| RF-007 | M | El cupo se reserva de forma atómica para evitar sobrecupo por envíos concurrentes. | 20 envíos simultáneos sobre un cupo de 10 producen exactamente 10 `inscrito` y 10 `lista_espera`. |
| RF-008 | M | Cada inscripción pasa por estados: `inscrito` → `validado` → `aprobado` → `emitido` → `impreso` → `entregado`, con `rechazado` y `lista_espera` como laterales. | Toda transición queda registrada con usuario, fecha y motivo; una transición no permitida (p. ej. `inscrito` → `impreso`) es rechazada. |
| RF-009 | M | El coordinador aprueba o rechaza inscripciones individualmente o en lote, con motivo en el rechazo. | Aprobar 50 inscripciones en lote cambia su estado y notifica por correo al inscriptor con el resultado. |
| RF-010 | S | El inscriptor puede editar datos de una inscripción mientras no esté `aprobado`; después, solo el coordinador. | Editar una inscripción `aprobado` como inscriptor devuelve 403 y muestra "Contacta a acreditación". |
| RF-011 | M | El formulario muestra la política de tratamiento de datos (Ley 1581/2012) y exige aceptación explícita antes de enviar. | Sin el checkbox de política, el botón enviar está deshabilitado y el envío directo por API es rechazado. |
| RF-012 | S | El sistema detecta posibles duplicados al inscribir (mismo documento o mismo nombre + fecha de nacimiento) y los muestra al coordinador para resolver. | Dos inscripciones con el mismo documento aparecen en la cola "Duplicados" y solo una puede ser aprobada. |
| RF-103 | M | Un participante puede inscribir acompañantes (nombre obligatorio; documento y parentesco opcionales) que reciben rol de acceso `ACOMP` (zona Gradería, credencial digital por defecto) ligados al participante (`companionOf`). | Inscribir a Ana con 2 acompañantes crea 3 inscripciones: Ana `COMP` y 2 `ACOMP` con `companionOf = id de Ana`, con el mismo estado que Ana. |
| RF-104 | M | La config del evento define `companions.perParticipant`, `companions.total` y `totalCapacity` (`null` = sin límite; por defecto 2 / sin límite / 2.000). El formulario muestra el contador "1 de 2" o "sin límite" y desactiva "Agregar acompañante" al llegar al límite con el mensaje humano. | Con `perParticipant = 2`, al agregar el segundo acompañante el botón se desactiva y muestra "Este participante ya tiene 2 acompañantes, el máximo permitido". |
| RF-105 | M | `POST /api/register` valida los acompañantes con `validateCompanions` de `packages/core` (por participante → cupo total → aforo total) y `GET /api/status` expone límites y usados. | Enviar 3 acompañantes por API con límite 2 devuelve 400 con `errors.companions`; con `companions.total` lleno devuelve "Se llenó el cupo de acompañantes"; con aforo lleno "El evento llegó a su aforo total". |
| RF-106 | S | El host expone `GET /credentials/:id/companions` con los acompañantes de una credencial, el conteo y los límites vigentes. | Para una credencial `COMP` del seed devuelve entre 0 y 2 acompañantes `ACOMP` con `companionOf` igual a su id. |

### 7.2 Importación SportData

| ID | Pr. | Requisito | Criterio de aceptación |
|---|---|---|---|
| RF-013 | M | El coordinador puede subir un CSV o XLSX exportado de SportData. | Un archivo de 2.000 filas se carga y previsualiza en < 10 s. |
| RF-014 | M | El sistema ofrece un mapeo de columnas guiado (nombre, apellido, fecha de nacimiento, club, categoría, sexo, documento) con detección automática por encabezado y posibilidad de guardar el mapeo. | Un archivo con encabezados en el orden de SportData se mapea automáticamente; el mapeo guardado se reutiliza en la siguiente importación. |
| RF-015 | M | La importación deduplica por `nombre + fecha de nacimiento + club` y crea o actualiza competidores con rol `COMP`. | Reimportar el mismo archivo no crea registros nuevos; cambiar la categoría de una fila y reimportar actualiza ese registro. |
| RF-016 | M | La importación es una transacción: o se aplica completa o no se aplica, con reporte de filas válidas, actualizadas, creadas y con error. | Un archivo con 3 filas con fecha inválida muestra las 3 con su motivo y no aplica nada hasta que el usuario corrige o las excluye. |
| RF-017 | M | Las filas importadas pasan por el mismo control de edad/categoría que la inscripción online. | Una fila con edad fuera de categoría se marca como `error: edad` y no se crea hasta corregir. |
| RF-018 | S | Los competidores importados que ya existían por inscripción online se vinculan en lugar de duplicarse. | Un competidor inscrito online por su club y luego importado de SportData queda como un solo registro con `origen: ambos`. |
| RF-019 | S | El importador funciona tanto en la nube como en el host (misma lógica en `packages/core`). | Importar en el host sin internet produce el mismo resultado que en la nube con el mismo archivo. |

### 7.3 Emisión y diseño de credencial con QR firmado

| ID | Pr. | Requisito | Criterio de aceptación |
|---|---|---|---|
| RF-020 | M | Al aprobar una inscripción, el coordinador puede emitir la credencial individual o en lote. | Emitir 500 credenciales en lote toma < 30 s y cada una queda en estado `emitido`. |
| RF-021 | M | Cada credencial recibe un ID público corto `TP-2026-NNNNN-K` con dígito verificador Luhn mod 36. | `TP-2026-00123-C` se valida; cambiar un dígito hace fallar el verificador. |
| RF-022 | M | El QR contiene un token firmado `TP1.<payload base64url>.<firma Ed25519 base64url>` con `{v, e, c, r, z, f, t, n, k}`. | Decodificar el QR de una credencial devuelve el payload exacto y la firma verifica con la clave pública del evento. |
| RF-023 | M | La clave privada de firma vive solo en la nube/host de emisión, cifrada con passphrase + variable de entorno; nunca se distribuye a scanners. | El paquete de datos del scanner no contiene material de clave privada (verificado por inspección automatizada del bundle de sync). |
| RF-024 | M | Re-emitir una credencial incrementa `n`; la versión anterior queda revocada automáticamente y aparece en la lista de revocación. | Tras re-emitir `00123` (n=1→2), escanear el QR con n=1 devuelve rojo "Credencial reemplazada". |
| RF-025 | M | El coordinador puede revocar una credencial con motivo; la revocación se propaga a host y scanners. | Revocar en el host llega a todos los scanners conectados en < 5 s; un scanner que reconecta la recibe en su primer sync. |
| RF-026 | M | La credencial física incluye: color e identificador de rol, nombre grande, rol en mayúsculas, foto, club/delegación, zonas como pictogramas, QR de 40 mm, ID corto, días válidos y espacio para holograma. | Una credencial generada contiene todos los elementos en posición según la plantilla y es legible a 50 cm. |
| RF-027 | M | El administrador puede ajustar la plantilla por rol (color, franja, logos, texto de pie) desde el panel, con vista previa. | Cambiar el color de `JUR` y guardar regenera la vista previa sin reiniciar el host. |
| RF-028 | M | Las claves de firma se gestionan por evento con identificador `k` y rotación: se puede emitir con `k2` mientras los scanners aceptan `k1` y `k2`. | Tras rotar a `k2`, los QR firmados con `k1` siguen validando hasta que el admin retira `k1` explícitamente. |
| RF-029 | S | El sistema impide emitir a inscripciones sin foto cuando el rol la exige. | Emitir un `COMP` sin foto devuelve error "Falta foto" y no genera credencial. |
| RF-030 | S | La emisión genera un evento en el log de auditoría con usuario, credencial, versión y clave usada. | Cada emisión aparece en el log con `type=credential.issued`. |

### 7.4 Impresión (`apps/print`, dentro del host)

| ID | Pr. | Requisito | Criterio de aceptación |
|---|---|---|---|
| RF-031 | M | El operador genera un PDF de credenciales 100 × 150 mm por lote, filtrable por rol, club, estado y rango de ID. | Un lote de 500 se genera en < 60 s en un PDF con 500 páginas, una credencial por página, con marcas de corte. |
| RF-032 | M | El operador puede reimprimir una credencial individual sin cambiar su versión. | Reimprimir `00123` genera el mismo QR (mismo `n`) y registra `credential.reprinted` en el log. |
| RF-033 | M | El operador marca credenciales como `impreso` y luego `entregado` (contra documento), individualmente o escaneando el QR en el puesto de entrega. | Escanear una credencial `impreso` en modo entrega la pasa a `entregado` con hora y operador. |
| RF-034 | M | El sistema evita imprimir dos veces el mismo lote por error: avisa si alguna credencial del filtro ya está `impreso`. | Repetir un lote muestra "Ya impresas: 500. ¿Reimprimir?" y exige confirmación. |
| RF-035 | S | El PDF soporta impresión por hoja (A4 con 2 credenciales y guías de corte) y por tarjeta individual (impresora de credenciales). | Ambas modalidades generan PDF cuyas dimensiones son exactas al milímetro en el visor. |
| RF-036 | S | El panel muestra el avance de entrega por club/rol para el puesto de acreditación. | El tablero muestra "COMP: 820 emitidas / 800 impresas / 640 entregadas" y se actualiza en vivo. |

### 7.5 Scanner offline-first (`apps/scanner`)

| ID | Pr. | Requisito | Criterio de aceptación |
|---|---|---|---|
| RF-037 | M | El scanner es una PWA instalable en Android e iOS que funciona sin red tras la primera carga. | Con modo avión activado, la app abre, muestra la cámara y valida un QR. |
| RF-038 | M | El scanner mantiene en IndexedDB una copia local completa de credenciales (ID, nombre, rol, zonas, foto miniatura, estado), reglas de acceso, lista de revocación y claves públicas. | Tras un sync completo, el scanner tiene 2.000 credenciales y puede validar cualquiera sin red. |
| RF-039 | M | La validación del QR verifica, en este orden: formato, firma Ed25519 con la clave `k`, vigencia de fechas, versión `n` vigente, no revocado, rol permitido en la zona del dispositivo, regla de anti-passback. | Cada verificación fallida produce un motivo distinto y específico en pantalla y en el log. |
| RF-040 | M | La validación completa tarda < 300 ms desde la lectura hasta la pantalla verde/roja. | p95 de `scan.duration_ms` < 300 ms en un Android de gama media (p. ej. 4 GB RAM). |
| RF-041 | M | La pantalla de resultado muestra la foto de la persona, nombre, rol, zona y veredicto en lenguaje humano con instrucción de qué hacer. | Un escaneo rechazado por anti-passback muestra "No puede entrar. Esta credencial ya entró a Tatamis a las 9:14. Pide que salga y vuelva a escanear, o llama al supervisor." |
| RF-042 | M | Sonido y vibración distintos para OK, NO y ALERTA. | Tres patrones distinguibles con el celular en el bolsillo; configurables en ajustes. |
| RF-043 | M | Cada escaneo se guarda localmente con `(device_id, seq)` monotónico, credencial, versión, zona, dirección (entrada/salida), resultado, motivo y timestamp, y se sube cuando hay red. | Tras 2 h sin red y 400 escaneos, al reconectar todos aparecen en el host sin duplicados. |
| RF-044 | M | El scanner opera en modo **entrada** o **salida** por zona, seleccionable por el supervisor; el controlador ve claramente el modo activo. | El modo se muestra en la cabecera con color distinto y se registra en cada escaneo. |
| RF-045 | M | El controlador puede registrar un **ingreso manual** por ID corto (con validación del dígito verificador) y motivo obligatorio. | Un ID con dígito verificador incorrecto no se acepta; un ingreso manual válido queda marcado `manual=true` con motivo. |
| RF-046 | M | Lectura de QR con `BarcodeDetector` y fallback automático a `@zxing/browser`. | En un iOS sin `BarcodeDetector`, la lectura funciona con el fallback sin configuración del usuario. |
| RF-047 | M | El scanner muestra su estado de sync (última sync, escaneos pendientes, conexión al host) de forma visible pero no intrusiva. | Con host inalcanzable, un indicador cambia a "Sin conexión · 37 pendientes" y la app sigue escaneando. |
| RF-048 | S | Modo una mano y alto contraste para exteriores, con botones ≥ 48 px. | Toda acción principal es alcanzable con el pulgar en un celular de 6,5"; contraste AA verificado. |
| RF-049 | S | Búsqueda local por nombre o ID corto para resolver casos sin QR legible. | Buscar "Juan Per" muestra coincidencias con foto en < 1 s sin red. |

### 7.6 Host por sede y sync (`apps/host`)

| ID | Pr. | Requisito | Criterio de aceptación |
|---|---|---|---|
| RF-050 | M | El host corre en un mini PC/portátil con Node 20 + Fastify + SQLite (WAL) y sirve API REST, WebSocket de sync y panel admin web; se despliega con Docker Compose o `node dist/server.js`. | `docker compose up` deja el host operativo en < 2 min; el panel abre en `https://host.tatamipass.co`. |
| RF-051 | M | El host es la fuente de verdad de la sede: contiene la base completa del evento y funciona sin internet. | Con el cable WAN desconectado, emisión local, impresión, sync de scanners y reportes funcionan. |
| RF-052 | M | Sync scanner ↔ host por WebSocket con fallback a polling cada 15 s; los escaneos son append-only, idempotentes por `(device_id, seq)`. | Reenviar el mismo lote de escaneos 3 veces deja exactamente un registro por `(device_id, seq)`. |
| RF-053 | M | Revocaciones y cambios de configuración se propagan a scanners con semántica LWW usando el reloj del host. | Dos cambios de zona del mismo dispositivo desde dos paneles quedan con el último según el reloj del host. |
| RF-054 | M | Un escaneo llega al host en < 2 s en LAN; la reconciliación de 5.000 eventos tras 1 h sin red tarda < 30 s. | Medido por `scripts/simulate.ts` con 8 dispositivos. |
| RF-055 | M | Sync host ↔ nube por HTTPS cuando hay internet, mismo protocolo; la nube caída no afecta la operación del host. | Apagar la nube durante 1 h no genera errores visibles en host ni scanners; al volver, todo se reconcilia. |
| RF-056 | M | Host standby: un segundo host replica en caliente y se promueve a primario con el comando `tatami promote`. | Tras apagar el primario, `tatami promote` en el standby lo deja aceptando scanners en < 60 s con todos los datos hasta el último sync. |
| RF-057 | M | Los scanners detectan la caída del host y se reconectan automáticamente al standby promovido (misma URL vía DNS/IP flotante o lista de hosts). | Sin intervención del controlador, el scanner reporta "Conectado" al standby en < 90 s después de la promoción. |
| RF-058 | M | El host actúa como servidor NTP de la LAN (chrony); los scanners toleran ±5 min de deriva en QR rotativos. | Un scanner con reloj desviado 4 min valida QR rotativos; con 6 min, los rechaza con motivo "Reloj desincronizado". |
| RF-059 | M | El host corre detrás de Caddy con HTTPS (CA interna o certificado Let's Encrypt para `host.tatamipass.co`). | La PWA accede a la cámara en Android e iOS sin advertencias de certificado tras instalar la CA raíz. |
| RF-060 | S | El panel del host muestra en vivo: dispositivos conectados, última sync por dispositivo, escaneos por puerta y alertas. | La tabla de dispositivos refleja desconexión de un scanner en < 30 s. |
| RF-107 | M | La nube expone `GET /api/export?since=<iso>` (header `x-tatami-key` = `TP_CLOUD_KEY`) con las inscripciones aprobadas creadas/actualizadas desde esa fecha, incluyendo acompañantes y un `cursor` para la siguiente llamada. | Sin header: 401. Con `since` igual al último cursor y sin cambios: `count = 0`. |
| RF-108 | M | El host actualiza desde la nube por botón (`POST /sync/cloud/pull`, admin/coordinador) y periódicamente cada `TP_CLOUD_INTERVAL_MIN` min (5 por defecto; 0 = solo manual), sin solapar ejecuciones; es idempotente por id de inscripción: crea personas y emite credenciales nuevas, actualiza nombre/club/categoría sin re-emitir y no duplica. | Nube con 2 inscripciones nuevas y 1 actualizada: primer pull `created = 2, updated = 1`; segundo pull inmediato `received = 0`. |
| RF-109 | M | `GET /sync/cloud/status` informa última actualización, conteos del último pull, si hubo conexión en el último intento, intervalo y próxima ejecución; sin internet el host sigue operando y muestra "sin conexión a la nube, se reintenta en N min". Sin `TP_CLOUD_URL`, el pull responde 409 con mensaje claro. | Con la nube caída, `pull` responde 503 y `status.online = false`; sin `TP_CLOUD_URL`, `pull` responde 409. |

### 7.7 Anti-passback y antifraude

| ID | Pr. | Requisito | Criterio de aceptación |
|---|---|---|---|
| RF-061 | M | Anti-passback por zona: una credencial que ya registró entrada a una zona no puede volver a entrar sin una salida registrada. | Dos escaneos de entrada seguidos a Tatamis con la misma credencial: el segundo es rojo con motivo y hora del primero. |
| RF-062 | M | El anti-passback funciona offline con el estado local del scanner y se refina con el estado del host al sincronizar. | Sin red, el mismo scanner bloquea la segunda entrada; con red, un scanner distinto en la misma zona también la bloquea. |
| RF-063 | M | Alerta de duplicado: el mismo QR escaneado en dos puertas distintas en < 2 min genera una alerta en ambos scanners y en el panel del supervisor. | El segundo scanner muestra "ALERTA: esta credencial se escaneó en Puerta 3 hace 40 s" y el panel registra la alerta. |
| RF-064 | M | Las reglas de anti-passback son configurables por zona y rol (activo/inactivo, tiempo de gracia). | Configurar gracia de 30 s en zona G permite un re-escaneo accidental dentro de 30 s sin rojo. |
| RF-065 | M | El supervisor puede autorizar una excepción (p. ej. forzar entrada pese a anti-passback) con PIN de supervisor y motivo; queda en el log. | Un controlador no ve el botón "Autorizar"; un supervisor sí, y el escaneo resultante queda `override_by=<usuario>`. |
| RF-066 | M | Un QR con firma alterada, payload alterado, evento distinto o clave desconocida se rechaza con motivo "Credencial no válida". | Modificar un carácter de la firma o del payload produce rojo; el log registra `reason=signature_invalid`. |
| RF-067 | M | Los QR de versiones anteriores de una credencial re-emitida se rechazan aunque la firma sea válida. | Escanear n=1 cuando la vigente es n=2 produce rojo "Credencial reemplazada". |
| RF-068 | M | El supervisor y el coordinador reciben un reporte de incidencias por puerta (rechazos por tipo, alertas de duplicado, ingresos manuales, overrides). | El reporte de "Puerta 2, día 1" lista cada incidencia con hora, credencial, controlador y resultado. |
| RF-069 | S | Un controlador puede marcar "foto no coincide" en un escaneo verde; eso genera incidencia y bloquea la credencial para revisión del supervisor. | Tras marcarla, el siguiente escaneo de esa credencial en cualquier puerta es rojo "En revisión". |

### 7.8 Roles y permisos

| ID | Pr. | Requisito | Criterio de aceptación |
|---|---|---|---|
| RF-070 | M | RBAC con los siete roles de sistema (§4) y permisos por acción; mínimo privilegio por defecto. | Cada endpoint de la API declara el permiso requerido; un usuario sin él recibe 403 (verificado por test de matriz rol × endpoint). |
| RF-071 | M | Autenticación en nube y host con usuario + contraseña hasheada con Argon2id. | La base no contiene contraseñas en claro ni hashes distintos de Argon2id. |
| RF-072 | M | Autenticación en scanner con PIN de 6 dígitos tras enrolamiento del dispositivo; 5 intentos fallidos bloquean el dispositivo 15 min y notifican al supervisor. | Al quinto PIN incorrecto, la app muestra bloqueo con cuenta regresiva y el panel muestra la alerta. |
| RF-073 | M | Las sesiones del scanner expiran a las 12 h; las de panel a las 8 h de inactividad. | Un scanner abierto 12 h 1 min pide PIN de nuevo sin perder escaneos pendientes. |
| RF-074 | M | El administrador puede crear roles de acceso nuevos (tipos de entrada) desde el panel, definiendo zonas, días, cupo, foto, color, credencial digital y anti-passback. | Crear el rol `VOL` (voluntario) y emitir una credencial con él no requiere reinicio ni cambio de código. |
| RF-075 | M | El inscriptor solo ve y modifica datos de su propio club. | Consultar `/api/inscripciones?club=otro` devuelve 403 o lista vacía. |
| RF-076 | S | El administrador puede desactivar usuarios y revocar sesiones activas. | Desactivar un usuario invalida su sesión en < 1 min en nube y host. |

### 7.9 Enrolamiento de dispositivos

| ID | Pr. | Requisito | Criterio de aceptación |
|---|---|---|---|
| RF-077 | M | El host genera un QR de enrolamiento con token único que caduca a los 10 min y bindea `device_id`, rol de sistema y zona. | Escanear el QR desde la PWA enrola el dispositivo con el rol y zona indicados; el token no se puede reutilizar. |
| RF-078 | M | Un token de enrolamiento expirado o ya usado se rechaza con mensaje claro. | Escanear un QR de 11 min muestra "Este código ya venció. Pide uno nuevo al supervisor." |
| RF-079 | M | El QR de enrolamiento incluye (o enlaza a) el certificado raíz de la CA interna y la guía de instalación para Android/iOS. | Un dispositivo nuevo completa enrolamiento + instalación de CA siguiendo solo la guía, sin soporte. |
| RF-080 | M | El supervisor puede cambiar la zona o el modo (entrada/salida) de un dispositivo enrolado desde el scanner o el panel. | Cambiar "Puerta 2 → Puerta 5" en el panel se refleja en el scanner en < 15 s. |
| RF-081 | M | El administrador o supervisor puede des-enrolar un dispositivo; el dispositivo deja de poder sincronizar y borra sus datos locales. | Tras des-enrolar, el scanner muestra "Dispositivo retirado" y su IndexedDB queda vacía. |
| RF-082 | S | Cada dispositivo tiene un nombre legible ("Puerta 3 · Tablet A") visible en panel y scanner. | El nombre aparece en la cabecera del scanner y en la tabla de dispositivos del host. |

### 7.10 Auditoría y reportes

| ID | Pr. | Requisito | Criterio de aceptación |
|---|---|---|---|
| RF-083 | M | Log de auditoría encadenado por hash: cada registro incluye el hash SHA-256 del anterior; cubre emisiones, revocaciones, cambios de config, logins, overrides, enrolamientos y escaneos. | Modificar o borrar un registro hace fallar la verificación de cadena desde ese punto. |
| RF-084 | M | El auditor puede verificar la integridad de la cadena desde el panel y por CLI, con reporte del primer registro corrupto. | `tatami audit verify` devuelve `OK` sobre una base íntegra y `BROKEN at seq=1234` sobre una alterada. |
| RF-085 | M | Reporte de ingresos por zona, por rol, por puerta y por franja horaria, en vivo y por día. | El reporte muestra "Tatamis: 312 dentro ahora, 1.040 ingresos acumulados hoy" y coincide con el conteo de escaneos. |
| RF-086 | M | Exportación de logs y reportes a CSV y JSON firmados (hash del archivo en el log). | Exportar el día 1 produce un archivo cuyo hash aparece en el log como `export.created`. |
| RF-087 | M | Trazabilidad por credencial: historial completo (inscripción, aprobación, emisiones, impresiones, entrega, escaneos, incidencias). | Buscar `TP-2026-00123-C` muestra su línea de tiempo completa ordenada. |
| RF-088 | S | Reporte de ocupación actual por zona (entradas − salidas) con alerta configurable al superar un umbral. | Al superar 500 en Gradería, el panel muestra alerta ámbar. |
| RF-089 | S | Reporte de consentimientos y datos de menores para evidencia Ley 1581. | El reporte lista cada menor con nombre del acudiente y fecha de consentimiento, exportable. |

### 7.11 Backups y modo degradado

| ID | Pr. | Requisito | Criterio de aceptación |
|---|---|---|---|
| RF-090 | M | Snapshot SQLite (`VACUUM INTO`) cada 5 min a USB cifrado (LUKS), con retención de 48 rotativos + 1 por hora. | Tras 6 h de operación el USB contiene 48 snapshots de 5 min y 6 horarios, ninguno corrupto (`PRAGMA integrity_check`). |
| RF-091 | M | Replicación continua al host standby y subida de snapshots a la nube cuando hay internet. | El standby tiene todos los escaneos hasta < 10 s del primario; la nube recibe el último snapshot horario. |
| RF-092 | M | Restauración desde backup USB documentada y ejecutable en < 10 min por el administrador con `tatami restore <archivo>`. | Partiendo de un host en blanco, restaurar y aceptar scanners toma < 10 min; los scanners re-sincronizan sus pendientes sin duplicados. |
| RF-093 | M | Modo degradado: el sistema genera e imprime la lista por rol (ID corto, nombre, foto miniatura) y la planilla de ingreso manual para cada puerta. | El PDF "Modo degradado · Puerta N" se genera en < 30 s e incluye todos los acreditados vigentes. |
| RF-094 | M | Los ingresos registrados en planilla de papel se pueden cargar después en el host como ingresos manuales con origen `planilla`. | Cargar 30 filas de planilla crea 30 escaneos `manual=true, source=planilla` sin alterar la cadena de hash previa. |
| RF-095 | M | Tras un corte de energía, el host arranca automáticamente y recupera la base en estado consistente (WAL). | Cortar la energía con escrituras en curso y reiniciar no deja la base corrupta ni pierde escaneos ya confirmados a los scanners. |
| RF-096 | S | El host alerta cuando la UPS entra en batería y cuando el USB de backup no está montado. | Desconectar el USB muestra alerta roja en el panel en < 1 min. |

### 7.12 Credencial digital rotativa (solo `GEN`)

| ID | Pr. | Requisito | Criterio de aceptación |
|---|---|---|---|
| RF-097 | M | Una credencial `GEN` puede entregarse como credencial digital: página web (o PWA) con QR que rota cada 60 s e incluye marca de tiempo firmada `exp`. | El QR cambia cada 60 s y dos capturas separadas por 61 s producen tokens distintos. |
| RF-098 | M | Un QR rotativo con `exp` vencido (tolerancia ±5 min) se rechaza con motivo "Código vencido, pide que actualice la pantalla". | Un pantallazo de hace 6 min produce rojo con ese motivo. |
| RF-099 | M | La credencial digital se vincula a un portador (correo o teléfono) y puede revocarse igual que una física. | Revocar la credencial digital hace que su siguiente QR, aunque fresco, sea rojo. |
| RF-100 | M | La credencial digital funciona sin internet en el celular del portador tras la primera carga (clave y token base en el dispositivo) durante la vigencia del día. | Con modo avión, la página sigue rotando el QR usando el reloj local. |
| RF-101 | S | Los roles distintos de `GEN` no pueden recibir credencial digital, aunque el admin lo intente. | El panel no ofrece la opción y la API responde 422 para `COMP`, `JUR`, etc. |
| RF-102 | S | El QR digital se muestra con brillo máximo sugerido y tamaño ≥ 60 % del ancho de pantalla para lectura rápida. | Lectura en < 1 s a 20 cm en condiciones de luz de gradería. |

**Total: 109 requisitos funcionales** (RF-001 a RF-109; RF-103 a RF-109 añadidos el 2026-10-13: acompañantes y actualización desde la nube).

---

## 8. Requisitos no funcionales

| ID | Categoría | Requisito | Criterio de aceptación |
|---|---|---|---|
| RNF-001 | Rendimiento | Validación offline en scanner < 300 ms de lectura a pantalla. | p95 < 300 ms en Android de gama media; medido en CI con dataset de 2.000 credenciales. |
| RNF-002 | Rendimiento | Pico de 1.500 personas en 60 min con 6 puertas (~4/min por puerta) con holgura ×10. | `scripts/simulate.ts` sostiene 40 escaneos/min por puerta × 8 puertas durante 60 min sin errores ni backlog > 100 eventos. |
| RNF-003 | Rendimiento | Sync de un escaneo al host < 2 s en LAN; reconciliación de 5.000 eventos < 30 s. | Medido en simulación y en simulacro. |
| RNF-004 | Rendimiento | Lote de 500 credenciales en PDF < 60 s en el host. | Cronometrado en el hardware real del host. |
| RNF-005 | Disponibilidad | El scanner opera sin host ni nube; el host opera sin nube; cada nivel sobrevive al siguiente. | Pruebas de desconexión por nivel sin pérdida de funcionalidad crítica. |
| RNF-006 | Disponibilidad | Promoción de standby < 60 s; recuperación desde backup < 10 min; RPO ≤ 5 min (backup) y ≈ 0 para escaneos (quedan en los scanners). | Verificado en simulacro. |
| RNF-007 | Seguridad | TLS 1.2+ en toda comunicación; disco del host cifrado (LUKS/FileVault). | Escaneo de configuración TLS sin protocolos inferiores; disco verificado con `lsblk`/`fdesetup`. |
| RNF-008 | Seguridad | Documento de identidad y fecha de nacimiento cifrados en reposo con AES-256-GCM, clave derivada por evento. | Un dump de la base no muestra esos campos en claro. |
| RNF-009 | Seguridad | Contraseñas con Argon2id; PIN de scanner con hash + salt por dispositivo; claves Ed25519 con rotación por evento. | Revisión de código + tests unitarios de `packages/core`. |
| RNF-010 | Seguridad | Log de auditoría inmutable y verificable (hash encadenado), exportable para auditoría externa. | RF-083/084. |
| RNF-011 | Seguridad | `npm audit` sin vulnerabilidades altas o críticas en CI; SBOM generado; imágenes Docker sin root. | Pipeline falla con vulnerabilidad alta; `USER node` en Dockerfile. |
| RNF-012 | Seguridad | Alineación a controles del Anexo A de ISO/IEC 27001:2022 documentada en `40-SEGURIDAD-ISO27001.md`. | Cada control aplicable tiene evidencia enlazada. |
| RNF-013 | Privacidad | Cumplimiento Ley 1581/2012 y Decreto 1377/2013: finalidad declarada, consentimiento, menores con acudiente, derecho de supresión. | Política publicada; flujo de supresión a solicitud ejecutable por el coordinador en < 24 h. |
| RNF-014 | Privacidad | Retención de datos personales 90 días post-evento y purga automática con reporte. | Job de purga programado; ejecución en entorno de prueba deja solo datos agregados. |
| RNF-015 | Privacidad | Las fotos miniatura en los scanners se borran al des-enrolar o al expirar el evento + 7 días. | IndexedDB vacía tras cualquiera de los dos eventos. |
| RNF-016 | Accesibilidad | Contraste AA, botones ≥ 48 px, modo una mano, uso con guantes táctiles, alto contraste exterior. | Auditoría con Lighthouse/axe sin errores de contraste; prueba física con guantes. |
| RNF-017 | Usabilidad | Un controlador de entradas sin experiencia completa las tareas básicas tras ≤ 15 min de capacitación. | Prueba con 5 voluntarios: ≥ 90 % de tareas sin ayuda. |
| RNF-018 | Usabilidad | UX writing en español neutro, tuteo, sin jerga; cada rechazo dice qué pasó y qué hacer. | Revisión contra `70-UX-WRITING.md`; ninguna pantalla muestra códigos de error crudos. |
| RNF-019 | Compatibilidad | Scanner en Chrome Android ≥ 110 y Safari iOS ≥ 16.4 (PWA instalable con cámara). | Matriz de dispositivos del simulacro sin fallos bloqueantes. |
| RNF-020 | Operación | Despliegue del host reproducible (Docker Compose o `node dist/server.js`) con un solo archivo de configuración `event.config.json`. | Un administrador monta un host nuevo desde cero siguiendo `50-OPERACION.md` en < 30 min. |
| RNF-021 | Calidad | `packages/core` con cobertura 100 % en Vitest; e2e Playwright para los flujos de §9; CI bloquea merges con tests rojos. | Reporte de cobertura en CI. |
| RNF-022 | Observabilidad | El host expone métricas básicas (escaneos/min, latencia de sync, dispositivos conectados, backlog) y logs estructurados JSON. | Panel de estado y `GET /metrics` disponibles. |

---

## 9. Flujos principales

### 9.1 Flujo completo de una persona acreditada

| Paso | Actor | Sistema | Resultado |
|---|---|---|---|
| 1. Inscripción | Inscriptor | Nube (`apps/registration`) | Completa formulario; se valida edad, cupo y consentimiento. Estado `inscrito` → `validado`. |
| 2. Aprobación | Coordinador | Nube | Revisa, resuelve duplicados, aprueba. Estado `aprobado`. Notificación al inscriptor. |
| 3. Emisión | Coordinador | Nube o host | Emite credencial: ID corto, QR firmado, n=1. Estado `emitido`. Log `credential.issued`. |
| 4. Sync a host | Automático | Nube → host | El host de sede recibe credenciales y claves públicas. Los scanners reciben el paquete en su siguiente sync. |
| 5. Impresión | Operador de impresión | Host (`apps/print`) | Genera PDF por lote, imprime. Estado `impreso`. |
| 6. Entrega | Operador de impresión | Host | En el puesto de acreditación, verifica documento, escanea el QR en modo entrega. Estado `entregado`. |
| 7. Ingreso | Control de entradas | Scanner (zona G, modo entrada) | Escanea; verde "Adelante, Juan"; compara foto; deja pasar. Escaneo guardado localmente y sincronizado. |
| 8. Ingreso a zona interna | Control de entradas | Scanner (zona T) | Mismo proceso; se valida que el rol tenga zona T. |
| 9. Salida | Control de entradas | Scanner (zona T, modo salida) | Escanea; registra salida; libera anti-passback de T. |
| 10. Re-ingreso | Control de entradas | Scanner (zona T, modo entrada) | Nuevo escaneo verde porque hay una salida registrada. |

### 9.2 Re-emisión por pérdida

1. La persona reporta pérdida en el puesto de acreditación con su documento.
2. El coordinador busca la credencial (nombre o ID), verifica identidad, elige **Re-emitir** con motivo "pérdida".
3. El sistema incrementa `n`, genera nuevo QR, revoca automáticamente la versión anterior y propaga la revocación a scanners (< 5 s conectados; al primer sync si no).
4. El operador imprime la nueva credencial individualmente y la marca `entregado`.
5. Si alguien intenta usar la credencial perdida: rojo "Credencial reemplazada" + incidencia para el supervisor.

### 9.3 Revocación

1. El coordinador (o supervisor vía coordinador) revoca con motivo (p. ej. "expulsión", "fraude confirmado").
2. La revocación se escribe en el log encadenado y en la lista de revocación del host.
3. Se propaga a scanners por WebSocket; los que estén sin red la reciben al reconectar.
4. Cualquier escaneo posterior es rojo "Credencial revocada. Llama al supervisor". No existe "des-revocar": se re-emite si corresponde.

### 9.4 Caída del host primario

1. El host primario deja de responder (hardware, software o red).
2. Los scanners pasan a "Sin conexión" y siguen validando localmente (L1). Nada se detiene en las puertas.
3. El administrador o supervisor ejecuta `tatami promote` en el standby (portátil con batería en otro punto físico).
4. El standby asume la identidad del host (IP flotante o DNS `host.tatamipass.co` → nueva IP) en < 60 s.
5. Los scanners reconectan automáticamente (< 90 s) y suben sus escaneos pendientes; no hay conflictos porque los escaneos son append-only.
6. Cuando el primario vuelve, se reincorpora como standby; el administrador decide si lo vuelve a promover fuera de hora pico.

### 9.5 Corte de energía total

1. Cae la energía del coliseo. UPS sostiene host primario, router y switch ≥ 45 min; standby en portátil con batería; scanners con power bank.
2. Las puertas siguen operando con scanners en L1.
3. Si el UPS se agota: el host se apaga limpiamente (script de apagado por UPS). Último snapshot en USB ≤ 5 min atrás, pero los escaneos están en los scanners.
4. Si un host no arranca al volver la energía: el administrador restaura desde USB con `tatami restore` en < 10 min, o promueve el standby.
5. Los scanners re-sincronizan; la reconciliación es idempotente.
6. Si tampoco hay scanners operativos: modo degradado con listas impresas y planillas (RF-093), carga posterior (RF-094).

### 9.6 Enrolamiento de un dispositivo

1. El supervisor abre el panel del host → Dispositivos → "Nuevo", elige rol (Control/Supervisor), zona, modo y nombre.
2. El host muestra un QR de enrolamiento (token de 10 min) con enlace a la CA raíz.
3. El voluntario instala la CA (una vez), abre la PWA, escanea el QR, define su PIN de 6 dígitos.
4. El scanner descarga el paquete completo (credenciales, reglas, revocaciones, claves públicas) y queda operativo.

---

## 10. Modelo de datos resumido

Entidades principales (nombres lógicos; la implementación en Drizzle/Postgres y SQLite puede ajustar tipos).

| Entidad | Campos clave | Notas |
|---|---|---|
| `event` | `id` (`nac2026`), nombre, `start_date`, `end_date`, sedes, config (`event.config.json`), estado | Un host sirve un evento. |
| `access_role` | `code` (`GEN`, `COMP`…), nombre, zonas[], días válidos[], cupo máximo, requiere foto, color, permite digital, reglas anti-passback por zona | Configurable; se sincroniza a scanners. |
| `zone` | `code` (`G`, `W`, `T`…), nombre, sede, umbral de ocupación | |
| `age_category` | `code`, nombre, edad mínima, edad máxima | Calculada al primer día del evento. |
| `club` | `id`, nombre, delegación/ciudad, contacto, cupo coach | |
| `user` | `id`, email, hash Argon2id, rol de sistema, club_id (si inscriptor), activo | Nube y host. |
| `person` | `id`, nombres, apellidos, `birth_date` (cifrado), `document` (cifrado), sexo, foto (ref), club_id, contacto, consentimiento datos, acudiente {nombre, documento, fecha} si menor, `source` (online/sportdata/ambos) | Núcleo de datos personales; sujeto a purga a 90 días. |
| `registration` | `id`, person_id, event_id, access_role_code, age_category_code, estado (`inscrito`…`entregado`, `rechazado`, `lista_espera`), pagado (bool manual), motivo rechazo, timestamps por estado | |
| `credential` | `id` (`00123`), `public_id` (`TP-2026-00123-C`), registration_id, role, zonas[], `valid_from`, `valid_to`, `version n`, `key_id k`, estado, `revoked_at`, `revoke_reason`, digital (bool) | Una por registration; versiones anteriores quedan en `credential_version`. |
| `credential_version` | credential_id, `n`, token firmado, emitido por, emitido en, revocada (bool) | Historial de QR. |
| `signing_key` | `k`, clave pública, clave privada cifrada (solo nube/host emisor), activa desde/hasta, retirada | |
| `revocation` | credential_id, `n`, motivo, timestamp host, por usuario | Lista sincronizada a scanners (LWW). |
| `device` | `device_id`, nombre, rol de sistema, zona actual, modo (entrada/salida), host_id, enrolado en, PIN hash, bloqueado hasta, último sync, último `seq` recibido | |
| `enrollment_token` | token, rol, zona, expira (10 min), usado (bool) | |
| `scan` | `device_id`, `seq`, credential_id, `n`, zona, dirección, resultado (ok/no/alerta), motivo, timestamp dispositivo, timestamp host, `manual` (bool), `source` (scanner/planilla), `override_by`, foto_ok (bool) | Append-only; PK `(device_id, seq)`. |
| `presence` | credential_id, zona, dentro (bool), último escaneo | Estado derivado para anti-passback; recalculable desde `scan`. |
| `alert` | id, tipo (duplicado, pin bloqueado, foto no coincide, ocupación), credential_id, dispositivos, timestamp, resuelta por | |
| `audit_log` | `seq`, tipo, actor, payload, timestamp, `prev_hash`, `hash` | Encadenado SHA-256; nunca se actualiza ni borra. |
| `backup` | archivo, timestamp, tamaño, hash, destino (usb/standby/nube), verificado | |
| `import_job` | archivo, mapeo, filas totales/creadas/actualizadas/error, aplicado (bool), usuario | SportData. |

---

## 11. Dependencias y riesgos

| # | Riesgo / dependencia | Prob. | Impacto | Mitigación |
|---|---|---|---|---|
| R1 | SportData no entrega API ni export limpio; columnas cambian entre versiones. | Alta | Medio | Importador por CSV/XLSX con mapeo guiado y guardado; prueba con export real ≥ 30 días antes; fallback a inscripción online de competidores por club. |
| R2 | Wi-Fi de staff con cobertura pobre en el coliseo (estructura metálica, distancia). | Alta | Medio | Scanner L1 no depende de red; mesh real recomendado; visita técnica a la sede ≥ 21 días antes; mapa de cobertura en simulacro. |
| R3 | Cámara de la PWA no funciona en iOS por HTTPS/CA. | Media | Alto | Dominio real `host.tatamipass.co` con Let's Encrypt (DNS-01) emitido antes del evento como alternativa a CA interna; matriz de dispositivos probada en simulacro; dispositivos Android de reserva. |
| R4 | Corte de energía prolongado. | Media | Alto | UPS 45 min, standby en portátil, scanners con power bank, backups cada 5 min, modo degradado en papel. |
| R5 | Fotocopia o pantallazo de credencial. | Alta | Medio | Foto en pantalla, anti-passback, alerta de duplicado < 2 min, holograma físico, QR rotativo en digital. |
| R6 | Voluntarios rotan y no saben usar el scanner. | Alta | Medio | UX de dos pantallas, capacitación de 15 min, manual por rol (`60-MANUALES`), supervisor por sede. |
| R7 | Pérdida o filtración de datos personales (menores, documentos). | Baja | Alto | Cifrado en reposo y tránsito, mínimo privilegio, purga a 90 días, miniaturas de foto en scanners borradas al des-enrolar. |
| R8 | Clave privada de firma comprometida. | Baja | Alto | Clave cifrada con passphrase + env, nunca en scanners; rotación `k1` → `k2` sin reemitir todo (RF-028); credenciales afectadas se re-emiten. |
| R9 | Reloj desincronizado en scanners (QR rotativo). | Media | Bajo | Host como NTP; tolerancia ±5 min; solo afecta `GEN` digital. |
| R10 | Impresora falla el día de entrega de credenciales. | Media | Medio | Imprimir ≥ 90 % de credenciales antes del evento; impresora de respaldo; PDF portable para papelería externa. |
| R11 | Cambios tardíos de la federación (categorías, roles, puertas). | Alta | Bajo | Todo en `event.config.json`; roles creables sin código; congelar config 7 días antes (simulacro). |
| R12 | Un solo desarrollador (Jhoan) y tiempo limitado. | Alta | Alto | Alcance v1 estricto; fases con hitos; priorizar M sobre S/C; S/C se recortan si la Fase 2 se retrasa. |
| R13 | Dependencias de terceros (Vercel, Neon, Let's Encrypt) caídas el día D. | Baja | Nulo | Por diseño la nube no es necesaria el día del evento. |

---

## 12. Plan de fases

Supuesto: evento **20–22 de noviembre de 2026** (D = 20 de noviembre). Los hitos son relativos a D y se recalculan si la federación confirma otra fecha.

| Fase | Ventana | Entregables | Hito de salida |
|---|---|---|---|
| **Fase 0 · Setup** | D−42 → D−38 (9–13 oct) | Monorepo, CI (Vitest, Playwright, `npm audit`, SBOM), `packages/core` con tipos, `event.config.json` inicial, docs 00/10/20/30. Confirmar preguntas abiertas (§13). | CI verde con tests de ejemplo; config del evento aprobada por la federación. |
| **Fase 1 · Nube + core** | D−38 → D−24 (13–27 oct) | `packages/core`: firma/verificación, motor de reglas, categorías de edad, log de eventos, importador SportData (100 % cobertura). `apps/registration`: formulario, cupos, edad, consentimiento, aprobación, importación, emisión, claves. | Inscripción abierta al público en Vercel; importación con export real de SportData; 100 credenciales emitidas de prueba. |
| **Fase 2 · Host + scanner** | D−24 → D−13 (27 oct–7 nov) | `apps/host`: Fastify, SQLite, panel, sync WS/polling, standby, NTP, Caddy/HTTPS, enrolamiento, backups. `apps/scanner`: PWA, validación offline, anti-passback local, modos, ingreso manual, sync. `scripts/simulate.ts` v1. | Dos hosts (primario + standby) y 3 scanners validan 2.000 credenciales sin internet; simulación de 8 puertas pasa umbrales de §11. |
| **Fase 3 · Impresión + antifraude** | D−13 → D−8 (7–12 nov) | `apps/print`: plantillas por rol, lotes, reimpresión, entrega. Alertas de duplicado entre puertas, overrides de supervisor, incidencias, credencial digital rotativa, reportes y verificación de cadena, modo degradado (listas y planillas). | Lote de 500 en < 60 s; 0 de 50 QR fraudulentos aceptados en prueba interna; reportes del día coinciden con escaneos. |
| **Fase 4 · Simulacro y go-live** | D−7 → D+3 (13–23 nov) | D−7: **simulacro de 2 h** con 200 personas/credenciales de prueba y fallos inyectados (guion en `20-RF-TEST.md`). D−6 → D−2: corrección de defectos bloqueantes, congelación de config, impresión masiva, capacitación de voluntarios. D−1: montaje en sede, prueba de cobertura, enrolamiento de dispositivos. D → D+2: operación. D+3: cierre, exportación de auditoría, inicio de retención de 90 días. | Checklist go/no-go del simulacro en verde; credenciales impresas ≥ 90 %; dispositivos enrolados; backups verificados. |

Si la Fase 2 se desplaza más de 3 días, se recortan primero: RF-049, RF-060, RF-069, RF-088, RF-089, RF-102 (todos S/C), y la credencial digital (§7.12) pasa a "solo si queda tiempo".

---

## 13. Preguntas abiertas (confirmar con la federación)

| # | Pregunta | Impacto si cambia | Fecha límite |
|---|---|---|---|
| P1 | **Fecha exacta** del evento (supuesto: 20–22 nov 2026, 3 días). | Recalcula todos los hitos de §12 y las fechas de vigencia en el QR. | Fase 0 |
| P2 | **Sede(s):** ¿un solo coliseo o varios pabellones? Dirección, planos, zonas reales. | Define número de hosts (uno por sede) y zonas en `event.config.json`. | Fase 0 |
| P3 | **Número de puertas** controladas y cuáles son entrada/salida/mixtas. | Define cantidad de scanners (1 por puerta + 1 reserva), cobertura Wi-Fi y reglas de anti-passback. | Fase 0 |
| P4 | ¿**SportData** ofrece API para este evento o solo exportación? Formato exacto del export (columnas, codificación). | Si hay API, se evalúa un conector en Fase 1; si no, se valida el mapeo CSV con un export real. | Fase 1 |
| P5 | **Categorías oficiales** de edad y peso del campeonato 2026 (confirmar rangos de edad y si hay categorías adicionales). | Ajusta `age_category` y la validación de inscripción. | Fase 0 |
| P6 | **Roles y cupos**: ¿cuántos coaches por club? ¿Hay roles no listados (voluntarios, logística, delegados de federación)? | Nuevos roles en config; cupos. | Fase 1 |
| P7 | ¿El público general paga entrada? ¿Se vende por día? ¿Quién lo gestiona? | Define si `GEN` se emite desde Tatami Pass y si la credencial digital es prioritaria. | Fase 1 |
| P8 | **Hardware disponible**: ¿la federación aporta mini PC, impresora de tarjetas, router/mesh, UPS? ¿O se alquila/compra? | Presupuesto y plan de montaje D−1. | Fase 2 |
| P9 | ¿Quién es el **responsable de tratamiento de datos** ante la Ley 1581 (federación o liga organizadora)? Texto de la política. | Texto legal del formulario y responsable de atender derechos. | Fase 1 |
| P10 | ¿Habrá internet en la sede (fibra, 4G) o solo hotspot? ¿Hay prohibición de redes propias? | Confirma el plan de red de §8 de Decisiones. | Fase 2 |
| P11 | ¿Se requiere holograma físico? ¿Quién lo provee? | Elemento antifraude opcional. | Fase 3 |
| P12 | ¿Fecha y lugar del **simulacro** (D−7) y disponibilidad de ~200 voluntarios o se usarán credenciales de prueba? | Guion del simulacro. | Fase 3 |

# 00 · Decisiones de producto y arquitectura — Tatami Pass

> Documento contrato. Todo lo demás (PRD, RF-TEST, código, manuales, diseño) debe ser coherente con esto.
> Fecha: 2026-10-09 · Autor de las decisiones: Claude (por encargo de Jhoan Burbano) · Estado: v1.0 aprobado para construcción.

## 1. Qué es

**Tatami Pass** es el sistema de **acreditación y control de accesos** del **Campeonato Nacional de Taekwondo ITF 2026** (Colombia). Aforo previsto: **1.000 a 2.000 personas** (competidores, coaches, jurado, VIP, patrocinadores, prensa, público general y staff).

**Alcance: solo accesos.** No gestiona llaves de competencia, puntajes, pesajes ni resultados. Eso lo hace SportData; Tatami Pass **recibe** de SportData la lista de competidores y les emite credenciales.

## 2. Principio rector: funciona aunque no haya nada

Tres niveles de resiliencia, cada uno funciona sin el siguiente:

| Nivel | Qué es | Qué hace solo |
|---|---|---|
| **L1 · Scanner** (celular/tablet, PWA) | Copia local completa de credenciales y reglas en IndexedDB | Valida QR firmados **sin red** (firma Ed25519 + reglas + lista de revocación). Guarda cada escaneo localmente y lo sube cuando puede. |
| **L2 · Host** (mini PC/portátil en la sede) | Servidor local Fastify + SQLite. Es la **fuente de verdad de la sede**. | Sincroniza scanners por Wi-Fi LAN, imprime credenciales, panel de admin, anti-passback entre puertas, backups. No necesita internet. |
| **L3 · Nube** (Vercel + Postgres) | Inscripción online pública, importación SportData, emisión de credenciales previa al evento | Se sincroniza con el host cuando hay internet (hotspot 4G basta). Si la nube se cae el día del evento, **no pasa nada**. |

"Offline-first **por host**" = cada sede/pabellón tiene su propio host con la base completa del evento. Un evento con un solo pabellón tiene un host **primario** y un host **de respaldo** (standby) que replica en caliente.

## 3. Stack (decidido)

- **Lenguaje:** TypeScript en todo (monorepo npm workspaces).
- `packages/core`: dominio puro, sin IO. Tipos, firma/verificación de QR, motor de reglas de acceso, log de eventos para sync, categorías de edad, importador SportData (parser de CSV). **100 % testeado con Vitest.**
- `apps/host`: Node 20 + **Fastify** + **SQLite (better-sqlite3, WAL)** + Drizzle ORM. Sirve API REST + WebSocket de sync + panel admin web (HTML servido por el host). Empaquetado como Docker Compose y como `node dist/server.js`.
- `apps/scanner`: **PWA** (Vite + React + Dexie/IndexedDB). Cámara con `BarcodeDetector` y fallback `@zxing/browser`. Instalable en Android/iOS. Requiere HTTPS → ver §8.
- `apps/registration`: **Next.js 15** (App Router) desplegado en Vercel + Postgres (Neon). Formulario público de inscripción + panel de organización en nube.
- `apps/print`: generación de PDF de credenciales (pdf-lib) — corre dentro del host.
- Tests: Vitest (unit), Playwright (e2e web), `scripts/simulate.ts` (carga: 2.000 credenciales, 8 puertas, pico de ingreso, corte de energía simulado).

## 4. Credencial y QR (antifraude en el diseño)

- Cada credencial tiene un **ID público corto** `TP-2026-00123-C` (secuencial + dígito verificador Luhn mod 36) impreso en texto grande para fallback manual.
- El **QR contiene un token firmado** (no una URL): `TP1.<payload base64url>.<firma Ed25519 base64url>`.
  - Payload: `{ v:1, e:"nac2026", c:"00123", r:"COMP", z:["A","W","T"], f:"2026-11-20", t:"2026-11-22", n:3, k:"k1" }` → evento, credencial, rol, zonas, vigencia, versión (`n`) y id de clave.
  - La **clave privada vive solo en la nube/host de emisión** (HSM lógico: archivo cifrado con passphrase + variable de entorno). Los scanners solo tienen la **clave pública**.
  - Un QR fotocopiado o capturado en pantalla sigue siendo "válido" criptográficamente → por eso el QR **no basta solo**: se combina con **foto en pantalla del scanner**, **anti-passback** (no puede entrar dos veces sin salir), **alerta de duplicado en tiempo real** (mismo QR en dos puertas en < 2 min) y **revocación** (lista sincronizada).
  - Re-emitir una credencial incrementa `n`; las versiones anteriores quedan revocadas automáticamente.
- **Credencial digital** (opcional, solo rol General/público): QR rotativo cada 60 s con marca de tiempo firmada (`exp`), inservible en pantallazo. Los roles acreditados (competidor, jurado, VIP, patrocinador, staff) usan **credencial física** impresa.
- Formato físico: **100 × 150 mm vertical** (lanyard estándar). Color de fondo + franja lateral por rol, nombre grande, rol en mayúsculas, foto, club/delegación, zonas como pictogramas, QR 40 mm, ID corto, holograma adhesivo opcional sobre el ID.

## 5. Tipos de entrada (roles de acceso) — configurables

Se definen en `event.config.json` del evento, no en código. Valores por defecto:

| Código | Nombre | Zonas por defecto | Notas |
|---|---|---|---|
| `GEN` | General | Gradería (G) | Puede ser por día. Única que admite credencial digital. |
| `COMP` | Competidor | G, Área de calentamiento (W), Tatamis (T), Pesaje (P) | Se importa de SportData. Control de edad por categoría. |
| `COACH` | Coach/Entrenador | G, W, T | Máximo N por club (configurable). |
| `JUR` | Jurado / Árbitro | G, W, T, Sala de jueces (J) | |
| `VIP` | VIP | G, Palco (V), Zona de hospitalidad (H) | |
| `SPON` | Patrocinador | G, H, Stands (S) | |
| `PRESS` | Prensa | G, Zona de prensa (M), T con restricción | |
| `MED` | Médico | Todas | |
| `STAFF` | Staff / Organización | Todas | |
| `ACOMP` | Acompañante | Gradería (G) | Ligado a un participante (`companionOf`); sin cupo propio; admite credencial digital. Límites en `companions` y `totalCapacity` (§7). |

Cada rol define: zonas, días válidos, **cupo máximo**, si requiere foto, color, si permite credencial digital, y reglas de anti-passback por zona. El admin puede **crear roles nuevos** sin tocar código.

## 6. Roles del sistema (personas que usan Tatami Pass)

| Rol | Qué hace | Dónde |
|---|---|---|
| **Administrador del evento** | Configura evento, roles, zonas, cupos, categorías de edad, claves. Ve todo. | Nube + host |
| **Coordinador de acreditación** | Aprueba inscripciones, resuelve duplicados, emite/re-emite credenciales, revoca. | Nube + host |
| **Operador de impresión** | Imprime lotes, marca credenciales como entregadas. | Host |
| **Inscriptor (club/delegación)** | Inscribe a sus participantes online. Solo ve su club. | Nube |
| **Control de entradas** (el rol que pidió Jhoan) | Escanea en una puerta/zona. Decide dejar pasar o no según lo que dice la app. Puede marcar "ingreso manual" con motivo. | Scanner |
| **Supervisor de puerta** | Lo mismo que Control + puede autorizar excepciones, ver alertas de fraude, cambiar de zona el dispositivo. | Scanner + host |
| **Auditor** | Solo lectura: logs, reportes, trazabilidad. | Host + nube |

Autenticación: usuario + contraseña en nube/host (Argon2id), **PIN de 6 dígitos** en el scanner (tras enrolar el dispositivo). Dispositivos se **enrolan** escaneando un QR de enrolamiento que genera el host (token único, caduca en 10 min, bindea `device_id` + rol + zona).

## 7. Inscripción online (nube)

- Formulario público por evento. El inscriptor crea cuenta (club) o inscribe como individual.
- **Control de cupos:** cupo global, por rol y por categoría. Al llegar al cupo, el formulario muestra "cupo lleno" y ofrece lista de espera.
- **Control de edad:** edad calculada a la fecha del primer día del evento. Categorías ITF por defecto (configurables): Infantil A (6–9), Infantil B (10–13), Juvenil (14–17), Adulto (18–35), Senior (36+). Si la edad no corresponde a la categoría elegida, el formulario bloquea y explica. Menores requieren **consentimiento del acudiente** (checkbox + nombre + documento) por Ley 1581/2012.
- **Importación SportData:** exportación CSV/XLSX desde SportData (sin API garantizada) → mapeo de columnas guiado → dedupe por `nombre + fecha de nacimiento + club` → crea/actualiza competidores con rol `COMP`. Repetible (idempotente): reimportar actualiza, no duplica.
- Flujo: inscrito → validado (cupo/edad OK) → aprobado por coordinador → credencial emitida → impresa → entregada.

- **Acompañantes por participante (decisión 2026-10-13):** cada participante puede inscribir acompañantes (nombre, documento y parentesco opcionales) que entran con él a Gradería. Son personas con rol de acceso `ACOMP` (zona `G`, sin foto, credencial digital por defecto, sin cupo propio) ligadas al participante por `companionOf`. Los límites viven en la config del evento: `companions.perParticipant` (por defecto 2), `companions.total` (por defecto sin límite) y `totalCapacity` (aforo total del evento, por defecto 2.000); `null` = sin límite. La validación es una sola función de `packages/core` (`validateCompanions`) que usan el formulario, la API de inscripción y el host, en este orden: límite por participante → cupo total de acompañantes → aforo total. Los acompañantes heredan el estado de la inscripción del participante (pendiente/aprobado/lista de espera) y se exportan y acreditan junto con él.

## 8. Red, sync y HTTPS en LAN

- **Wi-Fi dedicada para staff** (SSID oculto, WPA2/3, sin acceso a internet obligatorio). Router principal + **repetidores/mesh** (recomendado mesh real, p. ej. TP-Link Deco/Ubiquiti; si son repetidores clásicos, mismo SSID, canales 1/6/11 en 2,4 GHz para cobertura). Un scanner por puerta + 1 de reserva. Hasta 8 puertas sin problema.
- **Sync scanner ↔ host:** WebSocket con fallback a polling cada 15 s. Modelo de datos **append-only**: los escaneos son hechos (no hay conflictos); las revocaciones y cambios de config son LWW (last-writer-wins con reloj del host). Cada evento lleva `(device_id, seq)` monotónico → idempotente.
- **Sync host ↔ nube:** mismo protocolo, por HTTPS cuando hay internet. **Host ↔ host standby:** el standby es un cliente de sync más, con la base completa; si cae el primario, se promueve en 1 comando (`tatami promote`).
- **HTTPS en LAN:** las PWA necesitan contexto seguro para la cámara. El host corre detrás de **Caddy con CA interna**; el QR de enrolamiento incluye el certificado raíz y la guía de instalación en Android/iOS (1 vez por dispositivo). Alternativa aceptada: dominio real `host.tatamipass.co` apuntando a IP LAN con certificado Let's Encrypt emitido antes del evento (DNS-01).
- **Reloj:** el host es el NTP de la LAN (chrony). Los scanners toleran ±5 min de deriva en QR rotativos.

- **Actualización desde la nube: botón + periódica (decisión 2026-10-13):** la nube (`apps/registration`) expone `GET /api/export?since=` protegido por una clave compartida (`x-tatami-key` = `TP_CLOUD_KEY`) que devuelve las inscripciones **aprobadas** creadas o actualizadas desde esa fecha, con sus acompañantes. El host la consume con `POST /sync/cloud/pull` (manual, desde el panel/API por admin o coordinador) y con un scheduler interno cada `TP_CLOUD_INTERVAL_MIN` minutos (por defecto 5; `0` = solo manual) que nunca solapa ejecuciones. El pull es idempotente por id de inscripción (guardado como `external_id` de la persona): lo nuevo crea persona + credencial, lo cambiado actualiza nombre/club/categoría **sin re-emitir** (el token no contiene esos datos) y lo repetido no hace nada. Sin internet el host registra "sin conexión a la nube, se reintenta en N min", conserva el último cursor y sigue operando; `GET /sync/cloud/status` muestra última hora, conteos y si el último intento tuvo conexión. Del lado del scanner el equivalente ya existe: polling cada 15 s y el botón "Reintentar ahora" de la bandeja de pendientes.

## 9. Energía, backups y modo degradado

- **UPS** para host primario + router + switch (mínimo 45 min; 1.000 VA aprox.). Host standby en un **portátil con batería** en otro punto físico. Repetidores en toma distinta o con mini-UPS.
- Scanners: celulares con **power bank**; consumo estimado 10 %/h con pantalla al 70 %.
- **Backups del host:** snapshot SQLite (`VACUUM INTO`) cada **5 min** a USB cifrado (LUKS) + replicación continua al standby + subida a nube cuando hay internet. Retención: 48 snapshots rotativos + 1 por hora.
- **Modo degradado documentado** (si todo falla): cada puerta tiene impresa la **lista de credenciales por rol** (ID corto + nombre + foto miniatura) y una **planilla de ingreso manual**; el scanner sigue funcionando solo (L1) aunque no haya host; al volver la energía, los escaneos se sincronizan automáticamente.

## 10. Seguridad (alineación ISO/IEC 27001:2022)

Aclaración honesta: ISO 27001 **certifica organizaciones**, no software. Tatami Pass se construye **alineado a los controles del Anexo A** (27001:2022 / 27002:2022) y entrega la evidencia que una auditoría pediría. El mapeo detallado está en `docs/40-SEGURIDAD-ISO27001.md`. Puntos fijos:

- Datos personales (Ley 1581/2012 + Decreto 1377/2013): finalidad declarada, consentimiento, menores con acudiente, derecho de supresión, retención **90 días** post-evento y purga automática.
- Cifrado: TLS 1.2+ en toda comunicación; disco del host cifrado (LUKS/FileVault); campos sensibles (documento de identidad, fecha de nacimiento) cifrados en reposo con AES-256-GCM y clave derivada por evento; contraseñas Argon2id; claves de firma Ed25519 con rotación por evento.
- Control de acceso: RBAC por rol del sistema, mínimo privilegio, PIN + dispositivo enrolado, sesiones del scanner expiran a las 12 h.
- Trazabilidad: **log de auditoría encadenado por hash** (cada registro incluye el hash del anterior) — inmutable y verificable; exportable para auditoría.
- Antifraude: firma, foto, anti-passback, alertas de duplicado, revocación, versión de credencial, QR rotativo digital, holograma físico, reporte de incidencias por puerta.
- Gestión de vulnerabilidades: dependencias con `npm audit` en CI, SBOM, imágenes Docker sin root.
- Continuidad: §9 completo + simulacro obligatorio 7 días antes (ver RF-TEST).

## 11. Capacidad y rendimiento (objetivos medibles)

- Validación offline en scanner: **< 300 ms** desde lectura de QR a pantalla verde/roja.
- Pico de ingreso: 1.500 personas en 60 min = 25/min; con 6 puertas → ~4/min por puerta. Holgura ×10.
- Sync de un escaneo al host: < 2 s en LAN. Reconciliación tras 1 h sin red: < 30 s para 5.000 eventos.
- Impresión: lote de 500 credenciales en PDF < 60 s.

## 12. Diseño y UX writing

- Estilo: **light, deportivo, limpio con efectos** (gradientes, tarjetas con profundidad, animaciones cortas, franjas diagonales tipo cinturón). Paleta: fondo `#F6F8FB`, azul dobok `#1C4FD1`, rojo cinturón `#E0323B`, verde ok `#16A34A`, texto `#0F172A`, lima energía `#C8F560` como acento. Tipografía: **Sora** (titulares) + **Inter** (texto).
- UX writing en español neutro, tuteo, frases cortas, sin jerga técnica. Pantalla del scanner: verde "**Adelante, Juan**" / roja "**No puede entrar**" + motivo en lenguaje humano ("Esta credencial ya entró a Tatamis a las 9:14") + qué hacer ("Pide que salga y vuelva a escanear, o llama al supervisor"). Sonido + vibración distintos para OK / NO / ALERTA.
- Accesibilidad: contraste AA, botones ≥ 48 px, modo una mano, funciona con guantes táctiles (botones grandes), lectura en exteriores (alto contraste).

## 13. Lo que NO hacemos (fuera de alcance v1)

Cobros/pagos de inscripción (se registra "pagado" manualmente o por import), llaves y resultados, control de aforo por sensores, reconocimiento facial, app nativa (la PWA cubre), multi-idioma (solo español en v1).

## 14. Nombres y convenciones

- Producto: **Tatami Pass**. Evento: `nac2026`. Prefijo de IDs: `TP-2026-`.
- Repositorio: `tatami-pass/` (monorepo). Docs en `docs/` numeradas: 00 decisiones, 10 PRD, 20 RF-TEST, 30 arquitectura, 40 seguridad, 50 operación, 60 manuales por rol, 70 UX writing, 80 cómo probar.

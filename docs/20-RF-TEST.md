# 20 · Plan de pruebas — Tatami Pass

> Plan de pruebas trazable contra `10-PRD.md` (RF-001 a RF-102, RNF-001 a RNF-022) y coherente con `00-DECISIONES.md`.
> Fecha: 2026-10-09 · Versión: 1.0 · Dueño: Jhoan Burbano · Ejecutores: Jhoan (automatizadas), coordinador de acreditación y supervisores (manuales de campo).

---

## 1. Estrategia

### 1.1 Pirámide

| Nivel | Qué cubre | Herramienta | Dónde corre | Meta |
|---|---|---|---|---|
| **Unit** | `packages/core`: firma/verificación Ed25519, Luhn mod 36, motor de reglas (zonas, vigencia, versión, revocación, anti-passback), categorías de edad, parser/dedupe SportData, encadenado de hash, serialización de eventos de sync. | Vitest | CI en cada push | Cobertura **100 %** de `packages/core` (RNF-021). |
| **Integración host** | `apps/host`: API REST, WebSocket de sync, idempotencia `(device_id, seq)`, LWW, revocaciones, enrolamiento, backups, restore, promoción de standby, auditoría. | Vitest + SQLite en memoria (`:memory:` con WAL simulado) + Fastify `inject` | CI | Cada endpoint y cada caso de sync del PRD. |
| **E2E web** | `apps/registration` (inscripción, cupos, edad, consentimiento, aprobación, importación), panel del host, PWA scanner (con cámara simulada inyectando el token). | Playwright (Chromium + WebKit) | CI nightly y antes de cada release | Flujos de PRD §9 completos. |
| **Carga** | 2.000 credenciales, 8 puertas, pico de 1.500 en 60 min, 2 h sin red + reconciliación, corte de energía simulado. | `scripts/simulate.ts` | Portátil de desarrollo contra host real | Umbrales de PRD §11 / RNF-001..004. |
| **Manual de campo** | Cámara real, Wi-Fi real, impresora real, UPS real, personas reales, usabilidad con voluntarios. | Checklists de este documento | Laboratorio (Fase 2–3) y **simulacro D−7** (Fase 4) | Checklist go/no-go en verde. |

### 1.2 Principios

- **Cada RF tiene al menos un TC**; cada TC indica tipo (Auto/Manual/Carga) y prioridad (P1 bloqueante, P2 alta, P3 media).
- Las pruebas de fraude se ejecutan **siempre con red y sin red**, porque el comportamiento de L1 es la garantía real.
- Las pruebas de campo se ejecutan en el hardware del evento (host, scanners, impresora), no solo en el portátil de desarrollo.
- Un defecto P1 abierto bloquea el release (§8).

### 1.3 Datos de prueba

- `fixtures/credentials-2000.json`: 2.000 credenciales con distribución realista (COMP 1.200, COACH 150, GEN 450, JUR 60, STAFF 80, VIP 30, SPON 15, PRESS 10, MED 5).
- `fixtures/sportdata-export.csv` y `.xlsx`: export real anonimizado de SportData (P4 del PRD) + variantes con errores (fechas inválidas, columnas desordenadas, duplicados).
- `fixtures/qr-attacks/`: 50 QR fraudulentos: firma alterada, payload alterado, evento ajeno, clave desconocida, versión anterior, vencido, revocado, fotocopia, QR digital expirado.
- `fixtures/keys/`: par `k1`, `k2` de prueba (nunca las del evento).

---

## 2. Entornos

| Entorno | Composición | Uso |
|---|---|---|
| **DEV** | Portátil de Jhoan; nube en Vercel preview; host en Docker local; scanner en Chrome con cámara simulada. | Desarrollo y CI. |
| **LAB** | Host primario (mini PC) + host standby (portátil) + router/mesh del evento + 3 scanners Android/iOS + impresora + UPS, sin internet (WAN desconectado) en la oficina. | Pruebas de integración de campo, Fases 2–3. |
| **SIM** | LAB desplegado en la sede o en un pabellón equivalente, con 8 puertas marcadas, 200 personas o credenciales de prueba. | Simulacro D−7. |
| **PROD** | Nube (`nac2026` en Vercel + Neon), host primario y standby en sede, scanners enrolados. | Evento. Solo smoke tests de D−1 (§6.5). |

Matriz mínima de dispositivos para scanner: Android 11+ gama media (Chrome ≥ 110), Android 13+ gama alta, iPhone con iOS ≥ 16.4 (Safari PWA), tablet Android 10". Un dispositivo "viejo" (4 GB RAM) es obligatorio para RNF-001.

---

## 3. Matriz de trazabilidad RF ↔ TC

Todos los RF del PRD tienen al menos un TC. Los TC marcados con ★ se detallan en §5.

| RF | TC | RF | TC | RF | TC |
|---|---|---|---|---|---|
| RF-001 | TC-001 | RF-035 | TC-036 | RF-069 | TC-070 |
| RF-002 | TC-002, TC-077 | RF-036 | TC-037 | RF-070 | TC-072 |
| RF-003 | TC-003 | RF-037 | TC-038 | RF-071 | TC-073 |
| RF-004 | TC-004★, TC-005 | RF-038 | TC-039 | RF-072 | TC-074★ |
| RF-005 | TC-006★ | RF-039 | TC-040, TC-023★, TC-067★ | RF-073 | TC-075 |
| RF-006 | TC-007★ | RF-040 | TC-041, TC-P01 | RF-074 | TC-076 |
| RF-007 | TC-008 | RF-041 | TC-042 | RF-075 | TC-077 |
| RF-008 | TC-009 | RF-042 | TC-043 | RF-076 | TC-078 |
| RF-009 | TC-010 | RF-043 | TC-044★ | RF-077 | TC-079 |
| RF-010 | TC-011 | RF-044 | TC-045 | RF-078 | TC-080★ |
| RF-011 | TC-012 | RF-045 | TC-046 | RF-079 | TC-081 |
| RF-012 | TC-013 | RF-046 | TC-047 | RF-080 | TC-082 |
| RF-013 | TC-014 | RF-047 | TC-048 | RF-081 | TC-083 |
| RF-014 | TC-015 | RF-048 | TC-049 | RF-082 | TC-084 |
| RF-015 | TC-016★ | RF-049 | TC-050 | RF-083 | TC-085 |
| RF-016 | TC-017 | RF-050 | TC-051 | RF-084 | TC-086★ |
| RF-017 | TC-018 | RF-051 | TC-052 | RF-085 | TC-087 |
| RF-018 | TC-019 | RF-052 | TC-053 | RF-086 | TC-088 |
| RF-019 | TC-020 | RF-053 | TC-054 | RF-087 | TC-089 |
| RF-020 | TC-021 | RF-054 | TC-055, TC-P03 | RF-088 | TC-090 |
| RF-021 | TC-022 | RF-055 | TC-056 | RF-089 | TC-091 |
| RF-022 | TC-023★ | RF-056 | TC-057★ | RF-090 | TC-092 |
| RF-023 | TC-024 | RF-057 | TC-058 | RF-091 | TC-093 |
| RF-024 | TC-025★ | RF-058 | TC-059 | RF-092 | TC-094★ |
| RF-025 | TC-026, TC-071★ | RF-059 | TC-060 | RF-093 | TC-095 |
| RF-026 | TC-027 | RF-060 | TC-061 | RF-094 | TC-096 |
| RF-027 | TC-028 | RF-061 | TC-062★ | RF-095 | TC-097 |
| RF-028 | TC-029 | RF-062 | TC-063, TC-071★ | RF-096 | TC-098 |
| RF-029 | TC-030 | RF-063 | TC-064★ | RF-097 | TC-099 |
| RF-030 | TC-031 | RF-064 | TC-065 | RF-098 | TC-100★ |
| RF-031 | TC-032★, TC-P04 | RF-065 | TC-066 | RF-099 | TC-101 |
| RF-032 | TC-033 | RF-066 | TC-067★ | RF-100 | TC-102 |
| RF-033 | TC-034 | RF-067 | TC-068, TC-025★ | RF-101 | TC-103 |
| RF-034 | TC-035 | RF-068 | TC-069 | RF-102 | TC-104 |
| RF-103 | TC-105 | RF-106 | TC-108 | RF-109 | TC-111 |
| RF-104 | TC-106 | RF-107 | TC-109 | | |
| RF-105 | TC-107 | RF-108 | TC-110 | | |

RNF cubiertos: RNF-001 → TC-P01; RNF-002 → TC-P02; RNF-003 → TC-P03; RNF-004 → TC-P04; RNF-005 → TC-052, TC-038, TC-056; RNF-006 → TC-057, TC-094; RNF-007/008/009/011 → TC-S01..S04 (§4.13); RNF-010 → TC-085/086; RNF-013/014/015 → TC-S05, TC-S06, TC-083; RNF-016/017/018 → TC-049, TC-U01 (§6.4); RNF-019 → matriz de dispositivos (§2); RNF-020 → TC-051; RNF-021 → gate de CI (§8); RNF-022 → TC-061.


### 3.1 Qué está automatizado de extremo a extremo (Playwright, `e2e/specs/`)

Cada spec lleva en el nombre el TC que cubre. `npm run e2e` corre todo (≈ 2,5 min + 1 min de builds, 44 pruebas); `npm run e2e:smoke` solo lo marcado **@smoke** (≈ 30 s + builds); `npm run e2e:perf` lo marcado **@perf** (no corre en CI de PR; sí en el nightly). Cómo correrlas y leer el informe: `docs/80-COMO-PROBAR.md` §10.

| TC | Spec | Qué recorre | Etiqueta |
|---|---|---|---|
| **TC-200** (nuevo, §4.14) | `tc-200-dia-del-evento.spec.ts` | Flujo maestro en serie (11 pasos): inscripción con foto + 2 acompañantes → aprobación en `/panel` → "Traer ahora" en `/admin` → reporte host → nube → QR digital READY del acompañante → lote PDF descargado → enrolar scanner con el código del panel → verde / anti-passback / salida / reingreso → acompañante rojo en T y verde en G → anulación con el scanner sin red → pendientes a 0 → QR anulado rojo → cierre de turno → auditoría verificada y reporte por puerta. | @smoke |
| TC-004, TC-006, TC-012 | `tc-006-menor-consentimiento.spec.ts` | Menor sin acudiente bloqueado campo a campo; aviso de privacidad obligatorio; API sin acudiente; edad fuera de categoría. | @smoke |
| TC-007 | `tc-007-cupo-lleno-lista-espera.spec.ts` | Cupo lleno → 409 → lista de espera por API y por formulario. | |
| TC-010, TC-013, TC-109 | `tc-010-013-109-panel-nube.spec.ts` | Liberar un cupo → correo con enlace de 48 h → confirmar; duplicados por documento → fusionar; CSV de aprobados con columnas esperadas; `GET /api/export` 401/200. | |
| TC-109 (rotación) | `zz-ultimo/tc-109-rotacion-clave-nube.spec.ts` | "Generar clave nueva": host con clave vieja → 503 (401 de la nube); host con la nueva trae y reporta. Corre al final porque deja la nube con otra clave. | |
| TC-016 | `tc-016-importacion-sportdata.spec.ts` | Importación idempotente desde `/panel/importar` (403 sin sesión; `/import` redirige). | |
| TC-105, TC-106, TC-107 | `tc-acompanantes-limite.spec.ts` | Límite de acompañantes por API y en el formulario. | |
| TC-023 | `tc-023-ingreso-valido.spec.ts` | Verde < 300 ms con foto/iniciales; zona no permitida. | |
| TC-025, TC-071 | `tc-071-025-revocacion.spec.ts` | Anulación con scanner sin red (verde, luego rojo); re-emisión invalida la versión anterior. | |
| TC-044 | `tc-044-modo-local.spec.ts` | Host apagado → pendientes → vuelve → 0 perdidos, 0 duplicados. | |
| TC-045, TC-062 | `tc-062-anti-passback.spec.ts` | Entrada / entrada (rojo) / salida / entrada con cambio de modo. | |
| TC-046, TC-066 | `tc-ingreso-manual-con-motivo.spec.ts` | ID con verificador, motivo del catálogo, excepción de supervisor con PIN. | |
| TC-049 | `tc-049-accesibilidad.spec.ts` | axe-core (WCAG A/AA) en formulario de inscripción y en Resultado verde/rojo + PIN del scanner; botones ≥ 48 px. | |
| TC-057, TC-058 | `tc-057-standby-promocion.spec.ts` | Standby replica (`lagSeconds`), 409 en escrituras, PROMOVER desde su panel, scanner cambia de host y escanea. | |
| TC-067 | `tc-067-firma-alterada.spec.ts` | Firma alterada, payload, otro evento, clave desconocida, malformado → todos rojos y en el log. | |
| TC-072, TC-076 | `tc-072-076-panel-admin-roles.spec.ts` | Matriz rol × página de `/admin` (carga / no se abre / 403 del host; Control e Inscriptor sin pantalla rota); rol `VOL` nuevo llega al scanner y decide por zona. | |
| TC-074, TC-080 | `tc-080-074-enrolamiento-y-pin.spec.ts` | Código inválido/usado, enrolamiento, 5 PIN incorrectos → bloqueo 15 min. | |
| TC-082 (parcial), RF-057 | `tc-zona-supervisor-y-host.spec.ts` | Cambio de zona con autorización del host; cambiar dirección del host. | |
| TC-085, TC-086, TC-087 | `tc-086-cierre-reporte-auditoria.spec.ts` | Reporte por puerta coherente, cadena de auditoría íntegra, backup. | |
| TC-092, TC-094 | `tc-094-backup-restauracion.spec.ts` | Copia desde Sistema → Verificar → `npm run restore -- <copia> --yes` en un host nuevo → mismos datos, PII legible, mismo QR. | |
| TC-100, TC-103 | `tc-100-qr-digital-rotativo.spec.ts` | Pantallazo vencido, dentro de tolerancia, en vivo; rol físico con rotativo. | |
| TC-S06 | `tc-s06-purga-90-dias.spec.ts` | Evento pasado + `TP_RETENTION_DAYS=0` → purga con doble confirmación → PII ausente, agregados y auditoría presentes, idempotente. | |
| **TC-120** (§4.15) | `tc-120-radio-voz.spec.ts` | Dos scanners (Chromium con micrófono falso) entran al canal Puertas; A pulsa para hablar → B ve "Radio A hablando", su RTCPeerConnection llega a `connected` con receptor de audio y bytes recibidos > 0; B pulsa mientras A habla → Ocupado; supervisor envía "Pausar ingreso" desde `/admin` › Radio → B la ve y acusa → `/admin` muestra "Radio B recibió"; proxy apagado → PTT en modo local y los bytes siguen subiendo; proxy arriba → presencia restablecida; `radio_ptt/order/ack` en el log. Capturas `design/screenshots/radio-*.png`. | @smoke |
| TC-P02 (corto), TC-P04 | `tc-p02-p04-rendimiento.spec.ts` | 500 escaneos por API p95 < 50 ms y 0 duplicados; snapshot de 2.000 credenciales < 2 s. | @perf |

Siguen **sin automatizar e2e** (manual o fuera del alcance de Chromium headless): TC-038/047/060 (cámara y PWA reales), TC-063/064 (dos scanners físicos; la alerta de duplicado se cubre en `simulate.ts`), TC-082 completo (el cambio de zona desde el panel no llega hoy al scanner: el snapshot no trae la zona del dispositivo, ver docs/80 §9), TC-083 (des-enrolar borra IndexedDB), TC-099 (rotación cada 60 s con reloj simulado: la página renueva cada 30 s), TC-S01..S05 y todo lo marcado Manual (LAB/SIM).

---

## 4. Casos de prueba por módulo

Formato compacto. Columnas: ID · RF · Título · Precondiciones · Pasos · Resultado esperado · Tipo · Prio. Los casos ★ se amplían en §5.

### 4.1 Inscripción online

| ID | RF | Título | Precondiciones | Pasos | Resultado esperado | Tipo | Prio |
|---|---|---|---|---|---|---|---|
| TC-001 | RF-001 | Inscripción individual desde móvil | Evento `nac2026` publicado; viewport 360×740 | 1. Abrir `/nac2026/inscripcion`. 2. Completar como individual rol `GEN`. 3. Enviar. | Confirmación con número de inscripción; sin scroll horizontal; < 5 min cronometrado. | Auto (Playwright) + Manual | P1 |
| TC-002 | RF-002 | Cuenta de club y aislamiento | Dos clubes A y B con inscripciones | 1. Login como inscriptor A. 2. Listar inscripciones. 3. Intentar abrir una de B por URL. | Solo ve A; la URL de B devuelve 403/404. | Auto | P1 |
| TC-003 | RF-003 | Campos obligatorios por rol | Formulario abierto | 1. Elegir rol `COMP`. 2. Dejar foto y fecha de nacimiento vacías. 3. Enviar. | Errores por campo bajo cada uno; los demás valores persisten; no se crea registro. | Auto | P1 |
| TC-004★ | RF-004 | Edad fuera de categoría | Evento inicia 2026-11-20 | Ver §5.1. | Bloqueo con categoría correcta sugerida. | Auto | P1 |
| TC-005 | RF-004 | Bordes de cálculo de edad (unit) | `packages/core` | Casos: cumple 10 el 2026-11-20 (día D), el 2026-11-21 (D+1), 29-feb nacimiento, categoría 36+. | Edad calculada a D; D+1 aún no cumple; sin errores de bisiesto. | Auto (Vitest) | P1 |
| TC-006★ | RF-005 | Menor sin consentimiento | Formulario; nacido 2012 | Ver §5.2. | No se puede enviar sin los 3 datos. | Auto | P1 |
| TC-007★ | RF-006 | Cupo lleno → lista de espera | Cupo `COACH` club = 2 | Ver §5.3. | Tercera queda `lista_espera`. | Auto | P1 |
| TC-008 | RF-007 | Concurrencia sobre cupo | Cupo categoría = 10 | 1. Lanzar 20 POST simultáneos (script). 2. Contar estados. | Exactamente 10 `inscrito`, 10 `lista_espera`; sin error 500. | Auto (integración) | P1 |
| TC-009 | RF-008 | Máquina de estados | Inscripción `inscrito` | 1. Intentar `inscrito`→`impreso` por API. 2. Hacer `inscrito`→`validado`→`aprobado`. | Paso 1: 422 con transiciones permitidas. Paso 2: ok con usuario, fecha y motivo en cada transición. | Auto | P1 |
| TC-010 | RF-009 | Aprobación en lote con notificación | 50 inscripciones `validado`; SMTP de prueba | 1. Seleccionar 50. 2. Aprobar. 3. Rechazar 1 sin motivo. 4. Rechazar 1 con motivo. | 50 pasan a `aprobado`; correo al inscriptor por club; paso 3 bloqueado; paso 4 ok. | Auto | P2 |
| TC-011 | RF-010 | Edición bloqueada tras aprobación | Inscripción `aprobado` | 1. Como inscriptor editar nombre. 2. Como coordinador editar nombre. | Paso 1: 403 + "Contacta a acreditación". Paso 2: ok y en log. | Auto | P2 |
| TC-012 | RF-011 | Política de datos obligatoria | Formulario | 1. Completar todo sin marcar política. 2. Enviar por UI. 3. Enviar por API sin el flag. | UI: botón deshabilitado. API: 422. Con flag: ok y timestamp de aceptación guardado. | Auto | P1 |
| TC-013 | RF-012 | Duplicados en cola | Dos inscripciones con mismo documento | 1. Ver cola "Duplicados". 2. Aprobar la primera. 3. Intentar aprobar la segunda. | Ambas en cola; paso 3 bloqueado hasta resolver (rechazar o fusionar). | Auto | P2 |
| TC-105 | RF-103 | Inscripción con 2 acompañantes | Formulario; `perParticipant = 2` | 1. Completar competidor. 2. Agregar 2 acompañantes (uno sin documento). 3. Enviar. | 3 inscripciones: 1 `COMP` + 2 `ACOMP` con `companionOf` del participante y mismo estado; confirmación lista los acompañantes. | Auto (API) + Manual | P1 |
| TC-106 | RF-104 | Contador y bloqueo del botón | Formulario; `perParticipant = 2` | 1. Agregar acompañante. 2. Ver contador. 3. Agregar otro. 4. Intentar un tercero. | Contador "1 de 2" → "2 de 2"; botón desactivado con "Este participante ya tiene 2 acompañantes, el máximo permitido". Con `perParticipant = null` muestra "sin límite". | Manual | P1 |
| TC-107 | RF-105 | Límites por API (unit + integración) | `packages/core`; `apps/registration` | 1. `validateCompanions` con límite por participante, total y aforo. 2. POST 3 acompañantes con límite 2. 3. POST con `companions.total` lleno. 4. POST con aforo lleno. | Unit: mensajes exactos y `allowed`. API: 400 con `errors.companions` y el mensaje correspondiente; `GET /api/status` refleja usados. | Auto (Vitest + API) | P1 |
| TC-108 | RF-106 | Acompañantes de una credencial en el host | Seed de 2.000 | 1. `GET /credentials/:id/companions` de un `COMP` con acompañantes. 2. De un id inexistente. | 200 con `companions[]` `ACOMP`, `count ≤ 2`, `limits`; sin `token`. Paso 2: 404. | Auto (Vitest) | P1 |

### 4.2 Importación SportData

| ID | RF | Título | Precondiciones | Pasos | Resultado esperado | Tipo | Prio |
|---|---|---|---|---|---|---|---|
| TC-014 | RF-013 | Carga de CSV y XLSX de 2.000 filas | Fixtures | 1. Subir CSV. 2. Subir XLSX. | Previsualización de 2.000 filas en < 10 s cada uno; codificación UTF-8/Latin-1 detectada. | Auto | P1 |
| TC-015 | RF-014 | Mapeo automático y guardado | Export con encabezados SportData | 1. Subir. 2. Verificar mapeo propuesto. 3. Guardar mapeo. 4. Subir archivo con columnas desordenadas. | Mapeo automático correcto; en paso 4 se reutiliza el guardado y se aplica por nombre de columna. | Auto | P1 |
| TC-016★ | RF-015 | Reimportación idempotente | Export de 500 filas | Ver §5.4. | 0 duplicados; actualizaciones aplicadas. | Auto | P1 |
| TC-017 | RF-016 | Transacción con filas erróneas | Export con 3 fechas inválidas | 1. Importar. 2. Revisar reporte. 3. Excluir las 3 y aplicar. | Nada aplicado hasta paso 3; reporte lista las 3 con fila y motivo; luego 497 creadas. | Auto | P1 |
| TC-018 | RF-017 | Edad en importación | Fila con 20 años en "Juvenil" | 1. Importar. | Fila marcada `error: edad` con categoría esperada; no se crea. | Auto | P1 |
| TC-019 | RF-018 | Vinculación online + SportData | Persona inscrita online por club | 1. Importar export que la contiene. | Un solo registro, `source=ambos`, sin credencial duplicada. | Auto | P2 |
| TC-020 | RF-019 | Importar en host sin internet | LAB con WAN desconectado | 1. Importar el mismo CSV en host. 2. Comparar con resultado en nube. | Mismos conteos y mismos IDs de persona. | Manual (LAB) | P2 |

### 4.3 Emisión y credencial

| ID | RF | Título | Precondiciones | Pasos | Resultado esperado | Tipo | Prio |
|---|---|---|---|---|---|---|---|
| TC-021 | RF-020 | Emisión en lote de 500 | 500 `aprobado` con foto | 1. Emitir lote. 2. Cronometrar. | < 30 s; 500 `emitido`; 500 tokens distintos. | Auto | P1 |
| TC-022 | RF-021 | Luhn mod 36 (unit) | `packages/core` | 1. Generar 10.000 IDs. 2. Validar. 3. Alterar un carácter en cada uno. | 10.000 válidos; 10.000 alterados inválidos; transposiciones adyacentes detectadas. | Auto (Vitest) | P1 |
| TC-023★ | RF-022, RF-039 | QR válido de extremo a extremo | Credencial emitida con `k1` | Ver §5.5. | Verde con nombre y foto. | Auto + Manual | P1 |
| TC-024 | RF-023 | Bundle de scanner sin clave privada | Host con claves | 1. Descargar paquete de sync de un scanner. 2. Buscar patrones de clave privada (PKCS8, "PRIVATE", longitud 64 bytes de seed). | Solo claves públicas presentes. | Auto | P1 |
| TC-025★ | RF-024, RF-067 | Re-emisión invalida la versión anterior | Credencial n=1 impresa | Ver §5.6. | QR n=1 rojo "Credencial reemplazada". | Auto + Manual | P1 |
| TC-026 | RF-025 | Propagación de revocación | 3 scanners conectados, 1 sin red | 1. Revocar en host. 2. Medir llegada a los 3. 3. Reconectar el cuarto. | < 5 s en conectados; el cuarto la recibe en el primer sync. | Auto (integración) + Manual | P1 |
| TC-027 | RF-026 | Elementos de la credencial física | Plantilla por defecto | 1. Generar credencial `COMP`. 2. Imprimir. 3. Verificar a 50 cm. | Todos los elementos presentes y legibles; QR 40 mm ± 1 mm; ID corto legible. | Manual | P1 |
| TC-028 | RF-027 | Plantilla editable por rol | Panel admin | 1. Cambiar color de `JUR`. 2. Guardar. 3. Ver previsualización. | Previsualización actualizada sin reinicio; cambio en log. | Auto | P2 |
| TC-029 | RF-028 | Rotación de claves `k1`→`k2` | Credenciales con `k1` | 1. Activar `k2`. 2. Emitir nueva. 3. Escanear ambas. 4. Retirar `k1`. 5. Escanear `k1`. | Pasos 3: ambas verdes. Paso 5: rojo "Credencial no válida". | Auto | P1 |
| TC-030 | RF-029 | Emisión sin foto bloqueada | `COMP` sin foto | 1. Emitir. | Error "Falta foto"; sin credencial. | Auto | P2 |
| TC-031 | RF-030 | Log de emisión | — | 1. Emitir una. 2. Consultar audit_log. | Registro `credential.issued` con usuario, id, n, k. | Auto | P2 |

### 4.4 Impresión

| ID | RF | Título | Precondiciones | Pasos | Resultado esperado | Tipo | Prio |
|---|---|---|---|---|---|---|---|
| TC-032★ | RF-031 | Lote de 500 a PDF e impresión física | 500 `emitido` | Ver §5.7. | PDF < 60 s; 500 páginas; impresión correcta. | Auto + Manual | P1 |
| TC-033 | RF-032 | Reimpresión sin cambio de versión | Credencial n=1 | 1. Reimprimir. 2. Decodificar QR. | Mismo token, mismo n; log `credential.reprinted`. | Auto | P1 |
| TC-034 | RF-033 | Entrega por escaneo | Credencial `impreso`; scanner en modo entrega | 1. Escanear. | Estado `entregado` con hora y operador. | Auto + Manual | P1 |
| TC-035 | RF-034 | Aviso de doble impresión | Lote ya `impreso` | 1. Repetir lote. | Diálogo "Ya impresas: N. ¿Reimprimir?"; sin confirmación no genera PDF. | Auto | P2 |
| TC-036 | RF-035 | Formatos A4 y tarjeta | — | 1. Generar en A4 (2 por hoja). 2. Generar en tarjeta. 3. Medir en visor PDF. | 100 × 150 mm exactos en ambos; guías de corte en A4. | Manual | P2 |
| TC-037 | RF-036 | Tablero de avance de entrega | Datos mixtos | 1. Abrir tablero. 2. Entregar una. | Conteos correctos y actualización en vivo < 5 s. | Auto | P3 |

### 4.5 Scanner offline-first

| ID | RF | Título | Precondiciones | Pasos | Resultado esperado | Tipo | Prio |
|---|---|---|---|---|---|---|---|
| TC-038 | RF-037 | PWA en modo avión | Scanner enrolado y sincronizado | 1. Activar modo avión. 2. Cerrar y abrir la app. 3. Escanear QR válido. | App abre, cámara activa, verde. | Manual | P1 |
| TC-039 | RF-038 | Copia local completa | Host con 2.000 credenciales | 1. Sync completo. 2. Inspeccionar IndexedDB. 3. Modo avión y escanear 20 al azar. | 2.000 registros con foto miniatura, reglas, revocaciones, claves públicas; 20 verdes. | Auto (Playwright) + Manual | P1 |
| TC-040 | RF-039 | Orden y motivo de validación (unit) | `packages/core` | 1. Probar un QR por cada fallo: formato, firma, fecha, versión, revocado, zona, anti-passback. | Cada uno devuelve su `reason` específico; el primer fallo corta la cadena. | Auto (Vitest) | P1 |
| TC-041 | RF-040 | Latencia de validación | Android 4 GB RAM; 2.000 credenciales locales | 1. Escanear 100 QR. 2. Leer `scan.duration_ms`. | p95 < 300 ms. | Manual + telemetría | P1 |
| TC-042 | RF-041 | Pantalla de resultado humana | — | 1. Escaneo verde. 2. Escaneo rojo por anti-passback. 3. Escaneo rojo por zona. | Foto, nombre, rol, zona; textos según `70-UX-WRITING.md` con instrucción de qué hacer; sin códigos crudos. | Manual | P1 |
| TC-043 | RF-042 | Sonido y vibración | Celular en bolsillo | 1. Provocar OK, NO, ALERTA. | Tres patrones distinguibles sin mirar la pantalla. | Manual | P2 |
| TC-044★ | RF-043 | 2 h sin red y reconciliación | Scanner enrolado | Ver §5.8. | 0 perdidos, 0 duplicados. | Carga + Manual | P1 |
| TC-045 | RF-044 | Modo entrada/salida | Supervisor | 1. Cambiar a salida. 2. Escanear. 3. Volver a entrada. | Cabecera cambia de color y texto; cada escaneo lleva `direction` correcto. | Auto + Manual | P1 |
| TC-046 | RF-045 | Ingreso manual por ID | Scanner | 1. Ingresar `TP-2026-00123-X` (verificador malo). 2. Ingresar `TP-2026-00123-C` sin motivo. 3. Con motivo. | 1: "ID incorrecto". 2: bloqueado. 3: escaneo `manual=true` con motivo. | Auto + Manual | P1 |
| TC-047 | RF-046 | Fallback ZXing en iOS | iPhone iOS 16.4+ | 1. Abrir PWA. 2. Escanear. | Lectura funciona sin configuración; log indica motor usado. | Manual | P1 |
| TC-048 | RF-047 | Indicador de sync | Host apagado | 1. Escanear 37 veces. 2. Observar indicador. 3. Encender host. | "Sin conexión · 37 pendientes" → "Conectado · 0 pendientes" sin intervención. | Manual | P1 |
| TC-049 | RF-048, RNF-016 | Accesibilidad y guantes | Celular 6,5"; guantes táctiles | 1. Lighthouse/axe. 2. Operar 10 escaneos con guantes y una mano. | Sin errores AA; botones ≥ 48 px; 10/10 completados. | Auto + Manual | P2 |
| TC-050 | RF-049 | Búsqueda local | Modo avión | 1. Buscar "Juan Per". | Resultados con foto en < 1 s. | Manual | P3 |

### 4.6 Host y sync

| ID | RF | Título | Precondiciones | Pasos | Resultado esperado | Tipo | Prio |
|---|---|---|---|---|---|---|---|
| TC-051 | RF-050, RNF-020 | Despliegue reproducible | Mini PC limpio | 1. `docker compose up`. 2. Abrir panel. 3. Repetir con `node dist/server.js`. | Operativo en < 2 min; panel en `https://host.tatamipass.co`; montaje completo < 30 min siguiendo `50-OPERACION.md`. | Manual (LAB) | P1 |
| TC-052 | RF-051, RNF-005 | Host sin internet | WAN desconectado | 1. Emitir local. 2. Imprimir. 3. Sync de 3 scanners. 4. Reporte. | Todo funciona; ningún error de red visible. | Manual (LAB) | P1 |
| TC-053 | RF-052 | Idempotencia `(device_id, seq)` | Host | 1. Enviar lote de 100 escaneos. 2. Reenviar 3 veces. 3. Enviar con huecos de seq. | 100 registros exactos; huecos quedan pendientes y se piden al dispositivo. | Auto (integración) | P1 |
| TC-054 | RF-053 | LWW de configuración | Dos sesiones de panel | 1. Cambiar zona del dispositivo X a 2 y, 1 s después, a 5. 2. Ver estado en scanner. | Zona 5 (última según reloj del host). | Auto (integración) | P2 |
| TC-055 | RF-054 | Latencia de sync en LAN | LAB | 1. Escanear. 2. Medir timestamp dispositivo vs host. | < 2 s. | Manual + Carga | P1 |
| TC-056 | RF-055 | Nube caída 1 h | Apagar nube (o bloquear DNS) | 1. Operar host y scanners 1 h. 2. Restaurar nube. | Sin errores visibles; reconciliación completa al volver. | Manual (LAB) | P1 |
| TC-057★ | RF-056, RNF-006 | Caída de primario y promoción de standby | Primario + standby replicando | Ver §5.9. | Standby operativo < 60 s con todos los datos. | Manual (LAB/SIM) | P1 |
| TC-058 | RF-057 | Reconexión automática de scanners | Tras TC-057 | 1. Observar scanners. | "Conectado" al standby < 90 s; pendientes subidos. | Manual | P1 |
| TC-059 | RF-058 | Deriva de reloj | Scanner con reloj manual | 1. Reloj +4 min, escanear QR digital. 2. Reloj +6 min. | 1: verde. 2: rojo "Reloj desincronizado"; tras sync NTP, verde. | Manual | P2 |
| TC-060 | RF-059 | HTTPS y cámara en LAN | CA instalada en Android e iOS | 1. Abrir PWA. 2. Permitir cámara. | Sin advertencias; cámara disponible en ambos. Repetir con certificado Let's Encrypt. | Manual | P1 |
| TC-061 | RF-060, RNF-022 | Panel en vivo y métricas | 3 scanners | 1. Apagar uno. 2. Ver tabla. 3. `GET /metrics`. | Desconexión reflejada < 30 s; métricas presentes. | Manual + Auto | P2 |
| TC-109 | RF-107 | Exportación de la nube | Registration con `TP_CLOUD_KEY`; 1 inscripción aprobada con 2 acompañantes | 1. `GET /api/export` sin header. 2. Con header. 3. Con `since = cursor` devuelto. | 1: 401. 2: `count = 1`, `companions.length = 2`, `cursor` ISO. 3: `count = 0`. | Auto (API) | P1 |
| TC-110 | RF-108 | Pull idempotente contra nube falsa | Host con `cloud.url` apuntando a Fastify falso | 1. Nube con 2 nuevas (1 con acompañante). 2. `POST /sync/cloud/pull`. 3. Repetir. 4. Cambiar club de una. 5. Pull. | 2: `created 2, companionsCreated 1`, 3 credenciales. 3: `received 0`, siguen 3. 5: `updated 1`, misma versión y mismo token. | Auto (Vitest) | P1 |
| TC-111 | RF-109 | Sin internet, sin config y scheduler | Host de prueba | 1. Nube responde 500 → pull. 2. Ver status. 3. Host sin `TP_CLOUD_URL` → pull. 4. `startScheduler` con intervalo 1 y dos `pull()` concurrentes. | 1: 503, `ok=false`. 2: `online=false`, mensaje "Sin conexión a la nube…". 3: 409 con mensaje que nombra `TP_CLOUD_URL`. 4: `nextRunAt` definido; ambos `pull()` devuelven el mismo resultado (no solapan). | Auto (Vitest) | P1 |

### 4.15 Tatami Radio (voz por la LAN, ADR-0010, docs/34)

| ID | RF | Título | Precondiciones | Pasos | Resultado esperado | Tipo | Prio |
|---|---|---|---|---|---|---|---|
| TC-120★ | RF-110 | Voz P2P entre dos scanners, ocupado, orden con acuse, host caído | Host + 2 scanners enrolados + supervisor en `/admin` | Ver §5.19. | Audio real P2P (bytes > 0), Ocupado, acuse visible en el panel, audio sobrevive al host caído, presencia vuelve. | Auto (e2e @smoke) | P1 |
| TC-121 | RF-110 | Arbitraje y cola | Host | 1. A `ptt-start`. 2. B `ptt-start`. 3. A `ptt-end`. | B recibe `ptt-busy` (posición 1) y luego `ptt-granted`; eventos `radio_ptt` con duración. | Auto (host, `ws`) | P1 |
| TC-122 | RF-111 | Emergencia interrumpe | Host, 2 scanners en Puertas, supervisor | 1. Supervisor habla en Emergencia. 2. A `ptt-start` en Puertas. 3. Entra C. 4. Supervisor suelta. | Todos reciben `emergency active`; A `ptt-busy` con el supervisor; C se entera al entrar; al soltar `active:false` y A puede hablar. Cliente: tono + vibración + salto de canal y vuelta a los 5 s. | Auto (host + scanner) | P1 |
| TC-123 | RF-112 | Permisos por rol y canal lleno | Host con `maxPerChannel: 2` | 1. CONTROL `join supervisores`. 2. Tercer scanner en Puertas. 3. CONTROL envía orden. | "Tu rol no puede entrar…", "El canal … está lleno", "Solo supervisores…". | Auto (core + host) | P1 |
| TC-124 | RF-113 | Config en caliente | Admin en `/admin` | 1. Añadir canal "Médico" y guardar. 2. Quitar el canal de emergencia y guardar. | 1: los conectados reciben `welcome` nuevo y pueden entrar. 2: 400 `radio.channels` "exactamente un canal de emergencia". | Auto (host) | P2 |
| TC-125 | RF-114 | Sin micrófono / sin host | Scanner con permiso denegado; proxy apagado | 1. Pulsar PTT sin micrófono. 2. Apagar host con A hablando. 3. Reconexión. | 1: "Sin micrófono: solo escuchas…". 2: PTT en "Hablando (sin host)", pista abierta, pares vivos siguen. 3: backoff 1→2→4 s, `join` + acuses pendientes, solo renegocia con quien no siga conectado. | Auto (scanner, dobles) | P1 |
| TC-126 | RNF | Dos celulares reales | Android + iPhone en la Wi-Fi de staff, HTTPS | `docs/80 §3.1`. | Latencia < 300 ms, sin eco con altavoz, iOS corta al bloquear pantalla (documentado), Android aguanta unos segundos. | Manual (LAB) | P1 |

### 4.7 Anti-passback y antifraude

| ID | RF | Título | Precondiciones | Pasos | Resultado esperado | Tipo | Prio |
|---|---|---|---|---|---|---|---|
| TC-062★ | RF-061 | Anti-passback básico | Scanner en zona T | Ver §5.10. | Segunda entrada roja con hora de la primera; tras salida, verde. | Auto + Manual | P1 |
| TC-063 | RF-062 | Anti-passback offline y entre dispositivos | 2 scanners en T | 1. Sin red: entrar 2 veces en el mismo scanner. 2. Con red: entrar en S1, luego en S2. | 1: segundo rojo. 2: S2 rojo (estado del host). | Manual | P1 |
| TC-064★ | RF-063 | QR fotocopiado en dos puertas | 2 scanners en puertas distintas | Ver §5.11. | Alerta en ambos scanners y panel. | Manual | P1 |
| TC-065 | RF-064 | Tiempo de gracia configurable | Gracia 30 s en G | 1. Entrar. 2. Re-escanear a los 10 s. 3. Re-escanear a los 40 s. | 2: verde (sin segundo registro de entrada). 3: rojo. | Auto (unit) + Manual | P2 |
| TC-066 | RF-065 | Override de supervisor | Rojo por anti-passback | 1. Como Control: buscar botón "Autorizar". 2. Como Supervisor: autorizar con PIN y motivo. | 1: no existe. 2: verde, `override_by` en escaneo y log. | Auto + Manual | P1 |
| TC-067★ | RF-066, RF-039 | QR con firma alterada | QR válido | Ver §5.12. | Rojo "Credencial no válida"; `reason=signature_invalid`. | Auto + Manual | P1 |
| TC-068 | RF-067 | Versión anterior en scanner (unit) | `packages/core` | 1. Verificar token n=1 con estado vigente n=2. | `reason=superseded`. | Auto (Vitest) | P1 |
| TC-069 | RF-068 | Reporte de incidencias por puerta | Día con rechazos, alertas, manuales, overrides | 1. Abrir reporte "Puerta 2, día 1". | Lista completa con hora, credencial, controlador, resultado; totales por tipo. | Auto | P2 |
| TC-070 | RF-069 | "Foto no coincide" | Escaneo verde | 1. Marcar. 2. Escanear la misma en otra puerta. | Incidencia creada; segundo escaneo rojo "En revisión"; supervisor puede liberar. | Manual | P2 |
| TC-071★ | RF-025, RF-062 | Revocada con scanner sin red | Scanner sin red | Ver §5.13. | Antes del sync: verde con alerta posterior; después: rojo. | Manual | P1 |

### 4.8 Roles y permisos

| ID | RF | Título | Precondiciones | Pasos | Resultado esperado | Tipo | Prio |
|---|---|---|---|---|---|---|---|
| TC-072 | RF-070 | Matriz rol × endpoint | 7 usuarios, uno por rol | 1. Ejecutar cada endpoint con cada rol. | Tabla de 7 × N coincide con la matriz de permisos; sin 500. | Auto (integración) | P1 |
| TC-073 | RF-071, RNF-009 | Argon2id | Base con usuarios | 1. Inspeccionar columna de hash. | Todos con prefijo `$argon2id$`; parámetros ≥ recomendados. | Auto | P1 |
| TC-074★ | RF-072 | PIN incorrecto 5 veces | Scanner enrolado | Ver §5.14. | Bloqueo 15 min + alerta. | Auto + Manual | P1 |
| TC-075 | RF-073 | Expiración de sesión | Reloj simulado | 1. Avanzar 12 h 1 min en scanner con 5 pendientes. 2. Panel 8 h inactivo. | Pide PIN; pendientes intactos; panel pide login. | Auto | P2 |
| TC-076 | RF-074 | Rol de acceso nuevo sin código | Panel admin | 1. Crear `VOL` con zonas G, S. 2. Emitir una credencial. 3. Escanear en G y en T. | Verde en G, rojo en T; sin reinicio. | Auto + Manual | P1 |
| TC-077 | RF-075, RF-002 | Aislamiento por club en API | Inscriptor A | 1. `GET /api/inscripciones?club=B`. | 403 o lista vacía. | Auto | P1 |
| TC-078 | RF-076 | Desactivar usuario | Usuario con sesión activa | 1. Desactivar. 2. Reintentar petición con su sesión. | 401 en < 1 min en nube y host. | Auto | P2 |

### 4.9 Enrolamiento

| ID | RF | Título | Precondiciones | Pasos | Resultado esperado | Tipo | Prio |
|---|---|---|---|---|---|---|---|
| TC-079 | RF-077 | Enrolamiento correcto | Panel: nuevo dispositivo rol Control, zona 3 | 1. Escanear QR. 2. Definir PIN. 3. Intentar reutilizar el QR en otro celular. | Dispositivo activo con rol/zona; paso 3 rechazado "ya usado". | Auto + Manual | P1 |
| TC-080★ | RF-078 | Token expirado | QR de 11 min | Ver §5.15. | Mensaje claro; sin enrolar. | Auto + Manual | P1 |
| TC-081 | RF-079 | Instalación de CA guiada | Android e iOS nuevos | 1. Seguir solo la guía del QR. | Enrolamiento completo sin soporte en ambos. | Manual | P1 |
| TC-082 | RF-080 | Cambio de zona desde panel | Dispositivo en puerta 2 | 1. Cambiar a 5. 2. Observar scanner. | Reflejado < 15 s; escaneos posteriores con zona 5. | Auto + Manual | P1 |
| TC-083 | RF-081, RNF-015 | Des-enrolar borra datos | Scanner con datos | 1. Des-enrolar desde panel. 2. Inspeccionar IndexedDB. 3. Intentar sync. | "Dispositivo retirado"; IndexedDB vacía; sync 401. | Auto (Playwright) | P1 |
| TC-084 | RF-082 | Nombre legible | — | 1. Enrolar con nombre "Puerta 3 · Tablet A". | Nombre en cabecera del scanner y en tabla del host. | Manual | P3 |

### 4.10 Auditoría y reportes

| ID | RF | Título | Precondiciones | Pasos | Resultado esperado | Tipo | Prio |
|---|---|---|---|---|---|---|---|
| TC-085 | RF-083, RNF-010 | Encadenado por hash (unit + integración) | `packages/core` + host | 1. Generar 1.000 registros. 2. Verificar. 3. Verificar que todos los tipos del PRD generan registro. | Cadena OK; cada tipo presente. | Auto | P1 |
| TC-086★ | RF-084 | Hash roto detectado | Base íntegra | Ver §5.16. | `BROKEN at seq=N`. | Auto + Manual | P1 |
| TC-087 | RF-085 | Reporte de ingresos | Escaneos de prueba | 1. Abrir reporte por zona/rol/puerta/hora. 2. Comparar con conteo SQL. | Coincide al 100 %. | Auto | P1 |
| TC-088 | RF-086 | Exportación firmada | Día 1 | 1. Exportar CSV y JSON. 2. Calcular hash. 3. Buscar en log. | Hash del archivo = `export.created.hash`. | Auto | P2 |
| TC-089 | RF-087 | Línea de tiempo por credencial | `TP-2026-00123-C` con historial | 1. Buscar. | Eventos ordenados desde inscripción hasta último escaneo. | Auto | P2 |
| TC-090 | RF-088 | Umbral de ocupación | Umbral G = 500 | 1. Simular 501 entradas netas. | Alerta ámbar en panel. | Auto | P3 |
| TC-091 | RF-089 | Reporte de consentimientos | Menores inscritos | 1. Generar. 2. Exportar. | Cada menor con acudiente y fecha; sin menores sin consentimiento. | Auto | P2 |

### 4.11 Backups y modo degradado

| ID | RF | Título | Precondiciones | Pasos | Resultado esperado | Tipo | Prio |
|---|---|---|---|---|---|---|---|
| TC-092 | RF-090 | Snapshots y retención | USB LUKS montado; 6 h de operación (o reloj acelerado) | 1. Listar snapshots. 2. `PRAGMA integrity_check` en cada uno. | 48 de 5 min + 6 horarios; todos `ok`. | Auto (reloj simulado) + Manual (LAB) | P1 |
| TC-093 | RF-091 | Replicación a standby y nube | Standby + internet intermitente | 1. Escanear. 2. Consultar standby. 3. Ver nube tras 1 h. | Standby < 10 s de retraso; nube tiene el último snapshot horario. | Manual (LAB) | P1 |
| TC-094★ | RF-092, RNF-006 | Corte total y restauración desde USB | Host con 3 h de datos | Ver §5.17. | Restauración < 10 min; 0 escaneos perdidos. | Manual (SIM) | P1 |
| TC-095 | RF-093 | PDF de modo degradado | 2.000 acreditados | 1. Generar "Puerta 1". | < 30 s; lista por rol con ID, nombre, miniatura; planilla en blanco adjunta. | Auto | P1 |
| TC-096 | RF-094 | Carga de planilla | Planilla con 30 filas | 1. Cargar por formulario. 2. Verificar cadena. | 30 escaneos `manual=true, source=planilla`; cadena OK. | Auto | P2 |
| TC-097 | RF-095 | Corte con escrituras en curso | Host en LAB | 1. Lanzar 50 escaneos/s. 2. Cortar energía del host (sin UPS) en medio. 3. Encender. | Arranque automático; `integrity_check` ok; escaneos confirmados a scanners presentes; no confirmados se reenvían. | Manual (LAB) | P1 |
| TC-098 | RF-096 | Alertas de UPS y USB | UPS con monitoreo; USB | 1. Desconectar UPS de la toma. 2. Desconectar USB. | Dos alertas en panel < 1 min. | Manual | P2 |

### 4.12 Credencial digital rotativa

| ID | RF | Título | Precondiciones | Pasos | Resultado esperado | Tipo | Prio |
|---|---|---|---|---|---|---|---|
| TC-099 | RF-097 | Rotación cada 60 s | Credencial `GEN` digital | 1. Capturar token. 2. Esperar 61 s. 3. Capturar. | Tokens distintos; `exp` avanza; firma válida en ambos. | Auto (Playwright, reloj simulado) | P1 |
| TC-100★ | RF-098 | QR digital expirado | Pantallazo de hace 6 min | Ver §5.18. | Rojo "Código vencido". | Auto + Manual | P1 |
| TC-101 | RF-099 | Revocación de digital | Credencial digital activa | 1. Revocar. 2. Escanear QR fresco. | Rojo "Credencial revocada". | Auto + Manual | P1 |
| TC-102 | RF-100 | Rotación sin internet | Celular del portador en modo avión | 1. Esperar 2 min. 2. Escanear. | QR sigue rotando; verde. | Manual | P1 |
| TC-103 | RF-101 | Solo `GEN` admite digital | Panel + API | 1. Intentar digital para `COMP`. | Opción ausente; API 422. | Auto | P2 |
| TC-104 | RF-102 | Legibilidad del QR digital | Gradería, luz real | 1. Escanear a 20 cm. | < 1 s. | Manual (SIM) | P3 |

### 4.13 Seguridad y privacidad (RNF)

| ID | RNF | Título | Pasos | Resultado esperado | Tipo | Prio |
|---|---|---|---|---|---|---|
| TC-S01 | RNF-007 | TLS 1.2+ | `testssl.sh` contra host y nube. | Sin TLS 1.0/1.1; sin cifrados débiles. | Auto | P1 |
| TC-S02 | RNF-008 | Cifrado en reposo | Dump SQLite y Postgres; buscar documentos y fechas de nacimiento conocidos. | No aparecen en claro. | Auto | P1 |
| TC-S03 | RNF-011 | Cadena de suministro | Pipeline CI. | `npm audit` sin altas/críticas; SBOM generado; `USER node` en imágenes. | Auto | P1 |
| TC-S04 | RNF-007 | Disco cifrado del host | `lsblk -f` / `fdesetup status`. | LUKS/FileVault activo. | Manual | P1 |
| TC-S05 | RNF-013 | Derecho de supresión | Solicitud de un inscrito. | Coordinador ejecuta supresión; datos personales eliminados, agregados conservados, log `person.erased`. | Auto | P2 |
| TC-S06 | RNF-014 | Purga a 90 días | Reloj simulado D+90. | Job ejecuta; solo datos agregados; reporte generado. | Auto | P2 |

### 4.14 Flujo maestro y escenarios de ecosistema

| ID | RF | Título | Precondiciones | Pasos | Resultado esperado | Tipo | Prio |
|---|---|---|---|---|---|---|---|
| TC-200 | RF-001, 005, 009, 020, 022, 025, 031, 039, 043, 044, 061, 077, 083, 085, 097, 103, 107, 108 | **Flujo maestro "día del evento"** | Nube, host (con panel) y scanner levantados; nube con `TP_SIGNING_KEY` del host y clave compartida | 1. Inscripción con foto y 2 acompañantes. 2. Coordinador aprueba en `/panel`. 3. Host "Traer ahora". 4. Acompañante abre `/credencial/<token>`. 5. Operador imprime lote en `/admin`. 6. Enrolar scanner con el código de `/admin`; inicio de turno. 7. Competidor: entrada, entrada, salida, entrada. 8. Acompañante digital en T y en G. 9. Anular desde `/admin` con el scanner sin red; 2 escaneos. 10. Vuelve el host; escanear el QR anulado; cerrar turno. 11. Auditoría y reporte por puerta. | 1: código `N26-…` y correo. 2: aprobada + correo con 2 enlaces digitales. 3: 1 nueva + 2 acompañantes; `lastReport.ok`, `applied = sent`. 4: `READY` con QR y ID corto; estado público "Credencial emitida". 5: PDF > 0 bytes, lote impreso. 6: scanner "zona T · Conectado". 7: `OK_PHOTO_CHECK, ANTI_PASSBACK, OK_EXIT, OK_PHOTO_CHECK`. 8: `ZONE_NOT_ALLOWED` en T, verde en G. 9: verde ×2, pendientes = 2. 10: pendientes = 0, `REVOKED`, resumen de turno. 11: "Registro íntegro hasta el número N", `CREDENTIAL_REVOKED` en la cadena, `byDevice` = decisiones del scanner, `lastSeq` = escaneos + eventos. | Auto (Playwright, @smoke) | P1 |

---

## 5. Casos de prueba detallados (obligatorios)

Cada caso incluye precondiciones, pasos, resultado esperado, tipo y prioridad. Los pasos marcados "sin red" se ejecutan con el scanner en modo avión o con el host apagado, según se indique.

### 5.1 TC-004 · Edad fuera de categoría — RF-004 · Auto · P1

**Precondiciones:** evento con `start_date=2026-11-20`; categorías por defecto.
**Pasos:**
1. Abrir el formulario, rol `COMP`.
2. Fecha de nacimiento `2010-05-01` (16 años a D).
3. Elegir categoría "Adulto (18–35)".
4. Intentar continuar.
5. Cambiar a "Juvenil (14–17)" y continuar.
6. Repetir con `2010-11-21` (cumple 16 el día después de D) y categoría "Infantil B (10–13)".
**Resultado esperado:** paso 4 bloquea con mensaje "Con 16 años la categoría es Juvenil (14–17)"; paso 5 continúa; paso 6 bloquea (tiene 15 a D, no 13). El envío directo por API con la combinación inválida devuelve 422.

### 5.2 TC-006 · Menor sin consentimiento — RF-005 · Auto · P1

**Precondiciones:** formulario; fecha de nacimiento `2012-03-10`.
**Pasos:**
1. Completar todos los campos; dejar sin marcar el checkbox de acudiente.
2. Intentar enviar.
3. Marcar el checkbox, dejar nombre del acudiente vacío; enviar.
4. Completar nombre, dejar documento vacío; enviar.
5. Completar los tres; enviar.
6. Enviar por API un menor sin bloque `guardian`.
**Resultado esperado:** pasos 2–4 bloqueados con error específico en el campo faltante; paso 5 crea la inscripción con `guardian.{name, document, consented_at}`; paso 6 responde 422. Un adulto no ve el bloque de acudiente.

### 5.3 TC-007 · Cupo lleno en inscripción — RF-006 · Auto · P1

**Precondiciones:** cupo `COACH` por club = 2; club "Cauca ITF" sin coaches.
**Pasos:**
1. Inscribir coach 1 y coach 2.
2. Inscribir coach 3.
3. Rechazar coach 1 como coordinador.
4. Ver estado de coach 3 y volver a inscribir coach 4.
**Resultado esperado:** paso 2 muestra "Cupo lleno" y ofrece lista de espera; aceptar deja a coach 3 en `lista_espera` sin contar para el cupo. Paso 3 libera un cupo; el coordinador puede promover a coach 3 (no es automático). Paso 4: coach 4 queda en lista de espera si coach 3 fue promovido. El cupo global y por categoría se prueba con la misma secuencia.

### 5.4 TC-016 · Reimportación SportData idempotente — RF-015 · Auto · P1

**Precondiciones:** `fixtures/sportdata-export.csv` (500 filas, 0 duplicados internos); mapeo guardado.
**Pasos:**
1. Importar y aplicar. Anotar conteo: creadas / actualizadas / error.
2. Importar el mismo archivo sin cambios.
3. Editar el archivo: cambiar la categoría de la fila 17 y el club de la fila 230; añadir 2 filas nuevas; importar.
4. Importar un archivo con la fila 17 duplicada (misma persona dos veces).
5. Contar `person` y `registration` con rol `COMP`.
**Resultado esperado:** paso 1: 500 creadas. Paso 2: 0 creadas, 0 actualizadas (o 500 "sin cambios"). Paso 3: 2 creadas, 2 actualizadas (la fila 230 cambia de club → nueva clave de dedupe: se reporta como "posible cambio de club" y requiere confirmación, no se duplica silenciosamente). Paso 4: el duplicado interno se reporta y se importa una sola vez. Paso 5: 502 registros, sin credenciales duplicadas.

### 5.5 TC-023 · QR válido de extremo a extremo — RF-022, RF-039 · Auto + Manual · P1

**Precondiciones:** credencial `00123` rol `COMP`, zonas G/W/T/P, vigencia 2026-11-20 a 22, n=1, k=`k1`, emitida en nube; host y scanner sincronizados; scanner en zona T, modo entrada; fecha del dispositivo dentro de vigencia.
**Pasos:**
1. (Auto) Decodificar el token: separar `TP1.`, payload, firma; verificar firma con la pública de `k1`.
2. (Auto) Comparar payload con `{v:1,e:"nac2026",c:"00123",r:"COMP",z:["G","W","T","P"],f:"2026-11-20",t:"2026-11-22",n:1,k:"k1"}`.
3. (Manual) Escanear el QR impreso con el scanner conectado.
4. (Manual) Repetir en modo avión.
5. (Manual) Escanear el mismo QR en un scanner de zona V (palco).
**Resultado esperado:** pasos 1–2 ok; pasos 3–4 verde "Adelante, <nombre>" con foto, rol, zona, en < 300 ms; escaneo registrado con `result=ok`. Paso 5: rojo "No puede entrar a Palco con esta credencial" (`reason=zone_not_allowed`).

### 5.6 TC-025 · QR de versión anterior re-emitida — RF-024, RF-067 · Auto + Manual · P1

**Precondiciones:** credencial `00123` n=1 impresa y en scanner; coordinador en host.
**Pasos:**
1. Re-emitir `00123` con motivo "pérdida".
2. Verificar en host: `credential.version=2`, `credential_version(n=1).revoked=true`, entrada en `revocation`.
3. Escanear el QR n=1 con scanner conectado.
4. Imprimir n=2 y escanear.
5. Poner un segundo scanner sin red **antes** del paso 1 y escanear n=1 en él; luego reconectar y escanear de nuevo.
**Resultado esperado:** paso 3: rojo "Credencial reemplazada. Pide la credencial nueva o llama al supervisor" (`reason=superseded`), < 5 s después de la re-emisión. Paso 4: verde. Paso 5: antes de reconectar, verde (aceptado; limitación documentada); al reconectar, el host marca ese escaneo como `post_hoc_invalid` y genera alerta al supervisor; el siguiente escaneo es rojo.

### 5.7 TC-032 · Impresión de lote de 500 — RF-031 · Auto + Manual · P1

**Precondiciones:** 500 credenciales `emitido` del rol `COMP` con foto; host en hardware real; impresora conectada.
**Pasos:**
1. En panel de impresión filtrar rol `COMP`, estado `emitido`, 500 resultados.
2. Generar PDF; cronometrar.
3. Abrir el PDF: contar páginas; medir 5 credenciales al azar (100 × 150 mm; QR 40 mm).
4. Decodificar el QR de las páginas 1, 250 y 500 y comparar con la base.
5. Imprimir 20 páginas en la impresora real; escanear las 20 con un scanner.
6. Verificar estado de las 500.
**Resultado esperado:** paso 2 < 60 s; paso 3: 500 páginas, dimensiones exactas, marcas de corte; paso 4: tokens coinciden; paso 5: 20/20 verdes al primer intento; paso 6: 500 en `impreso` y log `print.batch` con usuario, filtro y hash del PDF.

### 5.8 TC-044 · Scanner sin red 2 horas y reconciliación — RF-043 · Carga + Manual · P1

**Precondiciones:** scanner enrolado, 2.000 credenciales sincronizadas; host operativo.
**Pasos:**
1. Desconectar el scanner de la Wi-Fi (modo avión).
2. Durante 2 h realizar ≥ 400 escaneos (mezcla: 300 válidos, 40 anti-passback, 30 zona incorrecta, 20 revocados previos, 10 manuales); el guion puede acelerarse con `scripts/simulate.ts` en modo "device" para la parte automatizada.
3. Anotar `seq` final y conteo local pendiente.
4. Reconectar; cronometrar la sincronización.
5. En host: contar escaneos de ese `device_id`; comparar con el local.
6. Reenviar manualmente el lote (forzar re-sync).
7. Verificar que `presence` y reportes incluyen los escaneos con el timestamp del dispositivo (no el de llegada).
**Resultado esperado:** la app no muestra errores ni degrada latencia durante las 2 h; paso 4 < 30 s para el volumen; paso 5: conteos iguales, 0 perdidos; paso 6: 0 duplicados; paso 7: ordenamiento por timestamp de dispositivo y hash de cadena íntegro.

### 5.9 TC-057 · Host primario cae y se promueve el standby — RF-056, RF-057 · Manual (LAB/SIM) · P1

**Precondiciones:** primario y standby replicando (retraso < 10 s); 3 scanners conectados; IP flotante o DNS `host.tatamipass.co` configurado.
**Pasos:**
1. Verificar en standby el último `seq` por dispositivo.
2. Apagar el primario de golpe (desconectar energía).
3. Observar scanners: deben seguir escaneando en L1; realizar 10 escaneos por scanner.
4. En standby ejecutar `tatami promote`; cronometrar.
5. Observar reconexión de los 3 scanners; cronometrar.
6. Verificar en standby que los 30 escaneos del paso 3 llegaron.
7. Encender el primario; verificar que arranca como standby y replica desde el nuevo primario.
8. Verificar la cadena de hash en el nuevo primario.
**Resultado esperado:** paso 3: sin interrupción en puertas; paso 4 < 60 s; paso 5 < 90 s sin tocar los scanners; paso 6: 30/30; paso 7: el antiguo primario no acepta scanners ni emite hasta ser promovido de nuevo (evita split-brain); paso 8: OK. Log `host.promoted` con usuario y hora.

### 5.10 TC-062 · Anti-passback — RF-061 · Auto + Manual · P1

**Precondiciones:** scanner A en zona T modo entrada; scanner B en zona T modo salida; anti-passback activo en T sin gracia.
**Pasos:**
1. Escanear `00123` en A (entrada).
2. Escanear `00123` en A de nuevo, 2 min después.
3. Escanear `00123` en B (salida).
4. Escanear `00123` en A (entrada).
5. Repetir 1–4 con A en modo avión (solo A).
6. (Auto) Unit: motor de reglas con secuencia entrada/entrada/salida/entrada.
**Resultado esperado:** paso 2 rojo "Esta credencial ya entró a Tatamis a las HH:MM. Pide que salga y vuelva a escanear, o llama al supervisor" (`reason=antipassback`); paso 3 registra salida; paso 4 verde; paso 5 idéntico usando estado local; paso 6 devuelve `[ok, antipassback, ok, ok]`.

### 5.11 TC-064 · QR fotocopiado usado en dos puertas — RF-063 · Manual · P1

**Precondiciones:** fotocopia del QR de `00123`; scanner P1 en puerta 1 (zona G) y scanner P3 en puerta 3 (zona G), ambos conectados; panel de supervisor abierto.
**Pasos:**
1. Escanear el original en P1.
2. 40 s después, escanear la fotocopia en P3.
3. Observar P1, P3 y panel.
4. Repetir con 3 min de separación.
5. Repetir el paso 2 con P3 sin red y reconectar después.
**Resultado esperado:** paso 2 en P3: si anti-passback de G está activo, rojo por anti-passback; en ambos casos, ALERTA (sonido/vibración de alerta) "Esta credencial se escaneó en Puerta 1 hace 40 s" en P3 y notificación en P1 y panel con ambas puertas, hora y foto; alerta registrada en `alert`. Paso 4: sin alerta de duplicado (fuera de ventana de 2 min), pero anti-passback aplica. Paso 5: la alerta se genera al reconciliar (`alert.detected_at=sync`) y se notifica al supervisor.

### 5.12 TC-067 · QR con firma alterada — RF-066 · Auto + Manual · P1

**Precondiciones:** QR válido de `00123`; `fixtures/qr-attacks/`.
**Pasos:**
1. (Auto) Cambiar un carácter de la firma; verificar.
2. (Auto) Cambiar `r:"COMP"` por `r:"STAFF"` en el payload manteniendo la firma; verificar.
3. (Auto) Cambiar `e:"nac2026"` por otro evento con firma válida de ese evento; verificar.
4. (Auto) Firmar con una clave desconocida `k9`; verificar.
5. (Auto) Token con prefijo `TP2.` o sin estructura; verificar.
6. (Manual) Imprimir los 5 QR anteriores y escanearlos con y sin red.
**Resultado esperado:** todos rojos "Credencial no válida. Llama al supervisor" con `reason` = `signature_invalid` (1, 2), `wrong_event` (3), `unknown_key` (4), `malformed` (5); ninguno registra entrada; cada intento queda en el log de incidencias; comportamiento idéntico sin red.

### 5.13 TC-071 · Credencial revocada estando el scanner sin red — RF-025, RF-062 · Manual · P1

**Precondiciones:** credencial `00456` válida; scanner S1 en modo avión; S2 conectado.
**Pasos:**
1. Revocar `00456` en host con motivo "fraude confirmado".
2. Escanear `00456` en S2.
3. Escanear `00456` en S1 (sin red).
4. Reconectar S1; esperar sync.
5. Escanear `00456` en S1.
6. Revisar panel de alertas.
**Resultado esperado:** paso 2 rojo "Credencial revocada"; paso 3 verde (S1 no conoce la revocación — limitación aceptada de L1); paso 4 < 30 s; paso 5 rojo; paso 6: el host marca el escaneo del paso 3 como `post_hoc_invalid` y crea alerta "Ingreso con credencial revocada en Puerta X a las HH:MM" para que el supervisor actúe. El tiempo máximo de exposición queda documentado (= tiempo sin red del scanner).

### 5.14 TC-074 · PIN incorrecto 5 veces — RF-072 · Auto + Manual · P1

**Precondiciones:** scanner enrolado con PIN `482913`; panel de supervisor abierto.
**Pasos:**
1. Ingresar PIN incorrecto 4 veces; observar mensajes.
2. Ingresar el quinto incorrecto.
3. Intentar ingresar el PIN correcto durante el bloqueo.
4. Verificar panel.
5. Esperar 15 min (o avanzar reloj en test automatizado); ingresar PIN correcto.
6. Verificar que los escaneos pendientes anteriores al bloqueo siguen en IndexedDB.
**Resultado esperado:** paso 1: "PIN incorrecto. Te quedan N intentos"; paso 2: bloqueo con cuenta regresiva de 15:00; paso 3: rechazado sin reiniciar el contador; paso 4: alerta "Dispositivo Puerta 3 bloqueado por PIN" con hora; paso 5: acceso; paso 6: intactos. Log `device.pin_locked` y `device.pin_unlocked`. El supervisor puede desbloquear antes desde el panel (log `device.pin_unlocked_by`).

### 5.15 TC-080 · Enrolamiento con token expirado — RF-078 · Auto + Manual · P1

**Precondiciones:** panel genera QR de enrolamiento a las 10:00 (caduca 10:10).
**Pasos:**
1. A las 10:11, escanear el QR con un celular nuevo.
2. Generar un QR nuevo, escanearlo con éxito en celular A.
3. Escanear ese mismo QR en celular B.
4. (Auto) POST `/api/enroll` con token expirado, token usado, token inexistente.
**Resultado esperado:** paso 1: "Este código ya venció. Pide uno nuevo al supervisor"; sin dispositivo creado. Paso 3: "Este código ya fue usado". Paso 4: 410, 409, 404 respectivamente, sin filtrar información del token. Cada intento fallido en el log con IP/`device_id` tentativo.

### 5.16 TC-086 · Log de auditoría con hash roto detectado — RF-084 · Auto + Manual · P1

**Precondiciones:** base del host con ≥ 5.000 registros de auditoría íntegros; copia de trabajo (no la de producción).
**Pasos:**
1. `tatami audit verify` → anotar resultado.
2. Con `sqlite3`, modificar el campo `payload` del registro `seq=1234`.
3. `tatami audit verify`.
4. Restaurar; borrar el registro `seq=2000`.
5. `tatami audit verify`.
6. Verificar desde el panel (Auditor).
7. (Auto) Unit en `packages/core`: cadena de 100 con alteración en el 50.
**Resultado esperado:** paso 1 `OK (5.000 registros)`; paso 3 `BROKEN at seq=1234` (hash no coincide); paso 5 `BROKEN at seq=2001` (prev_hash no coincide; hueco en seq); paso 6 muestra el mismo resultado con el primer registro corrupto resaltado y alerta al auditor; paso 7 reporta índice 50. Una verificación fallida genera registro `audit.verify_failed` (al final de la cadena, sin reparar nada).

### 5.17 TC-094 · Corte de energía total y recuperación desde backup USB — RF-092, RF-095 · Manual (SIM) · P1

**Precondiciones:** host primario con ≥ 3 h de operación, USB LUKS con snapshots, standby **apagado** para forzar la vía USB; 3 scanners con ≥ 20 escaneos pendientes cada uno; UPS desconectado para el test.
**Pasos:**
1. Anotar: último snapshot en USB (hora), conteo de escaneos en host, `seq` por dispositivo.
2. Cortar la energía de host, router y switch simultáneamente.
3. Durante 10 min, hacer 10 escaneos por scanner (L1).
4. Restablecer energía. Simular que el disco del host no arranca: usar un segundo mini PC o portátil limpio.
5. Instalar host desde cero (`docker compose up`) y ejecutar `tatami restore <último snapshot>` con la passphrase LUKS; cronometrar desde paso 4.
6. Reconectar scanners; esperar reconciliación.
7. Comparar conteos: escaneos del paso 1 + 30 del paso 3 + pendientes previos.
8. `tatami audit verify`.
**Resultado esperado:** paso 5 < 10 min; paso 6 automático; paso 7: todos presentes, 0 duplicados; lo ocurrido entre el último snapshot y el corte (≤ 5 min) se recupera desde los scanners (los escaneos siguen en ellos hasta ser confirmados); paso 8 OK. Si hubo emisiones locales en esos ≤ 5 min, aparecen en el reporte de "posibles pérdidas" para re-emitir.

### 5.18 TC-100 · QR digital rotativo expirado — RF-098 · Auto + Manual · P1

**Precondiciones:** credencial `GEN` digital activa; scanner en zona G con reloj sincronizado.
**Pasos:**
1. Capturar pantallazo del QR a las 10:00:00.
2. Escanear el pantallazo a las 10:00:30.
3. Escanear el pantallazo a las 10:04:00.
4. Escanear el pantallazo a las 10:06:00.
5. Escanear la pantalla en vivo a las 10:06:10.
6. (Auto) Unit: tokens con `exp` a −4 min, −5 min, −6 min, +6 min.
**Resultado esperado:** pasos 2–3 verde (dentro de tolerancia ±5 min; anti-passback de G impide la segunda entrada si aplica); paso 4 rojo "Código vencido. Pide que actualice la pantalla"; paso 5 verde; paso 6: `ok, ok, expired, expired` (futuro fuera de tolerancia también rechazado, `reason=clock_skew`).

---

### 5.19 TC-120 · Tatami Radio de extremo a extremo — RF-110 · Auto (e2e @smoke) · P1

**Precondiciones**: host de pruebas con proxy controlable; Chromium con `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`; dos contextos de navegador (scanners "Radio A" en T y "Radio B" en W) y un tercero con el supervisor en `/admin`.

**Pasos**: 1. Enrolar A y B; esperar `connection: online` y canal `puertas` en ambos; abrir la píldora Radio. 2. A mantiene pulsado el PTT. 3. B mantiene pulsado mientras A habla; suelta. 4. Supervisor › Radio envía "Pausar ingreso" al canal Puertas; B toca Recibido. 5. Proxy apagado 1,5 s con A todavía hablando. 6. Proxy arriba; A suelta.

**Resultado esperado**: 2: A `data-ptt="talking"`, B muestra "Radio A hablando", `__tpRadioStats()` de B = `[{ state: 'connected', receivers: 1 }]` y `bytesReceived > 0`. 3: B "Ocupado" y vuelve a `idle`. 4: B ve la orden con `data-acked="no"`, tras Recibido `yes`; `/admin` muestra "Radio B recibió". 5: A `connection: reconnecting`, PTT "Hablando (sin host)", bytes recibidos por B siguen creciendo. 6: ambos `online:puertas`, B ve a A, bytes siguen creciendo, B "Nadie habla ahora"; `GET /radio/events` contiene `radio_ptt`, `radio_order`, `radio_ack`.

**Automatización**: `e2e/specs/tc-120-radio-voz.spec.ts` (≈ 13 s). Capturas: `design/screenshots/radio-01…04.png`.

## 6. Pruebas de rendimiento y de campo

### 6.1 Pruebas de carga (`scripts/simulate.ts`)

| ID | RNF/RF | Escenario | Parámetros | Umbral | Métrica reportada |
|---|---|---|---|---|---|
| TC-P01 | RNF-001, RF-040 | Validación local | 2.000 credenciales en IndexedDB; 1.000 validaciones aleatorias en Android 4 GB | p95 < 300 ms; p99 < 500 ms | `scan.duration_ms` percentiles |
| TC-P02 | RNF-002 | Pico de apertura | 8 dispositivos simulados × 40 escaneos/min × 60 min (= 19.200 escaneos; ×10 sobre el pico real de 4/min/puerta) | 0 errores; backlog de sync < 100 eventos en cualquier instante; CPU host < 70 % | escaneos/min, backlog, CPU, latencia WS |
| TC-P03 | RNF-003, RF-054 | Sync y reconciliación | (a) 1 escaneo → host en LAN; (b) 8 dispositivos acumulan 5.000 eventos sin red y reconectan a la vez | (a) < 2 s; (b) < 30 s | tiempo hasta `ack` |
| TC-P04 | RNF-004, RF-031 | PDF de 500 | Lote `COMP` con foto | < 60 s en hardware del host | tiempo de generación, tamaño del PDF |
| TC-P05 | RF-056 | Promoción bajo carga | TC-P02 en curso; apagar primario a los 30 min; promover | < 60 s promoción; 0 escaneos perdidos al final | eventos esperados vs recibidos |
| TC-P06 | RF-095 | Corte simulado | `simulate.ts --power-cut` mata el proceso host con SIGKILL cada 10 min durante TC-P02 | Base íntegra en cada arranque; 0 perdidos al final | `integrity_check`, conteo |

Se ejecutan en Fase 2 (primera vez), Fase 3 (regresión) y en el simulacro (TC-P01, P03 en hardware real).

### 6.2 Prueba de cobertura Wi-Fi (D−1 y simulacro)

Recorrer cada puerta y zona con un scanner mostrando RSSI y latencia al host; registrar en plano. Umbral: RSSI > −70 dBm y latencia < 200 ms en cada puerta; de lo contrario reubicar repetidor/mesh. No bloquea (L1 funciona sin red) pero se registra como riesgo.

### 6.3 Prueba de impresora y consumibles

Imprimir 50 credenciales en la impresora del evento con el papel/tarjeta definitivos; verificar lectura del QR al primer intento ≥ 98 % y resistencia a doblez/humedad básica.

### 6.4 TC-U01 · Usabilidad con voluntarios — RNF-017, RNF-018 · Manual · P1

5 voluntarios sin contacto previo con la app; 15 min de capacitación con el manual `60-MANUALES` del rol Control. Tareas: (1) desbloquear con PIN, (2) escanear y dejar pasar, (3) interpretar un rojo por anti-passback y decir qué hacer, (4) registrar una salida, (5) ingreso manual por ID, (6) llamar al supervisor ante alerta. Criterio: ≥ 90 % de tareas completadas sin ayuda; cada frase en pantalla entendida al primer intento (preguntar "¿qué harías?").

### 6.5 Smoke test de D−1 (PROD)

1. Host primario y standby arrancan; `tatami audit verify` OK; USB montado; UPS cargado.
2. Un scanner por puerta + 1 reserva enrolados; cada uno escanea una credencial de prueba de cada rol (verde/rojo esperado según zona).
3. Promover standby y volver a promover primario (fuera de hora pico).
4. Cobertura (§6.2).
5. Impresión de 5 credenciales de prueba.
6. Revocar y re-emitir una credencial de prueba; verificar en 2 scanners.
7. Borrar credenciales de prueba y confirmar `audit verify` OK.

---

## 7. Simulacro de evento (D−7)

**Objetivo:** validar en condiciones reales que el sistema, el hardware y las personas funcionan juntos, con fallos inyectados, y obtener la decisión go/no-go.

**Fecha:** 13 de noviembre de 2026 (D−7, con D=20 nov; se recalcula si cambia P1 del PRD). **Duración:** 2 h de ejecución + 30 min de montaje + 30 min de cierre. **Lugar:** la sede del evento o un pabellón equivalente con 4 puertas marcadas (de las hasta 8 del evento) y zonas G, W, T delimitadas con cinta.

### 7.1 Participantes y roles

| Rol en el simulacro | Quién | Cantidad |
|---|---|---|
| Director del simulacro (inyecta fallos, cronometra, decide go/no-go) | Jhoan | 1 |
| Administrador del evento | Jhoan o delegado | 1 |
| Coordinador de acreditación | Persona de la federación | 1 |
| Operador de impresión | Voluntario | 1 |
| Supervisores de puerta | Voluntarios con experiencia | 2 |
| Controladores de entradas | Voluntarios de clubes | 4 (+2 reserva) |
| Auditor | Persona de la federación | 1 |
| "Público" | Voluntarios con credenciales de prueba, o 200 credenciales impresas repartidas entre 20–30 personas que pasan varias veces | 200 credenciales / ≥ 20 personas |
| "Atacantes" | 2 voluntarios con `fixtures/qr-attacks/` impresos y fotocopias | 2 |
| Observadores (anotan tiempos, confusión, errores) | 2 | 2 |

### 7.2 Material

- Host primario (mini PC) + UPS + router/mesh + switch; host standby (portátil con batería) en otro punto.
- 6 scanners enrolados (4 puertas + 2 reserva), power banks.
- 200 credenciales impresas de prueba: 120 COMP, 30 COACH, 20 GEN físicas, 10 GEN digitales (en celulares de voluntarios), 10 JUR, 5 STAFF, 5 VIP; 20 de ellas revocadas o re-emitidas durante el guion.
- 50 QR fraudulentos impresos (firma alterada, versión anterior, evento ajeno, vencidos) + 10 fotocopias de credenciales válidas.
- Listas de modo degradado y planillas impresas por puerta.
- USB LUKS de backup; cronómetros; hojas de observación; este documento.

### 7.3 Guion (T = inicio)

| Tiempo | Actividad | Escenario inyectado | Qué se mide / TC |
|---|---|---|---|
| T−30 | Montaje: red, hosts, enrolamiento de 6 scanners (uno con QR de enrolamiento vencido a propósito), smoke test. | Token expirado | TC-080, TC-079, TC-081, cobertura §6.2 |
| T+0 | Apertura de puertas. Las 200 credenciales entran por 4 puertas (zona G) lo más rápido posible. | — | Tiempo total de ingreso (meta: 200 en ≤ 15 min con 4 puertas), p95 de latencia (TC-P01), TC-023 |
| T+10 | Atacantes intentan entrar con 20 QR fraudulentos mezclados en las filas. | Fraude | TC-067: 0 aceptados |
| T+15 | 60 competidores pasan de G a W y luego a T; 10 intentan entrar a T dos veces seguidas; 10 GEN intentan entrar a T. | Anti-passback, zona | TC-062, TC-023 paso 5 |
| T+25 | Dos atacantes usan fotocopias de 5 credenciales válidas en puertas distintas con < 2 min de diferencia. | Duplicado | TC-064: 5 alertas en panel |
| T+30 | **Corte de Wi-Fi** en puertas 3 y 4 (apagar repetidor) durante 20 min. Las puertas siguen operando. | Sin red | TC-044 (versión corta), TC-048 |
| T+35 | Coordinador revoca 10 credenciales y re-emite 5 (impresión individual y entrega). Atacantes usan las revocadas y las versiones anteriores en todas las puertas, incluidas las sin red. | Revocación offline | TC-025, TC-026, TC-071, TC-033 |
| T+45 | Un controlador bloquea su scanner con 5 PIN incorrectos; el supervisor desbloquea desde el panel; otro scanner se cambia de puerta 2 a puerta 4 desde el panel. | PIN, cambio de zona | TC-074, TC-082 |
| T+50 | Reconectar Wi-Fi de puertas 3 y 4; medir reconciliación. | Reconciliación | TC-044 paso 4–7 |
| T+55 | **Caída del host primario** (desconectar energía sin UPS). Promover standby. | Caída de host | TC-057, TC-058 |
| T+65 | Operación normal con standby como primario durante 15 min; salidas y re-ingresos por puerta 1 (modo salida). | — | TC-045, TC-062 pasos 3–4 |
| T+70 | 10 personas sin QR legible (credencial "dañada"): ingreso manual por ID con motivo; 5 con dígito verificador incorrecto. | Manual | TC-046 |
| T+80 | **Corte total de energía** (host nuevo, router, switch) durante 10 min; puertas en L1; una puerta pasa a modo degradado con planilla de papel a propósito. | Corte total | TC-094 (restauración desde USB en un portátil limpio), TC-095, TC-096 |
| T+95 | Energía restablecida; restaurar desde USB; reconectar scanners; cargar planilla; `tatami audit verify`. | Recuperación | TC-094 pasos 5–8, TC-086 paso 1 |
| T+105 | Reportes: ingresos por zona/puerta, incidencias por puerta, trazabilidad de 3 credenciales, exportación firmada. Auditor verifica. | — | TC-087, TC-069, TC-089, TC-088 |
| T+120 | Fin. Cierre: encuesta rápida a controladores (6 preguntas), observaciones, decisión go/no-go. | — | TC-U01 |

### 7.4 Métricas del simulacro

| Métrica | Meta | Cómo |
|---|---|---|
| Ingreso de 200 por 4 puertas | ≤ 15 min | Cronómetro desde T+0 hasta el último ingreso |
| p95 latencia de validación | < 300 ms | Telemetría |
| QR fraudulentos aceptados | 0 de ≥ 50 | Conteo de atacantes vs log |
| Alertas de duplicado detectadas | 5 de 5 | Panel |
| Escaneos perdidos tras cortes | 0 | Conteo scanners vs host |
| Promoción de standby | < 60 s | Cronómetro |
| Restauración desde USB | < 10 min | Cronómetro |
| Cadena de auditoría | OK al final | `tatami audit verify` |
| Tareas de controladores sin ayuda | ≥ 90 % | Observadores |
| Defectos P1 encontrados | 0 abiertos al go-live | Registro de defectos (§9) |

### 7.5 Checklist de salida go/no-go

Go requiere **todos** los ítems en verde. Un ámbar en ítems marcados (†) permite "go condicional" con plan de corrección antes de D−2.

| # | Ítem | Verde | Ámbar | Rojo |
|---|---|---|---|---|
| 1 | Validación offline (TC-023, TC-038) | Todos los scanners validan sin red | — | Alguno no valida sin red |
| 2 | Fraude (TC-067, TC-025, TC-064) | 0 aceptados; alertas de duplicado 5/5 | † 1 alerta tardía por red | ≥ 1 QR fraudulento aceptado |
| 3 | Anti-passback (TC-062) | Correcto con y sin red | — | Falla en algún caso |
| 4 | Reconciliación (TC-044) | 0 perdidos, 0 duplicados, < 30 s | † > 30 s pero completa | Pérdida o duplicados |
| 5 | Promoción de standby (TC-057) | < 60 s, scanners reconectan solos | † < 3 min | No se promueve o scanners no reconectan |
| 6 | Restauración desde USB (TC-094) | < 10 min, 0 perdidos | † < 20 min | Falla o pérdida |
| 7 | Auditoría (TC-086) | Cadena OK al cierre | — | Cadena rota |
| 8 | Impresión y entrega (TC-032, TC-033) | 500 < 60 s; QR legibles ≥ 98 % | † 90–98 % | < 90 % |
| 9 | Latencia (TC-P01) | p95 < 300 ms | † < 500 ms | ≥ 500 ms |
| 10 | Ingreso de 200 por 4 puertas | ≤ 15 min | † ≤ 20 min | > 20 min |
| 11 | Usabilidad (TC-U01) | ≥ 90 % | † 75–90 % con ajustes de UX writing | < 75 % |
| 12 | Cobertura Wi-Fi (§6.2) | Todas las puertas > −70 dBm | † 1 puerta débil con plan | ≥ 2 puertas sin red (operación L1 permanente) |
| 13 | Hardware (UPS, USB, impresora, power banks) | Todo probado y cargado | — | Falta algún elemento |
| 14 | Defectos | 0 P1 abiertos | † P2 con fecha ≤ D−2 | ≥ 1 P1 abierto |
| 15 | Config congelada (`event.config.json`, roles, zonas, categorías, puertas) | Firmada por federación | — | Cambios pendientes |
| 16 | Datos personales (TC-S02, TC-S04, política publicada, consentimientos de menores completos) | Verde | — | Algún menor sin consentimiento o campo en claro |

---

## 8. Criterios de aceptación de release

Un release (candidato a go-live) se acepta cuando:

1. **CI verde:** Vitest con cobertura 100 % en `packages/core`; integración host completa; Playwright de los flujos de PRD §9; `npm audit` sin altas/críticas; SBOM generado.
2. **Todos los TC de prioridad P1 en verde**, con y sin red donde aplique; P2 en verde o con defecto aceptado y fecha; P3 pueden quedar abiertos.
3. **Pruebas de carga** TC-P01..P06 dentro de umbral en el hardware del host.
4. **Simulacro** con checklist §7.5 en go o go condicional cumplido antes de D−2.
5. **Cero defectos P1 abiertos**; ningún defecto P2 relacionado con fraude, pérdida de datos o privacidad.
6. **Documentación operativa** (`50-OPERACION.md`, `60-MANUALES`) revisada en el simulacro por quien la usará.
7. **Backups verificados:** restauración real ejecutada al menos una vez en el hardware del evento (TC-094).
8. **Config congelada** y claves de firma del evento generadas, respaldadas y distintas de las de prueba (TC-024 ejecutado contra el bundle de producción).

Smoke test de D−1 (§6.5) es condición para abrir puertas el día D.

---

## 9. Plantilla de reporte de defectos

Registrar en el tracker del repositorio (issue) con la etiqueta `defecto` y el ID `DEF-nnn`.

```
DEF-nnn · <título corto en una línea>

Severidad:      P1 bloqueante / P2 alta / P3 media
Módulo:         inscripción | sportdata | emisión | impresión | scanner | host | antifraude | roles | enrolamiento | auditoría | backups | digital
RF afectado:    RF-xxx
TC que falló:   TC-xxx (paso N)
Entorno:        DEV | LAB | SIM | PROD · versión/commit · dispositivo (modelo, SO, navegador) · con red / sin red
Fecha y hora:   AAAA-MM-DD HH:MM · quien lo encontró

Precondiciones:
  <estado inicial exacto: credencial, zona, modo, dispositivos>

Pasos para reproducir:
  1.
  2.
  3.

Resultado obtenido:
  <qué pasó; adjuntar captura, log del scanner (exportar desde Ajustes → Diagnóstico), extracto de audit_log>

Resultado esperado:
  <según el CA del RF>

Impacto en el evento:
  <qué pasaría en una puerta real si no se corrige>

Reproducible:   siempre / a veces (N de M) / una vez
Workaround:     <si existe, para operación>
Asignado a:     
Estado:         nuevo → confirmado → en corrección → corregido → verificado (TC re-ejecutado en <fecha>) → cerrado
```

Reglas: un defecto P1 encontrado en el simulacro se corrige y re-verifica con el mismo TC en LAB antes de D−2; si no se logra, el ítem del checklist §7.5 queda en rojo y no hay go.

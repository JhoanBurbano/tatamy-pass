# Plantilla · Acta de simulacro (D−7)

> El simulacro es obligatorio 7 días antes del evento ([00-DECISIONES §10](../00-DECISIONES.md)). El guion minuto a minuto, los participantes y el material están en [20-RF-TEST §7](../20-RF-TEST.md); esta acta registra lo que pasó y la decisión go/no-go. Se firma el mismo día.

## 1. Datos

| Campo | Valor |
|---|---|
| **Evento** | Campeonato Nacional de Taekwondo ITF 2026 (`nac2026`) |
| **Fecha y lugar del simulacro** | AAAA-MM-DD · coliseo / salón |
| **Versión probada** | `vX.Y.Z` (etiqueta git) · commit `abc1234` |
| **Hora de inicio / fin** | HH:MM – HH:MM |
| **Responsable** | Coordinador de acreditación |
| **Participantes** | Técnico, N supervisores, N porteros (nombres), N "público" voluntario |

## 2. Montaje verificado antes de empezar

- [ ] Host principal con `/health` verde, hora correcta (chrony), disco cifrado.
- [ ] Equipo de respaldo replicando (`lagSeconds` ≤ 10).
- [ ] Red de staff: SSID oculto, RSSI por puerta anotado abajo.
- [ ] N scanners enrolados, PIN probado, certificado instalado, power bank conectado.
- [ ] Lote de credenciales de prueba impreso (≥ 50, con ≥ 5 fotocopias para la prueba de fraude).
- [ ] Sobres de modo degradado por puerta (lista + planilla).
- [ ] USB cifradas A y B montadas; copia inicial verificada.

## 3. Cobertura Wi-Fi por puerta

| Puerta | Zona | Nodo más cercano | RSSI (dBm) | Veredicto (≥ −65 excelente · ≤ −75 no aceptable) |
|---|---|---|---|---|
| | | | | |

## 4. Guion ejecutado (T = inicio)

Marca cada paso con la hora real y el resultado. Guion completo en [20 §7.3](../20-RF-TEST.md).

| T | Paso | Esperado | Hora real | Resultado | Observación |
|---|---|---|---|---|---|
| T+0 | Apertura: ingreso de 200 personas por 4 puertas | ≤ 15 min | | | |
| T+20 | QR fotocopiado en dos puertas | Ámbar en la 2.ª, alerta en el panel | | | |
| T+30 | Apagar el router principal 10 min | Scanners en modo local, pendientes suben, nadie se detiene | | | |
| T+40 | Encender el router | Pendientes a 0 en < 30 s; host sin duplicados | | | |
| T+50 | Apagar el host principal | Respaldo promovido en < 60 s; scanners reconectan solos | | | |
| T+65 | Restaurar desde USB en el portátil de panel | < 10 min, conteos coinciden | | | |
| T+80 | Lote de 500 credenciales PDF | < 60 s; muestra de 20 QR legibles | | | |
| T+90 | Cierre: `audit verify`, reporte de cierre, resumen de turnos | Cadena OK; totales coherentes | | | |

## 5. Métricas ([20 §7.4](../20-RF-TEST.md))

| Métrica | Objetivo | Medido |
|---|---|---|
| p95 validación en scanner | < 300 ms | |
| Reconciliación tras corte | < 30 s, 0 perdidos, 0 duplicados | |
| Promoción del respaldo | < 60 s | |
| Restauración desde USB | < 10 min | |
| Ingreso de 200 por 4 puertas | ≤ 15 min | |
| Usabilidad (porteros que completan las 5 tareas sin ayuda) | ≥ 90 % | |
| Batería de scanner en 1 h | ≤ 10 % | |

## 6. Defectos encontrados

| ID | Título | Severidad | TC | Estado al cierre del acta |
|---|---|---|---|---|
| DEF-nnn | | P1/P2/P3 | TC-xxx | nuevo / en corrección / corregido |

## 7. Decisión go / no-go ([20 §7.5](../20-RF-TEST.md))

| # | Ítem | Verde / Ámbar / Rojo | Nota |
|---|---|---|---|
| 1 | Validación offline | | |
| 2 | Fraude | | |
| 3 | Anti-passback | | |
| 4 | Reconciliación | | |
| 5 | Promoción del respaldo | | |
| 6 | Restauración desde USB | | |
| 7 | Auditoría | | |
| 8 | Impresión y entrega | | |
| 9 | Latencia | | |
| 10 | Ingreso de 200 por 4 puertas | | |
| 11 | Usabilidad | | |
| 12 | Cobertura Wi-Fi | | |
| 13 | Hardware | | |
| 14 | Defectos (0 P1 abiertos) | | |
| 15 | Config congelada y firmada | | |
| 16 | Datos personales | | |

**Decisión**: ☐ GO · ☐ GO condicional (plan de corrección antes de D−2: …) · ☐ NO-GO (qué falta y nueva fecha de simulacro: …)

## 8. Firmas

| Rol | Nombre | Firma |
|---|---|---|
| Coordinador de acreditación | | |
| Técnico | | |
| Representante de la federación | | |

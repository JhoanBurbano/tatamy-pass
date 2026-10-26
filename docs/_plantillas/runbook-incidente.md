# Plantilla · Runbook de incidente

> Copia este archivo como `incidentes/AAAA-MM-DD-HHMM-titulo.md` (o pégalo en el chat del comité) y llénalo **mientras** atiendes el incidente, no después. Un incidente = una cosa que impide o degrada el control de accesos. Los runbooks ya escritos para los casos conocidos están en [40-SEGURIDAD §8](../40-SEGURIDAD-ISO27001.md) y [50-OPERACION §11](../50-OPERACION.md); este formato sirve para los que no estaban previstos y para dejar evidencia.

## 1. Identificación

| Campo | Valor |
|---|---|
| **ID** | INC-AAAA-MM-DD-nn |
| **Título** | Una línea: qué se ve ("Puerta T1 sin conexión desde las 9:40") |
| **Detectado** | AAAA-MM-DD HH:MM · por quién · cómo (alerta del panel, portero avisó, supervisor lo vio) |
| **Severidad** | **S1** se detiene una puerta o la emisión · **S2** se degrada (pendientes crecen, latencia, una función falla) · **S3** molestia sin impacto en la fila |
| **Zona / puertas afectadas** | |
| **Responsable del incidente** | Quien coordina hasta cerrar (normalmente el Supervisor de la zona o el Técnico) |

## 2. Contención (primeros 5 minutos)

Objetivo: que la fila siga moviéndose. El scanner valida solo (L1): **nunca** se detiene una puerta por falta de red o de host.

- [ ] La puerta sigue operando en modo local ("Sin conexión · modo local" en el scanner) o pasó a planilla (modo degradado, [50 §8](../50-OPERACION.md)).
- [ ] Supervisor informado · Técnico informado · Coordinador informado (si afecta emisión o credenciales).
- [ ] Hora de contención: HH:MM.

## 3. Diagnóstico

Qué se revisó, en orden, con el resultado de cada paso (copia la salida exacta):

| # | Qué revisé | Comando / acción | Resultado |
|---|---|---|---|
| 1 | Salud del host | `curl -sk https://<host>/health \| jq '{ok,mode,devices,audit}'` | |
| 2 | Panel › Puertas en vivo: estado del dispositivo | | |
| 3 | Cobertura Wi-Fi en la puerta (RSSI) | WiFiman / WiFi Analyzer | |
| 4 | Pendientes por enviar en el scanner | Pantalla del scanner | |
| 5 | Equipo de respaldo | `curl -sk https://<standby>/health \| jq '{role,lagSeconds}'` | |
| 6 | Últimas líneas del log | `docker compose logs --tail 100 host` | |

**Causa probable**: …

## 4. Corrección

| Hora | Acción | Quién | Resultado |
|---|---|---|---|
| HH:MM | | | |

Si se promovió el respaldo: anotar `PROMOVER` por quién y a qué hora; **no** volver a encender el principal viejo como principal.

## 5. Verificación de que quedó bien

- [ ] Scanner de la puerta en verde, pendientes = 0 en ≤ 15 s tras un escaneo de prueba (credencial de staff).
- [ ] `GET /health` → `ok: true`, `audit.ok: true`.
- [ ] Panel › Alertas: la alerta "sin conexión" resuelta con nota.
- [ ] Si hubo planilla: capturada en el scanner con motivo "Planilla (modo degradado)" ([50 §8.3](../50-OPERACION.md)).

## 6. Cierre

| Campo | Valor |
|---|---|
| **Hora de cierre** | HH:MM · duración total |
| **Impacto** | Personas afectadas, minutos de fila extra, ingresos manuales generados |
| **Causa raíz** | Una frase honesta |
| **Qué cambia para que no se repita** | Acción, responsable, fecha (abrir defecto `DEF-nnn` con la [plantilla](./reporte-defecto.md) si es del software) |
| **Evidencia** | Capturas, extracto de auditoría (`GET /audit?action=…`), fotos del montaje |

Firma del responsable del incidente: ______________________

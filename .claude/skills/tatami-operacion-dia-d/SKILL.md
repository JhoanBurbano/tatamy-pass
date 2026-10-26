---
name: tatami-operacion-dia-d
description: Runbook del día D y del simulacro de Tatami Pass, resumido y accionable (docs/50, 40 §8, 60, 90 §9–10): qué revisar a cada hora, qué hacer ante cada incidente y quién decide. Úsala para responder preguntas de operación en vivo, preparar el checklist diario o redactar un incidente. Solo guía; nunca toma decisiones de acceso.
---

# Operación del día D

Fuentes completas: `docs/50-OPERACION.md` (runbook), `docs/40-SEGURIDAD-ISO27001.md` §8 (incidentes de seguridad), `docs/60-MANUALES-POR-ROL.md` (qué hace cada persona), `docs/90-MONTAJE-ECOSISTEMA.md` §9–10, plantillas en `docs/_plantillas/` (checklist día D, incidente, acta de simulacro, defecto).

## Regla de oro

**La puerta nunca se detiene** por falta de red, host o nube. Orden de degradación: scanner en modo local (sigue validando con su copia) → planilla de papel del sobre sellado (solo si no hay scanner ni reserva) → captura en el scanner después con motivo "Planilla (modo degradado)".

## Quién decide qué

| Decisión | Quién | Dónde |
|---|---|---|
| Dejar pasar con pantalla roja o ámbar | **Supervisor de puerta** (PIN en el scanner → Autorizar excepción con motivo) | Scanner |
| Anular o re-emitir una credencial | Coordinador (o Admin; Supervisor solo anular) | Panel › Credenciales |
| Cambiar zona o desactivar un scanner | Supervisor o Admin | Panel › Dispositivos |
| Promover el equipo de respaldo | Técnico con el Admin | Panel › Sistema (PROMOVER) o `npm run promote` |
| Restaurar una copia | Admin, con el host apagado | Panel › Sistema (RESTAURAR) o `npm run restore` |
| Cambiar la config del evento | Solo Admin | Panel › Evento y roles |
| Un agente de IA | **Nada de lo anterior.** Lee, explica el paso y a quién le toca. | — |

## Ritmo del día (detalle imprimible en `docs/_plantillas/checklist-dia-d.md`)

- **H−2:00** Técnico: UPS, `/health` del principal (`ok`, `mode: primary`, `audit.ok`), respaldo con `lagSeconds ≤ 10`, hora correcta, copia manual en los dos destinos, hotspot solo al host, Nube › Traer ahora.
- **H−1:30** Mesa de acreditación: Inscripciones pendientes de imprimir → 0; entrega = escanear + documento + Marcar entregada.
- **H−1:00** Puertas: portero con PIN, zona correcta en pantalla, Conectado, power bank, escaneo de prueba verde, sobre de modo degradado. Panel › Dispositivos todos conectados, pendientes 0.
- **H−0:30** Apertura. Puerta principal con 2 scanners + mesa de ayuda a un lado para no frenar la fila.
- **Cada 2 h** rotación USB A↔B (la que sale va a la mesa de acreditación). **Cada 3 h** cambio de turno: saliente **Termina turno**, entrante PIN.
- **Semáforo** (Panel › Puertas en vivo / Sistema): dispositivos conectados · pendientes · última copia < 10 min · respaldo con lag ≤ 10 s · alertas abiertas.
- **Cierre**: salidas registradas, pendientes 0 en todos, copia verificada, Auditoría › Verificar cadena íntegra, reporte de cierre descargado, host encendido toda la noche.

## Incidentes: qué hacer (resumen; el detalle con comandos está en el documento citado)

| Síntoma | Qué hacer | Doc |
|---|---|---|
| **Ámbar "se usó en otra puerta hace N min"** | Persona a un lado; supervisor compara foto y documento; si es fraude: Panel › Anular (motivo), retener credencial; resolver la alerta con nota. Si es legítimo (corrió entre puertas): Autorizar. | 40 §8.1 · 60 §6 |
| **Rojo "ya entró a {zona}"** | ¿Salió sin escanear? Supervisor › Autorizar excepción "Salió sin escanear". Recordar escanear salidas en zonas con anti-passback. | 60 §5–6 |
| **Credencial perdida** | Mesa de acreditación: Re-emitir (la vieja queda anulada en < 1 min en todos los scanners), imprimir, entregar. | 40 §8.2 · 60 §2 |
| **Scanner sin conexión** | Sigue escaneando (modo local). Técnico: RSSI en la puerta, `/health` del host. Si el host no responde en 2 min → promover respaldo. Alerta "sin conexión > 5 min" se resuelve con nota. | 50 §11 · 90 §10 |
| **Host principal caído** | Esperar 2 min. Técnico: en el respaldo Panel › Sistema › PROMOVER (o `npm run promote`). Apuntar scanners (menú ⋯ › Cambiar dirección) o DNS/mDNS. **Nunca** reencender el viejo como principal: arrancarlo como standby del nuevo. | 50 §3.2 · 40 §8.4 |
| **Corte de energía** | Min 0: UPS sostiene host + red; scanners ni se enteran; avisar "todo sigue, no cambien nada"; no imprimir. Min 5: copia manual, verificar USB. Min 15: si no vuelve en < 30 min, apagar el principal ordenadamente y promover el respaldo (batería propia). Al volver: red, luego host como standby del nuevo principal; pendientes a 0; verificar cadena. | 50 §6.1 |
| **Scanner perdido o robado** | Panel › Dispositivos › Desactivar (recibe 401 desde ya). Enrolar la reserva con la misma zona. Incidente de seguridad. | 40 §8.3 |
| **Sospecha de Wi-Fi hostil** | Verificar SSID y BSSID del router propio; cambiar contraseña del SSID si hace falta; HTTPS protege el tráfico. | 40 §8.5 |
| **Cadena de auditoría rota** | No tocar nada. Copia manual. Avisar al Administrador y al Auditor; comparar con la última copia verificada. | 40 §8.6 |
| **Solicitud de supresión de datos** | Registrar (ID corto, canal, hora); atender tras el evento salvo urgencia; no borrar durante el evento sin el Administrador. | 40 §8.7 |
| **Filtración de la clave privada** | Rotar `kid` (k2), re-emitir todo lo acreditado, revocar k1 en los scanners (config), incidente mayor. | 40 §8.8 |
| **QR no lee** | Acercar, evitar reflejo, linterna; si sigue: Ingreso manual por ID corto con motivo "QR no se lee". Muchos manuales en 1 h → alerta: revisar el scanner. | 60 §5 |
| **Impresora** | No va al UPS. Sin luz no se imprime: usar stock. Tóner de repuesto. | 50 §6 · 90 §6 |

## Cómo responder a una pregunta de operación

1. Qué está pasando (una frase). 2. Pasos numerados con la ruta exacta del panel o el comando y **quién** lo hace. 3. Cómo saber que quedó bien (qué debe mostrar el scanner o `/health`). 4. Qué registrar (alerta resuelta con nota, `docs/_plantillas/runbook-incidente.md`, `DEF-nnn` si es del software).

Consultas de lectura útiles (si hay MCP `tatami-host` o `curl` con token): `health`, `gate_summary` (entradas/salidas/negados por puerta y motivo, pendientes por dispositivo), `cloud_status`, `search_credential` (por ID corto o nombre; responde lo mínimo).

# Plantilla · Checklist del día D

> Para imprimir (una por día de evento) y marcar con bolígrafo. Horas relativas a la apertura de puertas (H). Detalle de cada punto en [50-OPERACION §9](../50-OPERACION.md) y en los manuales de [60](../60-MANUALES-POR-ROL.md). El Técnico y el Coordinador firman al cierre.

**Fecha**: ________ · **Día** 1 / 2 / 3 · **Apertura (H)**: ____:____ · **Técnico**: __________ · **Coordinador**: __________

## H−2:00 · Encendido (Técnico)

- [ ] UPS encendido; host principal, router principal y switch conectados a él.
- [ ] Host principal arriba: `curl -sk https://<host>/health | jq '{ok,mode,audit,lastBackupAt}'` → `ok: true`, `mode: "primary"`, `audit.ok: true`.
- [ ] Hora del host correcta (chrony sincronizado o hora fijada a mano): `timedatectl` sin "System clock synchronized: no" en rojo.
- [ ] Equipo de respaldo arriba y replicando: `/health` → `role: "standby"`, `lagSeconds` ≤ 10.
- [ ] Nodos mesh encendidos (luz verde) y mini-UPS conectados. SSID de staff visible solo para quien lo conoce.
- [ ] USB-A montada en el host; copia manual: Panel › Sistema › **Hacer copia ahora** → "también en el segundo destino".
- [ ] Hotspot 4G conectado solo al host (si hay internet): Panel › Nube › **Traer ahora** → sin error; anotar cuántas inscripciones llegaron: ____.
- [ ] Panel › Puertas en vivo abierto en el portátil del Coordinador.

## H−1:30 · Mesa de acreditación (Coordinador + Operador de impresión)

- [ ] Panel › Inscripciones: lo que llegó de la nube y falta imprimir = ____ → lote creado e impreso.
- [ ] Impresora con tóner y papel 100 × 150 para ≥ 100 re-emisiones; guillotina y lanyards por color a mano.
- [ ] Credenciales ordenadas por club/delegación; entrega = escanear + ver documento + **Marcar entregada**.

## H−1:00 · Puertas (Supervisores)

| Puerta | Zona | Scanner (etiqueta) | Portero | PIN ok | Zona en pantalla | Conectado | Power bank | Escaneo de prueba (staff) verde | Sobre degradado |
|---|---|---|---|---|---|---|---|---|---|
| P1 | | | | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| P2 | | | | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| P3 | | | | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| P4 | | | | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| P5 | | | | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| P6 | | | | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Reserva 1 | — | | — | ☐ | — | ☐ | ☐ | — | — |
| Reserva 2 | — | | — | ☐ | — | ☐ | ☐ | — | — |

- [ ] Panel › Dispositivos: todos "conectado", pendientes = 0.
- [ ] Mesa de ayuda lista junto a la puerta principal (supervisor + lista impresa por rol).

## H−0:30 · Apertura al público

- [ ] Puerta principal con 2 scanners en el pico.
- [ ] Coordinador vigila Panel › Alertas (duplicados, manuales, sin conexión).

## Durante el día

| Hora | Rotación USB (cada 2 h) | Semáforo revisado (dispositivos · pendientes · copia · respaldo) | Cambio de turno porteros (cada 3 h: saliente **Termina turno**, entrante PIN) | Incidentes (ID) |
|---|---|---|---|---|
| | ☐ A→B | ☐ | ☐ | |
| | ☐ B→A | ☐ | ☐ | |
| | ☐ A→B | ☐ | ☐ | |
| | ☐ B→A | ☐ | ☐ | |

Reglas rápidas: la puerta **nunca se detiene** por falta de red (modo local). Rojo = no entra; ámbar = supervisor decide; QR que no lee = ingreso manual por ID corto con motivo. Credencial perdida → mesa de acreditación (re-emitir; la vieja queda anulada en < 1 min).

## Cierre del día

- [ ] Scanners de salida en T/W registran salidas; "Dentro ahora" por zona tiende a 0 (Panel › Puertas en vivo).
- [ ] Todos los porteros **terminan turno** (resumen de turno visible en el scanner); pendientes = 0 en todos los dispositivos.
- [ ] Panel › Sistema › Hacer copia ahora → ok en los dos destinos. Verificar la última copia (**Verificar**: conteos coinciden).
- [ ] Panel › Auditoría › **Verificar cadena** → "Registro íntegro hasta el número N". N = ______.
- [ ] Reporte de cierre descargado (Panel › Sistema o `GET /reports/day-close?format=csv`): entradas ____ · salidas ____ · negados ____ · manuales ____ · alertas resueltas ____ / abiertas ____.
- [ ] Nube › Traer ahora (si hay internet) y, al cierre del último día, subida del reporte al host-report.
- [ ] Scanners a cargar (100 % para mañana); el host **no se apaga**; USB fuera de rotación en custodia del Coordinador.
- [ ] Incidentes del día documentados con la [plantilla de incidente](./runbook-incidente.md).

**Firma Técnico**: ______________ · **Firma Coordinador**: ______________

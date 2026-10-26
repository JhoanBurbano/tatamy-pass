# ADR-0004 · Sync append-only con idempotencia por (deviceId, seq)

| Campo | Valor |
|---|---|
| **Estado** | Aceptado |
| **Fecha** | 2026-10-09 (ampliado 2026-10-13 con eventos de dispositivo) |
| **Decide** | Claude por encargo de Jhoan Burbano (contrato 00-DECISIONES v1.0) |
| **Afecta a** | `packages/core` (`event-log.ts`, `device-events.ts`, `audit-chain.ts`), `apps/host` (`routes/sync.ts`, `repos.ts`), `apps/scanner` (`sync.ts`), docs 30 §6 |

## Contexto

Los scanners pasan horas sin red y luego suben todo de golpe; el host de respaldo replica; el host puede reiniciarse a mitad de una subida. Hay que reconciliar sin conflictos, sin duplicar y sin perder nada, y la auditoría debe ser verificable.

## Decisión

Los escaneos son **hechos inmutables**: cada evento se identifica por `${deviceId}:${seq}` con `seq` monotónico por dispositivo; el host ignora repetidos y, si llega la misma clave con otro contenido, gana el que ya estaba. Revocaciones y configuración son **LWW** (último gana) por `at`/`configVersion` con reloj del host. Los eventos de dispositivo (`manual_entry`, `exception`, `zone_change`, `mode_change`, `shift_start`, `shift_end`) viajan por el **mismo log** con `decision: 'EVENT'` y detalle en `manual` para no cambiar la API. La auditoría del host es una cadena de hashes (`prevHash` → `hash`). Transporte: polling cada 15 s con backoff (el WebSocket del contrato queda como optimización).

## Alternativas consideradas

| Alternativa | Por qué no |
|---|---|
| Tablas mutables con "estado actual" | Conflictos de sync, reconciliación ambigua, auditoría no verificable. |
| CRDTs generales | Complejidad innecesaria: un escaneo nunca se edita, así que un log basta. |
| Endpoint nuevo por tipo de evento de dispositivo | Más API que probar y sincronizar; el log existente ya es idempotente y ordenado. |
| WebSocket obligatorio | Más estado que mantener en proxies/Caddy; 8 puertas con polling de 15 s cumplen el objetivo de < 2 s en LAN con margen. |

## Consecuencias

**Positivas**: reconciliación determinista (`reconcile(local, remote)`), reintentos seguros, "quién está dentro" es un `GROUP BY`, el respaldo es un cliente de sync más.

**Negativas / costos**: más filas (irrelevante a esta escala). Los reportes deben filtrar `decision === 'EVENT'` (pendiente en `reports.ts`, documentado en 80 §9). Un scanner con reloj muy desviado produce `at` raros: el host guarda `receivedAt` y el scanner avisa de deriva.

**Qué vigilar**: si aparece un evento que sí necesite edición (p. ej. corregir una zona), modelarlo como evento compensatorio, nunca como UPDATE.

## Referencias

- `docs/00-DECISIONES.md` §8 · `docs/30-ARQUITECTURA.md` §2, §6 · skill `.claude/skills/tatami-sync-protocolo/SKILL.md`
- Código: `packages/core/src/event-log.ts`, `packages/core/src/device-events.ts`, `apps/host/src/routes/sync.ts`
- Tests: `packages/core/test/event-log.test.ts`, `apps/host/test/sync.test.ts`, `e2e/tc-044-modo-local`

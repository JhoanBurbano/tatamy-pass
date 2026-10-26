# packages/core — guía para agentes

Dominio **puro, sin IO**, compartido por scanner, host y nube. Si algo necesita red, disco, reloj del sistema o `fetch`, no va aquí: va en la app y aquí solo la función que decide. Lee primero `/CLAUDE.md` (raíz).

## Módulos (`src/`)

| Módulo | Qué decide |
|---|---|
| `types.ts` | Tipos de dominio con JSDoc (alimentan `docs/32-CONFIG-EVENTO.md`). |
| `credential-id.ts` | ID corto `TP-2026-00123-C` con Luhn mod 36 (`formatCredentialId`, `isValidCredentialId`). |
| `qr-token.ts` | `signCredentialToken` / `verifyToken`: `TP1.<payload>.<firma Ed25519>` (`@noble/ed25519`). Payload compacto sin PII (ADR-0002). |
| `access-rules.ts` | `evaluateScan`: decisión `ALLOW/DENY/ALERT` + `ReasonCode` + texto humano del catálogo de `docs/70`. |
| `age-categories.ts` | `ageOn`, `categoryForAge`. |
| `event-log.ts` | Log append-only idempotente por `deviceId:seq`, `reconcile` determinista (ADR-0004). |
| `device-events.ts` | Eventos de dispositivo que viajan por el mismo log (`manual_entry`, `exception`, `zone_change`, `mode_change`, `shift_start`, `shift_end`), catálogos de motivos, `buildDeviceEvent`, `describeDeviceEvent`. |
| `audit-chain.ts` | `appendAudit`, `verifyChain` (hash encadenado). |
| `sportdata-import.ts` | CSV → tabla → `importSportData` idempotente (dedupe por nombre + fecha + club). |
| `companions.ts` | `validateCompanions` (ADR-0008). |
| `config-validation.ts` | `validateEventConfig` con mensajes por campo, `capacityWarnings`. |
| `default-config.ts` | Config por defecto de `nac2026`, `resolveZones`, `findRole`. |
| `field-crypto.ts` | AES-256-GCM + HMAC para campos sensibles (JS puro, `@noble/ciphers`). |
| `badge-template.ts` | `BadgeTemplate` (diseño de la credencial impresa como JSON, ADR-0009), `defaultBadgeTemplate()` "Nacional 2026", `validateBadgeTemplate`, textos desde la config (`badgeTextsFromConfig`, `eventDateLine`), `displayCredentialId`, `resolveBadgeFields`, `roleBandStyle`, `filterPersonForBadge` (privacidad). |
| `code128.ts` | Codificador Code 128 B (`encodeCode128B`, `code128Bars`) para el reverso de la credencial. |
| `radio.ts` | Tatami Radio (ADR-0010): canales/órdenes por defecto, permisos por rol (`canTalk`, `canListen`, `canSendOrders`), mensajes de señalización tipados (`RadioClientMessage`/`RadioServerMessage`, `parseClientMessage`), `RadioArbiter` (salas, un hablante por canal con cola, Emergencia, órdenes con acuse; recibe `now`) y `buildRadioEvent` (hechos `radio_ptt/order/ack` para el log bajo el dispositivo virtual `radio`). Los tipos de config (`RadioConfig`, `RadioChannel`, `RadioOrderTemplate`) están en `types.ts` para docs:gen. |

## Reglas propias

- **Puro y determinista**: las funciones reciben `now`/fechas como parámetro, no leen el reloj. Sin `process.env`, sin `fetch`, sin `fs`.
- **100 % cubierto**: cada función exportada tiene test en `test/<módulo>.test.ts` (Vitest con `--coverage`). `test/fixtures.ts` tiene claves y credenciales de prueba.
- **Mensajes humanos**: los textos que devuelven `evaluateScan`, `validateEventConfig`, `validateCompanions` e `importSportData` son los del catálogo `docs/70-UX-WRITING.md`; cámbialos allí también.
- **Compatibilidad del token**: el formato `TP1` y el payload (`v,e,c,r,z,f,t,n,k,exp,iat`) son contrato con credenciales ya impresas. Un cambio = versión `TP2` nueva, verificación de ambas y ADR.
- `ReasonCode` nuevo → mensaje en `access-rules.ts`, catálogo en `docs/70` §4, test, y revisar `apps/scanner/src/screens/Result.tsx` y los reportes del host.
- Tipo de evento de dispositivo nuevo → usa `scripts/agent/new-event-type.ts` (scaffold + test) y la skill `tatami-sync-protocolo`.
- Exporta todo desde `index.ts`; el build es `tsc -p tsconfig.build.json` → `dist/` (las apps importan `@tatami/core` compilado: corre `npm run build -w packages/core` tras cambiar algo).

## Verificar

```bash
npm test -w packages/core         # con cobertura
npm run build -w packages/core    # obligatorio antes de probar host/scanner/nube
npm run docs:gen                  # si tocaste tipos de config
```

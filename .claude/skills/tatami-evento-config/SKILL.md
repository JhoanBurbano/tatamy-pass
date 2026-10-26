---
name: tatami-evento-config
description: Cómo cambiar roles de acceso, cupos, zonas, categorías de edad, acompañantes y aforo en event.config.json de Tatami Pass con validación, sin romper credenciales ya emitidas. Úsala para "añadir un rol", "subir el cupo de X", "crear una zona", "cambiar las categorías" o cualquier edición de la config del evento.
---

# Configurar el evento (`event.config.json`)

Fuente de verdad del esquema: `docs/32-CONFIG-EVENTO.md` (generado desde `packages/core/src/types.ts`, `default-config.ts` y `config-validation.ts`). Procedimientos de operación: `docs/50-OPERACION.md` §5.1–5.2. El archivo vive en `apps/host/event.config.json` (o `TP_EVENT_CONFIG`); la nube usa la misma forma con `EVENT_CONFIG_PATH`.

## Qué puede cambiar sin tocar código

| Quiero… | Edito | Efecto en lo ya emitido |
|---|---|---|
| Un rol nuevo | `roles[]`: `{ code, name, zones, days, capacity, requiresPhoto, color, allowsDigital, antiPassbackZones }` | Ninguno. Las credenciales nuevas con `r: CODE` validan en < 1 min en los scanners. Compra lanyards del color. |
| Subir/bajar un cupo | `roles[i].capacity` (entero o `null` = sin límite), `ageCategories[i].capacity`, `companions.total`, `totalCapacity` | Bajar por debajo de lo emitido **no anula nada**: solo bloquea emisiones nuevas (`capacityWarnings` avisa). Subir libera lista de espera (aprueba el Coordinador). |
| Zonas de un rol | `roles[i].zones` (`['*']` = todas) | Solo credenciales **nuevas**: las emitidas llevan sus zonas firmadas en el QR. Para cambiar a alguien ya acreditado: re-emitir (`POST /credentials/:id/reissue`) e imprimir de nuevo. |
| Anti-passback | `roles[i].antiPassbackZones` y `zones[i].tracksExit` | Inmediato en todos los scanners (es regla, no va en el QR). Una zona con anti-passback necesita `tracksExit: true` y un scanner de salida. |
| Zona nueva | `zones[]`: `{ code, name, tracksExit }` | Ninguno hasta que un rol la incluya. Código en mayúsculas ≤ 12 caracteres. |
| Días válidos de un rol | `roles[i].days`: `null` (todos) o lista `YYYY-MM-DD` dentro de `startDate..endDate` | Solo credenciales nuevas (`f`/`t` van en el QR). |
| Categorías de edad | `ageCategories[]`: `{ code, name, minAge, maxAge, capacity }` sin solapes | Afecta validación de inscripciones y emisión en sitio; no re-clasifica a los ya emitidos. |
| Acompañantes | `companions.perParticipant`, `companions.total` | Inmediato en formulario, API y host (misma `validateCompanions`). |
| Antifraude | `duplicateWindowSeconds` (120), `digitalTokenWindowSeconds` (60), `clockToleranceSeconds` (300) | Inmediato. |

**No se cambia** después de emitir: `eventId` (va en el QR), `idPrefix` (va en los IDs impresos). `signingKeys`, `configVersion` y `updatedAt` los gestiona el host.

## Cómo hacerlo

**Opción A · Panel (recomendada durante el evento)**: `/admin` › Evento y roles › edita › **Guardar cambios**. Valida con `validateEventConfig` y marca el campo con error; guarda con `expectedVersion` (409 si otro admin guardó antes); recarga en caliente y queda en auditoría (`CONFIG_UPDATED`).

**Opción B · API**:
```bash
TOKEN=$(curl -s -X POST localhost:8787/auth/login -H 'content-type: application/json' -d '{"username":"admin","password":"admin123"}' | jq -r .token)
curl -s localhost:8787/config -H "authorization: Bearer $TOKEN" | jq .config > /tmp/cfg.json
# edita /tmp/cfg.json
curl -s -X POST localhost:8787/config/validate -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d "{\"config\": $(cat /tmp/cfg.json)}" | jq   # errors: [] y warnings
curl -s -X PUT  localhost:8787/config -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d "{\"config\": $(cat /tmp/cfg.json), \"expectedVersion\": <configVersion actual>}" | jq .message
```

**Opción C · Archivo (host apagado, antes del evento)**: edita `apps/host/event.config.json` y valida en local:
```bash
npm run build -w packages/core
npx tsx -e "import('@tatami/core').then(m=>{const c=JSON.parse(require('fs').readFileSync('apps/host/event.config.json','utf8'));const e=m.validateEventConfig(c);console.log(e.length?e:'OK')})"
```

## Reglas de validación que más fallan

Código en mayúsculas sin espacios (`^[A-Z][A-Z0-9_]{0,11}$`) · zona referenciada debe existir · `capacity` entero ≥ 0 o `null` · color `#RRGGBB` · `days` dentro del evento · categorías sin solapes y `maxAge ≥ minAge` · `endDate ≥ startDate` · `utcOffsetMinutes` entero (Colombia −300).

## Checklist tras cambiar la config

- [ ] `errors: []` en validación; `warnings` leídos (cupos por debajo de lo emitido).
- [ ] Si tocaste `default-config.ts` en core: tests que cuentan roles/zonas (`packages/core/test/config-validation.test.ts`, `apps/host/test/*`) y `npm run docs:gen`.
- [ ] Nube con la misma config si el cambio afecta al formulario (cupos, edades, acompañantes): `EVENT_CONFIG_PATH` o panel › Evento.
- [ ] `docs/00-DECISIONES.md` §5 y `docs/10-PRD.md` §5 si el rol es permanente; `docs/50` §1.4 color de lanyard.
- [ ] Línea en `docs/99-CHANGELOG.md`.
- [ ] Scanners: en < 1 min muestran la config nueva (polling); si no, "Actualizar datos" en el menú.

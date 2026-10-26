# ADR-0007 · Actualización desde la nube por pull (botón + periódica)

| Campo | Valor |
|---|---|
| **Estado** | Aceptado |
| **Fecha** | 2026-10-13 |
| **Decide** | Claude por encargo de Jhoan Burbano (decisión registrada en 00-DECISIONES §8) |
| **Afecta a** | `apps/registration` (`/api/export`, `/api/host-report`), `apps/host` (`cloud-sync.ts`, `routes/cloud.ts`), `apps/host-admin` (página Nube), docs 80 §8, 85 §6 |

## Contexto

Las inscripciones se aprueban en la nube hasta el mismo día del evento. El host está en una LAN sin salida a internet salvo un hotspot 4G intermitente, detrás de NAT, sin IP pública. La nube no puede "empujar" al host de forma fiable, y el día D la nube es opcional por diseño (00-DECISIONES §2).

## Decisión

El **host tira de la nube**: `GET /api/export?since=<cursor>` protegido por clave compartida (`x-tatami-key` = `TP_CLOUD_KEY`) devuelve inscripciones aprobadas creadas o cambiadas desde el cursor, con acompañantes. El host la consume con `POST /sync/cloud/pull` (botón del panel) y con un scheduler cada `TP_CLOUD_INTERVAL_MIN` (5 por defecto, 0 = solo manual, editable desde el panel, nunca solapa ejecuciones). Es **idempotente por id de inscripción** (`external_id`): lo nuevo crea persona + credencial, lo cambiado actualiza nombre/club/categoría sin re-emitir, lo repetido no hace nada. Sin internet, registra "sin conexión, se reintenta en N min", conserva el cursor y sigue. En sentido contrario, el host sube al cierre `POST /api/host-report` con estados de credencial y resumen de escaneos.

## Alternativas consideradas

| Alternativa | Por qué no |
|---|---|
| Push nube → host (webhook) | Host sin IP pública ni internet estable; exigiría túnel y abriría superficie de ataque hacia la fuente de verdad. |
| Replicación de base (Postgres → SQLite) | Dos modelos distintos (inscripción vs. credencial); el mapeo explícito es el lugar donde se validan cupos, edad y acompañantes. |
| Solo manual (exportar JSON y cargar a mano) | Sigue existiendo (`/panel/exportar/json`) como respaldo, pero el día antes se aprueban decenas de cambios y nadie lo haría cada 5 min. |

## Consecuencias

**Positivas**: la nube nunca es un punto de fallo el día D; el host decide cuándo hablar; un solo cursor fácil de inspeccionar (`GET /sync/cloud/status`, `GET /sync/cloud/preview`).

**Negativas / costos**: latencia de hasta `TP_CLOUD_INTERVAL_MIN` minutos (hay botón). La aprobación vive en la nube: si se cae antes del evento, se emite en sitio (`POST /credentials/issue`). Los acompañantes no traen fecha de nacimiento (marcador `1900-01-01`).

**Qué vigilar**: si aparecen varias sedes con hosts distintos, el cursor debe ser por host (hoy la nube marca `exported` global).

## Referencias

- `docs/00-DECISIONES.md` §8 · `docs/80-COMO-PROBAR.md` §8 · `docs/85-DESPLIEGUE-NUBE.md` §6
- Código: `apps/host/src/cloud-sync.ts`, `apps/host/src/routes/cloud.ts`, `apps/registration/app/api/export/route.ts`, `apps/registration/lib/export.ts`
- Tests: `apps/host/test/cloud-sync.test.ts`, `apps/registration/test/export.test.ts`

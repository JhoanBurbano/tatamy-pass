# ADR-0008 · Acompañantes como rol de acceso `ACOMP` ligado al participante

| Campo | Valor |
|---|---|
| **Estado** | Aceptado |
| **Fecha** | 2026-10-13 |
| **Decide** | Claude por encargo de Jhoan Burbano (decisión registrada en 00-DECISIONES §7) |
| **Afecta a** | `packages/core` (`companions.ts`, `default-config.ts`), `apps/registration` (formulario, `/api/register`, exportación), `apps/host` (`credentials.ts`, `cloud-sync.ts`), docs 10 §5, 32, 80 §7 |

## Contexto

Cada competidor suele venir con uno o dos familiares que entran a gradería. Sin un modelo propio terminaban como inscripciones "General" sueltas: sin relación con el participante, contando contra el cupo GEN, con foto obligatoria y sin forma de limitar el aforo total. Hacía falta una regla única (formulario, API y host) y que heredaran el estado del participante.

## Decisión

Un acompañante es una **persona con rol de acceso `ACOMP`** (zona `G`, sin foto, credencial digital por defecto, `capacity: null`) ligada por `companionOf` a la credencial o inscripción del participante, con parentesco opcional. Los límites viven en la config: `companions.perParticipant` (2), `companions.total` (sin límite) y `totalCapacity` (2.000). La validación es **una sola función** de `packages/core` (`validateCompanions`) en este orden: límite por participante → cupo total de acompañantes → aforo total. Heredan el estado de la inscripción (pendiente/aprobado/lista de espera), se exportan y se acreditan junto con el participante.

## Alternativas consideradas

| Alternativa | Por qué no |
|---|---|
| Acompañantes como inscripciones `GEN` independientes | Sin vínculo, consumen cupo GEN, piden foto, no heredan aprobación ni lista de espera. |
| Un campo "número de acompañantes" sin personas | Sin credencial individual no hay anti-duplicado ni trazabilidad de quién entró; la Ley 1581 pide saber de quién son los datos que guardamos. |
| Tabla aparte sin credencial hasta el día D | Duplica la lógica de emisión y rompe "cada persona con credencial es una credencial". |

## Consecuencias

**Positivas**: un solo modelo de credencial, límites configurables sin tocar código, misma validación en los tres niveles, el panel muestra acompañantes en la ficha del participante.

**Negativas / costos**: los acompañantes no tienen fecha de nacimiento (marcador `1900-01-01` en el host) ni categoría; no cuentan contra `GEN` pero sí contra el aforo total, lo que hay que explicar al administrador al ajustar cupos.

**Qué vigilar**: si la federación exige foto o documento al acompañante, basta cambiar `requiresPhoto` del rol y la validación del formulario (el modelo no cambia).

## Referencias

- `docs/00-DECISIONES.md` §5 y §7 · `docs/32-CONFIG-EVENTO.md` · `docs/80-COMO-PROBAR.md` §7
- Código: `packages/core/src/companions.ts`, `apps/registration/lib/validate.ts`, `apps/host/src/routes/credentials.ts`
- Tests: `packages/core/test/companions.test.ts`, `e2e/tc-acompanantes-limite`

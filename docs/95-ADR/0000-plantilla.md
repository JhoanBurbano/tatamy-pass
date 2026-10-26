# ADR-0000 · Plantilla — Título corto de la decisión

> Copia este archivo como `NNNN-titulo-en-kebab.md` (siguiente número libre). Un ADR por decisión. Escribe en pasado lo que ya se decidió y en presente lo que sigue vigente. No se edita un ADR aceptado: se escribe otro que lo reemplaza.

| Campo | Valor |
|---|---|
| **Estado** | Propuesto · Aceptado · Reemplazado por ADR-NNNN · Obsoleto |
| **Fecha** | AAAA-MM-DD |
| **Decide** | Quién tomó la decisión (persona o rol) |
| **Afecta a** | `packages/core`, `apps/host`, … y los documentos del rango NN |

## Contexto

Qué problema había, qué restricciones mandan (offline-first, Ley 1581, 2.000 personas, 6–8 puertas, voluntarios con guantes…) y qué fuerzas chocan. Dos o tres párrafos; enlaza al PRD o a 00-DECISIONES.

## Decisión

Qué se decidió, en una frase afirmativa. Después, el detalle justo para implementarla (formato, nombres, dónde vive en el código).

## Alternativas consideradas

| Alternativa | Por qué no |
|---|---|
| … | … |

## Consecuencias

**Positivas**: qué gana el proyecto.

**Negativas / costos**: qué se asume (deuda, operación, límites conocidos).

**Qué vigilar**: condición bajo la que habría que reabrir esta decisión.

## Referencias

- `docs/00-DECISIONES.md` §N
- Código: `ruta/al/archivo.ts`
- Tests: `ruta/al/test.ts`

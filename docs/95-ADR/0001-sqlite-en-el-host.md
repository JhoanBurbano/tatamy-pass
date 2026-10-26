# ADR-0001 · SQLite (WAL) como base del host

| Campo | Valor |
|---|---|
| **Estado** | Aceptado |
| **Fecha** | 2026-10-09 |
| **Decide** | Claude por encargo de Jhoan Burbano (contrato 00-DECISIONES v1.0) |
| **Afecta a** | `apps/host` (`db.ts`, `repos.ts`, `migrations/`, `backup.ts`), docs 30, 50, 80 |

## Contexto

El host es la fuente de verdad de la sede y corre en un mini PC o portátil con Ubuntu, sin administrador de bases de datos, a veces sin internet y con cortes de energía posibles (00-DECISIONES §2 y §9). La carga real es pequeña: 25 personas/min en pico con 6–8 puertas, unas 60.000 filas en tres días. Hace falta copia de seguridad trivial, restauración por una persona no técnica y replicación hacia un equipo de respaldo.

## Decisión

El host usa **SQLite con `better-sqlite3` en modo WAL**, un solo archivo (`data/tatami.db`). Las copias de seguridad son `VACUUM INTO` a dos destinos (carpeta local + USB cifrada), la verificación abre la copia y cuenta filas, y el esquema vive en `apps/host/migrations/*.sql` aplicado al arrancar. Se escribe **SQL directo** en `repos.ts` en lugar del ORM Drizzle previsto en el contrato (menos superficie, el esquema queda a la vista).

## Alternativas consideradas

| Alternativa | Por qué no |
|---|---|
| Postgres en el host | Un servicio más que puede fallar, backups más complejos, más RAM; nada de eso aporta a 25 escrituras/min. En la nube sí se usa Postgres (Neon) porque allí hay concurrencia real y lo administra el proveedor. |
| Drizzle ORM (lo que decía el contrato) | Capa extra para 12 tablas; SQL directo con repositorios aísla igual y se lee sin aprender otra sintaxis. Registrado como simplificación honesta en 80 §9. |
| Litestream / rqlite para replicar | Resuelven replicación pero añaden un mecanismo distinto al protocolo de sync ya probado (ver ADR-0004 y ADR-0007). Queda como mejora posible si se necesita RPO de milisegundos. |

## Consecuencias

**Positivas**: arranca en cualquier portátil, copia = un archivo, restauración con el host apagado en un comando, `PRAGMA integrity_check` como verificación, miles de escrituras/s de sobra.

**Negativas / costos**: un solo proceso escribe (no hay escalado horizontal; no hace falta). La PII viaja en claro entre primario y respaldo por la LAN de staff (cada host la recifra con su clave): usar HTTPS entre hosts si la LAN no es de confianza.

**Qué vigilar**: si un evento necesita varios pabellones escribiendo sobre la misma base en tiempo real, reabrir (hoy cada sede tiene su host).

## Referencias

- `docs/00-DECISIONES.md` §3 y §9 · `docs/30-ARQUITECTURA.md` §4 y §11 · `docs/80-COMO-PROBAR.md` §2.4 y §9
- Código: `apps/host/src/db.ts`, `apps/host/src/repos.ts`, `apps/host/src/backup.ts`
- Tests: `apps/host/test/admin-api.test.ts` (copias), `apps/host/test/standby.test.ts`

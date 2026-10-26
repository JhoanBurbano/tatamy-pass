# 95 · Registro de decisiones de arquitectura (ADR)

> Una decisión por archivo, numerada y nunca reescrita: si cambia, se escribe otro ADR que la reemplaza. Plantilla: [0000-plantilla.md](./0000-plantilla.md). Se crean con `/adr "<título>"` (subagente `arquitecto`) o copiando la plantilla.

| ADR | Decisión | Estado | Fecha |
|---|---|---|---|
| [0001](./0001-sqlite-en-el-host.md) | SQLite (WAL) como base del host, SQL directo sin ORM | Aceptado | 2026-10-09 |
| [0002](./0002-token-firmado-en-el-qr.md) | El QR lleva un token firmado Ed25519, no una URL | Aceptado | 2026-10-09 |
| [0003](./0003-pwa-en-vez-de-app-nativa.md) | Scanner como PWA, no app nativa | Aceptado | 2026-10-09 |
| [0004](./0004-sync-append-only.md) | Sync append-only con idempotencia por `(deviceId, seq)` | Aceptado | 2026-10-09 |
| [0005](./0005-caddy-ca-interna.md) | HTTPS en LAN con Caddy y CA interna | Aceptado | 2026-10-09 |
| [0006](./0006-scrypt-en-vez-de-argon2.md) | scrypt en el host en lugar de Argon2id | Aceptado | 2026-10-09 |
| [0007](./0007-pull-nube-a-host.md) | Actualización desde la nube por pull (botón + periódica) | Aceptado | 2026-10-13 |
| [0008](./0008-acompanantes-como-rol.md) | Acompañantes como rol `ACOMP` ligado al participante | Aceptado | 2026-10-13 |
| [0009](./0009-credencial-como-plantilla.md) | La credencial impresa es una plantilla de datos, no código | Aceptado | 2026-10-24 |
| [0010](./0010-voz-en-tiempo-real-por-lan.md) | Voz por la LAN ("Tatami Radio"): malla WebRTC por canal con PTT; host solo señaliza | Aceptado | 2026-10-24 |

Cómo leerlos: **Contexto** (qué fuerzas chocaban) → **Decisión** → **Alternativas** (por qué no) → **Consecuencias** (qué ganamos, qué asumimos, qué vigilar). Las simplificaciones honestas respecto al contrato están también en [80-COMO-PROBAR §9](../80-COMO-PROBAR.md).

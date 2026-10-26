# ADR-0002 · El QR lleva un token firmado, no una URL

| Campo | Valor |
|---|---|
| **Estado** | Aceptado |
| **Fecha** | 2026-10-09 |
| **Decide** | Claude por encargo de Jhoan Burbano (contrato 00-DECISIONES v1.0) |
| **Afecta a** | `packages/core` (`qr-token.ts`, `access-rules.ts`), `apps/scanner`, `apps/print`, `apps/registration` (credencial digital), docs 30 §5, 40 §3 |

## Contexto

El principio rector es que la puerta funcione **sin red ni nube** (00-DECISIONES §2). Un QR con URL obliga a consultar un servidor para saber si la credencial vale; además cualquiera lo abre en un navegador y confunde. Hay que resistir fotocopias y pantallazos sin depender de la red, y el QR debe caber en 40 mm impresos.

## Decisión

El QR contiene `TP1.<payload base64url>.<firma Ed25519 base64url>`. El payload es compacto (`v, e, c, r, z, f, t, n, k` y, para la credencial digital, `exp`/`iat`) y **no contiene datos personales**. La clave privada vive cifrada en el host de emisión (AES-256-GCM + scrypt); los scanners reciben solo la pública en el snapshot y verifican en < 300 ms. Re-emitir incrementa `n`; las versiones anteriores quedan revocadas. La credencial digital (solo rol `GEN`) rota cada 60 s con `exp` firmado.

El QR **no basta solo** por diseño: se combina con foto en pantalla, anti-passback, alerta de duplicado (< 2 min en otra puerta), lista de revocación y holograma físico.

## Alternativas consideradas

| Alternativa | Por qué no |
|---|---|
| URL a un endpoint de validación | Exige red en la puerta; rompe el principio rector. |
| HMAC con clave compartida | Cualquier scanner podría firmar credenciales; un scanner perdido comprometería la emisión. |
| RSA | Firmas de 256+ bytes no caben bien en 40 mm; Ed25519 da 64 bytes y verificación más rápida. |
| Datos personales dentro del QR | Expone nombre/documento en una fotocopia; el nombre se muestra desde la copia local del scanner. |

## Consecuencias

**Positivas**: validación offline criptográficamente fuerte, QR pequeño, rotación de clave por evento (`kid`), re-emisión sin red.

**Negativas / costos**: un QR fotocopiado es válido criptográficamente; por eso las capas antifraude son obligatorias y hay que operarlas (supervisor ante alertas). Cambiar nombre/club no re-emite (el token no los contiene): correcto, pero hay que explicarlo al coordinador.

**Qué vigilar**: filtración de la clave privada → runbook 40 §8.8 (rotar `kid`, re-emitir, revocar la clave en los scanners).

## Referencias

- `docs/00-DECISIONES.md` §4 · `docs/30-ARQUITECTURA.md` §5 · `docs/40-SEGURIDAD-ISO27001.md` §3 y §5
- Código: `packages/core/src/qr-token.ts`, `packages/core/src/access-rules.ts`, `apps/host/src/config.ts`
- Tests: `packages/core/test/qr-token.test.ts`, `e2e/tc-067-firma-alterada`, `e2e/tc-100-qr-digital-rotativo`

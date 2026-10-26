# ADR-0006 · scrypt (node:crypto) en el host en lugar de Argon2id

| Campo | Valor |
|---|---|
| **Estado** | Aceptado (simplificación consciente respecto al contrato) |
| **Fecha** | 2026-10-09 |
| **Decide** | Claude por encargo de Jhoan Burbano |
| **Afecta a** | `apps/host/src/auth.ts`, `apps/host/src/config.ts`, `apps/host/src/pii.ts`, docs 40 §2.4, 80 §9 |

## Contexto

00-DECISIONES §6 y §10 piden Argon2id para contraseñas. En el host, Argon2 implica un módulo nativo adicional (`@node-rs/argon2` o `argon2`) que hay que compilar o descargar para cada plataforma; `better-sqlite3` ya es el único módulo nativo y cada uno añade riesgo de instalación en un portátil sin internet el día del montaje. El host tiene siete usuarios y pocos inicios de sesión; el riesgo de fuerza bruta offline sobre la base es bajo porque el disco va cifrado (LUKS) y la base también cifra PII.

## Decisión

El host usa **scrypt de `node:crypto`** (sin dependencias) para contraseñas de usuarios, para el PIN de los scanners y para derivar la clave AES-256-GCM que cifra la clave de firma y los campos sensibles (`TP_KEY_PASSPHRASE` + salt por evento). La función está aislada en `hashSecret`/`verifySecret` de `auth.ts`: cambiar a Argon2id es tocar esas dos funciones.

La nube (`apps/registration`) sí usa **Argon2id** (`@node-rs/argon2`), porque allí el riesgo de fuga de la base es mayor y el entorno (Vercel) instala binarios sin fricción.

## Alternativas consideradas

| Alternativa | Por qué no |
|---|---|
| Argon2id en el host (contrato) | Módulo nativo más; mayor riesgo de instalación en campo. Sigue siendo el objetivo si aparece un binario estable para todas las plataformas del comité. |
| bcrypt | Otro módulo nativo (o versión JS lenta) sin ventaja sobre scrypt para este caso. |
| PBKDF2 | Más débil frente a hardware especializado que scrypt/Argon2. |

## Consecuencias

**Positivas**: cero dependencias nativas nuevas, instalación reproducible, una sola primitiva para contraseñas, PIN y derivación de claves.

**Negativas / costos**: desviación documentada de ISO 27001 A.8.24 "según contrato" (se registra en 40 §2.4 y 80 §9). Parámetros de scrypt fijos: revisar si un futuro Node cambia los valores por defecto.

**Qué vigilar**: si el host pasa a tener decenas de usuarios o se expone fuera de la LAN de staff, migrar a Argon2id (una sola función).

## Referencias

- `docs/00-DECISIONES.md` §6, §10 · `docs/40-SEGURIDAD-ISO27001.md` §2.4 · `docs/80-COMO-PROBAR.md` §2.3 y §9
- Código: `apps/host/src/auth.ts`, `apps/host/src/config.ts`, `packages/core/src/field-crypto.ts`
- Tests: `apps/host/test/pii.test.ts`, `packages/core/test/field-crypto.test.ts`

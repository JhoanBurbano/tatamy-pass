# 85 · Despliegue de la nube (apps/registration) en Vercel

> Guía paso a paso para dejar la inscripción online operando: Vercel (Next.js) + Neon (Postgres) + Vercel Blob (fotos) + Resend (correo). Tiempo estimado: 45 minutos la primera vez. Todo lo que no es Vercel se puede sustituir (cualquier Postgres, cualquier SMTP cambiando `lib/mail.ts`), pero esta es la combinación probada.

## 0. Qué vas a tener al final

| Pieza | Para qué | Variable |
|---|---|---|
| Proyecto Vercel | Formulario público `/`, panel `/panel`, API para el host `/api/export` | — |
| Neon (Postgres) | Base de datos de inscripciones, usuarios del panel, ajustes | `DATABASE_URL` |
| Vercel Blob | Fotos de credencial (públicas por URL, nombre impredecible) | `BLOB_READ_WRITE_TOKEN` |
| Resend | Correos: confirmación, lista de espera, aprobación, invitaciones | `RESEND_API_KEY`, `MAIL_FROM` |
| Clave compartida | El host se autentica con `x-tatami-key` | `TP_CLOUD_KEY` (o generada en Panel › Exportar) |
| Clave de firma | QR rotativo de la credencial digital (General / Acompañante) | `TP_SIGNING_KEY` |

Sin `DATABASE_URL` la app usa SQLite local (solo dev). Sin `BLOB_READ_WRITE_TOKEN` guarda fotos en disco (en Vercel se pierden: es obligatorio allí). Sin `RESEND_API_KEY` los correos se escriben como `.eml` en `data/outbox/` (solo dev).

## 1. Neon (Postgres)

1. Crea una cuenta en neon.tech y un proyecto (región `us-east-1` para que quede junto a `iad1` de Vercel).
2. En **Connection details** elige la cadena **pooled** (el host termina en `-pooler`) y **Node.js**. Cópiala: `postgres://usuario:clave@ep-xxxx-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require`.
3. Aplica las migraciones desde tu máquina (crean las tablas y el primer administrador):

```bash
cd tatami-pass
DATABASE_URL='postgres://…' ADMIN_EMAIL=coordinacion@tuevento.co ADMIN_PASSWORD='una-clave-larga-123' npm run migrate -w apps/registration
# [migrate] base: postgres · migración aplicada: 001_init.sql · 002_credential_token.sql · admin inicial creado
```

Correr `migrate` dos veces no hace nada (idempotente). La app también aplica las migraciones pendientes al arrancar, así que en despliegues futuros basta con hacer deploy.

## 2. Vercel Blob (fotos)

1. En el dashboard de Vercel: **Storage › Create › Blob**, nómbralo `tatami-fotos` y conéctalo al proyecto (paso 4). Vercel crea `BLOB_READ_WRITE_TOKEN` automáticamente en el proyecto.
2. Las fotos se guardan como `photos/<id>-<marca>.jpg`, públicas por URL (el host necesita descargarlas para imprimir). La URL es impredecible y no sale en ninguna página pública.
3. Para dev local con Blob real: copia el token a `.env.local`.

## 3. Resend (correo)

1. Crea cuenta en resend.com, **Domains › Add domain** con el dominio desde el que escribirás (p. ej. `tuevento.co`), agrega los registros DNS (SPF, DKIM) que te muestra y espera a que diga *Verified*.
2. **API Keys › Create** con permiso *Sending access*. Copia `re_…`.
3. `MAIL_FROM` debe ser una dirección de ese dominio: `Tatami Pass <inscripciones@tuevento.co>`.
4. Prueba: inscribe a alguien con tu propio correo; debe llegar "Inscripción recibida · … · N26-XXXXXX".

Mientras el dominio no esté verificado, Resend solo entrega a tu propio correo de la cuenta: sirve para probar.

## 4. Proyecto en Vercel

1. Sube el repo a GitHub (o GitLab/Bitbucket).
2. Vercel › **Add New › Project** › importa el repo. Ajustes:
   - **Root Directory:** `apps/registration`.
   - **Framework:** Next.js (se detecta). `vercel.json` ya trae región `iad1` y el cron de lista de espera.
   - **Build Command:** déjalo por defecto (`next build`); el `prepare` del monorepo compila `packages/core`. Si Vercel no corre `npm install` en la raíz, pon **Install Command** = `cd ../.. && npm install`.
   - **Node.js:** 20 o 22.
3. **Environment Variables** (Production y Preview). Las obligatorias:

| Variable | Valor |
|---|---|
| `DATABASE_URL` | la cadena pooled de Neon |
| `SESSION_SECRET` | `openssl rand -base64 48` (≥ 32 caracteres) |
| `TP_CLOUD_KEY` | `openssl rand -base64 32` (la misma va al host) |
| `MAIL_FROM` | `Tatami Pass <inscripciones@tuevento.co>` |
| `RESEND_API_KEY` | `re_…` |
| `BLOB_READ_WRITE_TOKEN` | la crea el paso 2 |
| `APP_URL` | `https://inscripciones.tuevento.co` (tu dominio final; sirve para los enlaces de los correos) |
| `CRON_SECRET` | `openssl rand -hex 24` (Vercel lo manda al cron de lista de espera) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | solo si no corriste `migrate` en el paso 1; crea el primer admin al arrancar y luego puedes borrarlas |
| `EVENT_CONFIG_JSON` | opcional: JSON con `eventId`, `name`, `startDate`, `endDate`, `roles`… (copia de `apps/host/event.config.json`). Sin ella se usa el default del core y lo que edites en el panel |
| `TP_SIGNING_KEY` | ver §7 (credencial digital) |

4. **Deploy**. Al terminar abre `https://<proyecto>.vercel.app/api/status`: debe responder JSON con el evento y los roles. Luego `/panel/login` con el admin.

Variables opcionales: `RATE_LIMIT_REGISTER` (10/min por IP), `RATE_LIMIT_LOGIN` (5/min por correo), `PG_POOL_MAX` (3), `PHOTO_REQUIRED=1` (exige foto a los roles con `requiresPhoto`), `PASSWORD_HASH=scrypt` (si `@node-rs/argon2` no carga). Todas documentadas en `apps/registration/.env.example`.

## 5. Dominio propio

1. Vercel › proyecto › **Settings › Domains › Add** `inscripciones.tuevento.co`.
2. En tu DNS crea el `CNAME inscripciones → cname.vercel-dns.com` (o el registro A que te indique Vercel). El certificado TLS se emite solo.
3. Actualiza `APP_URL` con el dominio y redeploy (los correos usan esa URL).
4. Opcional: `https://inscripciones.tuevento.co/estado` y `/credencial/...` son las únicas URLs que ve el público además de `/`.

## 6. Apuntar el host a la nube

En el host (mini PC de la sede), en su `.env` o `docker-compose.yml`:

```
TP_CLOUD_URL=https://inscripciones.tuevento.co
TP_CLOUD_KEY=<la misma clave que en la nube>
TP_CLOUD_INTERVAL_MIN=5
```

Comprueba desde el host (o cualquier terminal con internet):

```bash
curl -s "https://inscripciones.tuevento.co/api/export?since=" -H "x-tatami-key: $TP_CLOUD_KEY" | jq '{count, cursor}'
```

- `401` → la clave no coincide. `503` → la nube no tiene clave. `200` con `count` → listo; el host la consume con `POST /sync/cloud/pull` y cada N minutos (docs/80 §8).
- Panel › **Exportar** muestra el endpoint, la clave (solo admin), la última vez que el host se llevó datos y el último reporte que subió.
- El host reporta IDs y estados de credencial a `POST /api/host-report` (misma clave). Con eso el panel muestra "emitida / impresa / entregada" y se activa la credencial digital (§7).

### Rotar la clave

1. Panel › **Exportar** › **Generar clave nueva** (solo administrador). La anterior deja de valer en ese instante y queda registrado quién la rotó.
2. Copia la clave nueva, cámbiala en el `.env` del host y reinícialo. Mientras tanto el host verá "clave inválida" y seguirá operando con lo que ya tenía.
3. La clave del panel manda sobre `TP_CLOUD_KEY`; si prefieres volver a la variable, borra la fila `cloud.key` de `event_settings`.

## 7. Credencial digital (QR rotativo)

Los roles con "credencial digital" (General y Acompañante por defecto; se cambia en Panel › Configuración del evento) reciben por correo un enlace `/credencial/<token>` al ser aprobados. La página muestra un QR firmado que cambia cada 60 s. Para que las puertas lo acepten, la nube firma con **la misma clave Ed25519 del host**:

1. En el host, exporta la clave (está cifrada en `keys/signing.enc.json` con `TP_KEY_PASSPHRASE`):
   ```bash
   cd apps/host && TP_KEY_PASSPHRASE='…' npx tsx -e "import('./src/config.ts').then(m => console.log(JSON.stringify(m.loadSigningKey())))"
   # {"kid":"k1","privateKeyHex":"…","publicKeyHex":"…"}
   ```
2. Pega ese JSON completo en la variable `TP_SIGNING_KEY` del proyecto Vercel (Production) y redeploy.
3. El ID de la credencial lo asigna el host y llega a la nube con `POST /api/host-report` (`externalId` = id de la inscripción, `credentialId`, `version`, `status`). Hasta entonces la página dice "Credencial en preparación". Si re-emites en el host, el reporte trae la versión nueva y el QR la usa.

Trátala como la passphrase: solo Production, nunca en Preview ni en el repo. Si se filtra, rota la clave en el host y vuelve a exportarla.

## 8. Cron de lista de espera

`vercel.json` programa `GET /api/cron/waitlist` cada hora con `Authorization: Bearer $CRON_SECRET`: vence las ofertas de cupo de más de 48 h y avisa a la siguiente persona. Lo mismo ocurre al abrir Panel › Lista de espera, así que si el cron falla no se pierde nada. Puedes dispararlo a mano: `curl -H "x-tatami-key: $TP_CLOUD_KEY" https://…/api/cron/waitlist`.

## 9. Checklist de seguridad antes de abrir inscripciones

- [ ] `SESSION_SECRET` largo y único; `ADMIN_PASSWORD` cambiada tras el primer acceso (Panel › Clubes e inscriptores › "Enviar enlace de contraseña" a ti mismo).
- [ ] Un usuario por persona (admin, coordinadores, inscriptores). Las invitaciones vencen a los 7 días.
- [ ] `TP_CLOUD_KEY` y `TP_SIGNING_KEY` solo en Production.
- [ ] Dominio de correo verificado en Resend (SPF + DKIM) para que no caiga en spam.
- [ ] Aviso de privacidad revisado en Panel › Configuración del evento (texto base de docs/40 §6). Fecha de cierre de inscripciones definida.
- [ ] Cabeceras de seguridad activas (las pone `next.config.ts`): `curl -I https://…/ | grep -i -E "frame|content-type-options|strict-transport"`.
- [ ] Límite de intentos: 5 logins/min por correo, 10 inscripciones/min por IP. En Vercel la memoria es por instancia; para un límite global cambia `lib/rate-limit.ts` por `@upstash/ratelimit` (misma firma).
- [ ] Retención: a T+90 exporta lo que necesites conservar (Panel › Exportar) y borra la base (`DROP SCHEMA` en Neon) y el store de Blob.

## 10. Verificación de 5 minutos tras el deploy

1. `/` → inscribe un competidor con foto y 2 acompañantes. Llega el correo "Inscripción recibida".
2. `/panel/login` → aprueba desde Inscripciones. Llega "Inscripción aprobada" con los enlaces digitales de los acompañantes.
3. `/panel/cupos` → baja un cupo a 1, inscribe de nuevo: "cupo lleno → lista de espera"; `/panel/lista-espera` › Liberar un cupo → llega el correo con enlace de 48 h.
4. `curl …/api/export -H "x-tatami-key: …"` → `count ≥ 1` y `photoUrl` empieza por `https://…blob.vercel-storage.com/`.
5. Host › `POST /sync/cloud/pull` → las personas aparecen en el host con credencial.

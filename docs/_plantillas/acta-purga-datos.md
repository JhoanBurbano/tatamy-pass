# Plantilla · Acta de purga de datos personales (T+90)

> Ley 1581 de 2012 y Decreto 1377 de 2013: los datos personales se conservan solo el tiempo necesario para la finalidad declarada. Tatami Pass los retiene **90 días** después del último día del evento y los purga ([00-DECISIONES §10](../00-DECISIONES.md), [40-SEGURIDAD §6.4](../40-SEGURIDAD-ISO27001.md)). Esta acta es la evidencia que una auditoría pediría. La firman el Administrador y el Auditor.

## 1. Alcance

| Campo | Valor |
|---|---|
| **Evento** | `nac2026` · Campeonato Nacional de Taekwondo ITF 2026 |
| **Último día del evento** | 2026-11-22 |
| **Fecha límite de retención** | 2027-02-20 (`endDate` + `TP_RETENTION_DAYS`) |
| **Fecha de esta purga** | AAAA-MM-DD |
| **Responsable** | Administrador del evento |
| **Verifica** | Auditor |

Datos que se eliminan: nombre completo, documento, fecha de nacimiento, datos del acudiente, foto, correo, teléfono, club (si identifica a una persona). Se conservan **agregados sin identificar**: conteos por rol/zona/día, reportes de cierre, la cadena de auditoría (con los campos personales ya purgados) y las claves públicas.

## 2. Inventario de dónde viven los datos (marcar cada uno)

| # | Lugar | Cómo se purga | Hecho | Hora | Quién |
|---|---|---|---|---|---|
| 1 | **Host principal** (`data/tatami.db`) | Panel › Sistema › Purga (doble confirmación con el nombre del evento) o `npm run purge -- --yes`. Antes: `npm run purge -- --dry-run` y anotar conteos. | ☐ | | |
| 2 | **Equipo de respaldo** | Misma purga (ya no replica) o borrado seguro del disco. | ☐ | | |
| 3 | **Copias de seguridad locales** (`backups/`) | Borrado seguro de la carpeta (`shred -u` o `rm` sobre disco LUKS que luego se borra). | ☐ | | |
| 4 | **USB cifradas A y B** | Borrado seguro: `cryptsetup luksErase /dev/sdX` (destruye las cabeceras) o destrucción física. | ☐ | | |
| 5 | **Nube** (Postgres en Neon) | Cron de purga / acción del panel; verificar con consulta de conteo. | ☐ | | |
| 6 | **Fotos** (Vercel Blob o `data/photos`) | Borrar el contenedor/carpeta; verificar que `GET /api/photos/<nombre>` responde 404. | ☐ | | |
| 7 | **Correos** (Resend) | Revisar retención del proveedor; borrar logs si contienen datos. | ☐ | | |
| 8 | **Scanners** | Ya desenrolados en T+1; verificar "borrar datos del sitio" en cada teléfono (o restablecimiento). | ☐ | | |
| 9 | **Listas y planillas impresas** (modo degradado) | Destruidas en T+1 con acta; adjuntar. | ☐ | | |
| 10 | **Exportes** entregados al comité (CSV/JSON cifrados) | Solicitar confirmación de borrado por escrito a cada receptor. | ☐ | | |
| 11 | **Portátiles de panel / del técnico** | Descargas, carpetas temporales, `e2e/.tmp`, capturas. | ☐ | | |

## 3. Conteos

| Dato | Antes (`--dry-run`) | Después |
|---|---|---|
| Personas con datos personales en el host (`pending`) | | 0 |
| Fotos almacenadas | | 0 |
| Inscripciones con datos en la nube | | 0 |
| Registros de auditoría (se conservan) | | igual |
| Resultado de `GET /audit/verify` | ok | ok |

Pegar aquí el resumen que imprime la purga (`purge_summary` en Sistema › Salud) y la salida del comando.

## 4. Solicitudes de supresión atendidas antes de la fecha

| Fecha | Titular (ID corto, no nombre) | Canal | Atendida el | Por |
|---|---|---|---|---|
| | | | | |

## 5. Excepciones

Datos que **no** se purgan y por qué (p. ej. obligación legal, disputa abierta). Si no hay: "Ninguna".

## 6. Declaración y firmas

Declaramos que los datos personales recogidos para la acreditación del evento fueron eliminados de todos los lugares listados, que se conservan únicamente datos agregados sin identificar y que no existen copias fuera de este inventario.

| Rol | Nombre | Firma | Fecha |
|---|---|---|---|
| Administrador del evento | | | |
| Auditor | | | |

# 40 · Seguridad y alineación ISO/IEC 27001:2022 — Tatami Pass

> Coherente con `00-DECISIONES.md` v1.0 §10. Documento técnico y de cumplimiento.

## 1. Aclaración honesta

**ISO/IEC 27001 certifica organizaciones, no software.** Lo que se certifica es un Sistema de Gestión de Seguridad de la Información (SGSI): políticas, personas, procesos y evidencias de una organización. Un programa, por sí solo, no "es ISO 27001".

Lo que sí puede hacer Tatami Pass, y es lo que hace:

1. Construirse **alineado a los controles del Anexo A** de ISO/IEC 27001:2022 (detallados en ISO/IEC 27002:2022) que aplican a un sistema de acreditación de eventos.
2. **Generar la evidencia** que una auditoría del SGSI de la organización (la federación o el comité organizador) pediría: logs inmutables, registros de acceso, inventario de dispositivos, pruebas de backup, registros de consentimiento, actas de incidentes.
3. Documentar los **controles que dependen de la organización** (personas, físico, políticas) para que el comité los ejecute. Este documento señala cuáles son.

Si el comité organizador quiere certificarse, este documento es un insumo para su declaración de aplicabilidad (SoA), no un sustituto.

## 2. Mapeo con el Anexo A (ISO/IEC 27001:2022)

Leyenda de la columna "Quién": **S** = lo cumple el software; **O** = lo cumple la organización con apoyo del software; **O*** = depende solo de la organización (Tatami Pass solo lo documenta).

### 2.1 Controles organizativos (5.x)

| Control | Nombre | Quién | Cómo lo cumple Tatami Pass | Evidencia que se genera |
|---|---|---|---|---|
| 5.1 | Políticas de seguridad de la información | O | Este documento + `50-OPERACION.md` sirven como política operativa del sistema de acreditación. | Documentos versionados en el repositorio. |
| 5.2 | Roles y responsabilidades | S/O | 7 roles del sistema (`00 §6`) con RBAC; `60-MANUALES-POR-ROL.md` define responsabilidades por rol. | Tabla `User.systemRole`; manuales firmados por cada responsable (acta T-7). |
| 5.3 | Segregación de funciones | S | Quien emite credenciales (Coordinador) no es quien las imprime (Operador) ni quien escanea (Control). El Auditor es solo lectura. El Inscriptor solo ve su club. | `AuditRecord` muestra actor y acción; informe de segregación (quién hizo qué). |
| 5.7 | Inteligencia de amenazas | O | Modelo de amenazas §3 revisado antes de cada evento. | Acta de revisión del modelo de amenazas. |
| 5.9 | Inventario de información y activos | S | Tabla `Device` (dispositivos enrolados), inventario de equipos en `50 §1`, SBOM del software. | Export de `Device`; `sbom.json` generado en CI; lista de equipo firmada en T-1. |
| 5.10 | Uso aceptable de activos | O | Sección "qué NO debes hacer" en cada manual de rol. | Acta de capacitación T-7 con firma de cada operador. |
| 5.11 | Devolución de activos | O | Procedimiento de fin de turno y cierre: devolver scanner, cerrar sesión, desenrolar (`50 §9`). | `Device.active=false` con fecha; checklist de cierre T+1. |
| 5.12 | Clasificación de la información | S | Tres niveles: público (ID corto, rol), interno (nombre, foto, club), confidencial (documento, fecha de nacimiento, datos de acudiente). | Esquema de datos con campos `*Enc` para confidencial (`30 §4`). |
| 5.14 | Transferencia de información | S | Solo TLS 1.2+; exportes cifrados; prohibido enviar listas por chat. | Logs de sync; exportes con contraseña. |
| 5.15 | Control de acceso | S | RBAC, mínimo privilegio, dispositivos enrolados, PIN. | `User`, `Device`, `AuditRecord` de inicios de sesión. |
| 5.16 | Gestión de identidades | S | Usuarios nominales (nunca compartidos); cada dispositivo tiene identidad única. | Tabla `User` y `Device`; log de creación/baja. |
| 5.17 | Información de autenticación | S | Argon2id para contraseñas; PIN con hash y bloqueo tras 3 intentos; tokens de enrolamiento de un solo uso y 10 min. | Configuración de Argon2id en código; log de intentos fallidos. |
| 5.18 | Derechos de acceso | S/O | Alta y baja de usuarios por el Administrador; revisión en T-7 y baja masiva en T+1. | `AuditRecord` de cambios de rol; checklist T+1. |
| 5.19–5.22 | Seguridad en relaciones con proveedores | O | Proveedores: Vercel, Neon, SportData. Se documentan sus condiciones y qué datos reciben. | Lista de proveedores y datos tratados (anexo del aviso de privacidad). |
| 5.23 | Seguridad en servicios en la nube | S | Nube solo para inscripción y emisión; el día del evento no es necesaria. Secretos en variables de entorno de Vercel. | Arquitectura `30 §9.2`; captura de configuración de secretos. |
| 5.24–5.26 | Gestión de incidentes | O | Runbooks de §8; reporte de incidencias desde el scanner. | `AuditRecord` tipo `INCIDENT`; acta de incidente. |
| 5.27 | Aprender de los incidentes | O | Retrospectiva en T+1. | Acta de retrospectiva. |
| 5.28 | Recolección de evidencia | S | Log de auditoría encadenado por hash, exportable y verificable. | Export firmado del `AuditRecord` + script de verificación. |
| 5.29 | Seguridad durante la disrupción | S/O | Tres niveles de resiliencia, standby, modo degradado (`00 §2, §9`). | Resultado del simulacro T-7. |
| 5.30 | Preparación TIC para continuidad | S/O | Simulacro obligatorio 7 días antes; plan de energía. | Acta del simulacro con tiempos medidos. |
| 5.31 | Requisitos legales | O | Ley 1581/2012, Decreto 1377/2013 (§7). | Aviso de privacidad publicado; registro de consentimientos. |
| 5.33 | Protección de registros | S | Append-only, hash encadenado, backups cifrados. | Verificación de cadena; log de backups. |
| 5.34 | Privacidad y PII | S | Cifrado de campos sensibles, retención 90 días, purga automática, derechos ARCO. | Log de purga; registro de solicitudes ARCO. |
| 5.36 | Cumplimiento de políticas | O | Checklist de auditoría previa (§9). | Checklist firmado. |
| 5.37 | Procedimientos operativos documentados | S | `50-OPERACION.md` y `60-MANUALES-POR-ROL.md`. | Documentos versionados. |

### 2.2 Controles de personas (6.x)

| Control | Nombre | Quién | Cómo lo cumple Tatami Pass | Evidencia |
|---|---|---|---|---|
| 6.1 | Selección | O* | El comité elige voluntarios para acreditación y puertas; se recomienda que el Coordinador y el Operador de impresión sean personas de confianza con identificación. | Lista de staff con identificación. |
| 6.2 | Términos de empleo/voluntariado | O* | Acuerdo de confidencialidad simple para quien maneja datos personales. | Acuerdo firmado. |
| 6.3 | Concienciación y formación | O | Capacitación T-7 con los manuales; simulacro. | Acta de capacitación. |
| 6.4 | Proceso disciplinario | O* | Definido por el comité. | — |
| 6.5 | Responsabilidades al terminar | O | Baja de usuarios y dispositivos en T+1. | Checklist T+1. |
| 6.6 | Confidencialidad | O | Incluido en el acuerdo 6.2 y en "qué NO debes hacer". | Acuerdo firmado. |
| 6.7 | Trabajo remoto | S | El Inscriptor de club trabaja desde cualquier lugar: solo ve su club, por HTTPS, con contraseña. | Logs de acceso de nube. |
| 6.8 | Reporte de eventos de seguridad | S | Botón "Reportar incidencia" en el scanner; alertas en el panel del supervisor. | `AuditRecord` tipo `INCIDENT`. |

### 2.3 Controles físicos (7.x)

| Control | Nombre | Quién | Cómo lo cumple Tatami Pass | Evidencia |
|---|---|---|---|---|
| 7.1–7.2 | Perímetros y entradas físicas | S/O | Es la función del producto: zonas, roles, anti-passback. La mesa de acreditación y la sala del host están en zona STAFF. | `ScanEvent` por zona. |
| 7.4 | Monitoreo físico | S/O | Panel con personas dentro por zona y alertas de duplicado; un supervisor por puerta. | Métrica `tp_inside_now`. |
| 7.5 | Protección contra amenazas físicas y ambientales | O | Host en sala cerrada, UPS, standby en otro punto físico. | Plano de red T-1. |
| 7.7 | Escritorio y pantalla despejados | O | Listas impresas de modo degradado se guardan en sobre cerrado; se destruyen en T+1. | Acta de destrucción. |
| 7.8 | Ubicación y protección de equipos | O | Host con cable de seguridad, fuera del alcance del público. | Checklist T-1. |
| 7.9 | Seguridad de activos fuera de las instalaciones | S/O | Scanners con bloqueo, PIN, sesión de 12 h; se desenrolan al perderse. | `Device.active`. |
| 7.10 | Medios de almacenamiento | S | USB de backup cifradas con LUKS ×2; se borran en T+90. | Log de backups; acta de borrado. |
| 7.11 | Servicios de soporte (energía) | O | UPS 1.000 VA, plan de energía (`50 §6`). | Prueba de autonomía en T-1. |
| 7.12 | Seguridad del cableado | O | Router y host en la misma sala; mesh inalámbrico para evitar cableado expuesto. | Plano de red. |
| 7.14 | Eliminación o reutilización segura de equipos | S/O | Purga a 90 días; desenrolar y borrar datos de la PWA en los teléfonos; host con LUKS. | Log de purga; checklist T+90. |

### 2.4 Controles tecnológicos (8.x)

| Control | Nombre | Quién | Cómo lo cumple Tatami Pass | Evidencia |
|---|---|---|---|---|
| 8.1 | Dispositivos de usuario final | S/O | Kiosk, bloqueo de pantalla, PIN, sin otras apps abiertas (§7.2). | Checklist por dispositivo T-1. |
| 8.2 | Derechos de acceso privilegiados | S | Solo ADMIN crea roles y gestiona claves; SUPERVISOR autoriza excepciones. | `AuditRecord` filtrado por acción privilegiada. |
| 8.3 | Restricción de acceso a la información | S | El scanner no recibe documento ni fecha de nacimiento; el Inscriptor solo ve su club; el Auditor es solo lectura. | Scope del snapshot (`30 §6.1`). |
| 8.4 | Acceso al código fuente | O | Repositorio privado con revisión de PR. | Configuración del repositorio. |
| 8.5 | Autenticación segura | S | Argon2id, PIN con bloqueo, tokens de un solo uso, sesiones de 12 h. | Código + logs. |
| 8.6 | Gestión de capacidad | S | Objetivos medibles (`00 §11`) y `scripts/simulate.ts`. | Resultado de la simulación. |
| 8.7 | Protección contra malware | O | Host Ubuntu actualizado, sin navegación; scanners con solo la PWA. | Checklist de hardening. |
| 8.8 | Gestión de vulnerabilidades técnicas | S | `npm audit` en CI (falla con severidad alta), SBOM, imágenes Docker sin root, dependencias fijadas. | Reporte de CI; `sbom.json`. |
| 8.9 | Gestión de configuración | S | `event.config.json` versionado; cambios registrados como `ConfigChange`. | `AuditRecord` de config. |
| 8.10 | Borrado de información | S | Purga automática a los 90 días (personas, fotos, consentimientos, backups). | Log de purga con conteos. |
| 8.11 | Enmascaramiento de datos | S | Exportes muestran documento parcial (`****1234`) salvo para ADMIN con motivo. | Formato de exportes. |
| 8.12 | Prevención de fuga de datos | S/O | Exportes cifrados con contraseña; prohibido compartir listas por chat; scanner no almacena datos confidenciales. | Política en manuales; logs de exportes. |
| 8.13 | Respaldo de información | S | Snapshot cada 5 min a USB LUKS, réplica al standby, subida a nube; restauración probada en T-7. | `tp_backup_last_success_seconds`; acta de restauración. |
| 8.14 | Redundancia | S | Host standby, scanner de reserva por puerta, dos USB. | Simulacro T-7. |
| 8.15 | Registro de eventos (logging) | S | Logs JSON, `ScanEvent`, `AuditRecord`. Sin datos sensibles en logs. | Archivos de log en backup. |
| 8.16 | Monitoreo | S | `/health`, `/metrics`, panel con semáforos y alertas. | Capturas del panel; export de métricas. |
| 8.17 | Sincronización de relojes | S | chrony en el host como NTP de la LAN; tolerancia ±5 min para QR rotativo. | `/health.ntpSynced`. |
| 8.18 | Programas utilitarios privilegiados | O | Acceso al host por SSH con llave solo para el Administrador técnico. | `authorized_keys`; log de SSH. |
| 8.20 | Seguridad de redes | O | Wi-Fi dedicada, SSID oculto, WPA3, aislamiento de clientes, sin internet (§7.3). | Captura de configuración del router. |
| 8.21 | Seguridad de servicios de red | O | Solo puertos 80/443/123 en el host; firewall por defecto deny. | `ufw status`. |
| 8.22 | Segregación de redes | O | Red de staff separada de cualquier Wi-Fi pública del coliseo. | Plano de red. |
| 8.24 | Uso de criptografía | S | Ed25519 (firma), AES-256-GCM (campos), TLS 1.2+, Argon2id, LUKS, SHA-256 (cadena de auditoría). Gestión de claves en §6. | Inventario de claves por evento. |
| 8.25–8.29 | Desarrollo seguro, pruebas | S | `packages/core` 100 % testeado; Playwright e2e; revisión de PR; pruebas de seguridad en `20-RF-TEST`. | Reportes de cobertura y CI. |
| 8.31 | Separación de entornos | S | Nube: producción vs previews (ramas Neon). Host: `TP_MODE` y bases separadas por evento. | Configuración de Vercel/Neon. |
| 8.32 | Gestión de cambios | O | Cambios en `event.config.json` durante el evento solo por ADMIN y quedan en auditoría. | `AuditRecord` `CONFIG_CHANGE`. |
| 8.34 | Protección de sistemas durante auditorías | S | El Auditor accede con rol de solo lectura; nunca se le da SSH. | `User.systemRole=AUDITOR`. |

## 3. Modelo de amenazas (STRIDE) para credenciales de evento

Activos protegidos: (1) el acceso a zonas restringidas, (2) los datos personales de participantes (incluidos menores), (3) la integridad del registro de quién entró y cuándo.

| # | Amenaza | STRIDE | Vector | Impacto | Mitigaciones | Riesgo residual |
|---|---|---|---|---|---|---|
| A1 | **QR fotocopiado** de una credencial física | Spoofing | Copia en papel del QR de un COMP o VIP. | Entrada no autorizada a tatamis/palco. | Firma válida pero: foto en pantalla del scanner (el portero compara), anti-passback (la original y la copia no entran ambas), alerta de duplicado < 2 min, holograma sobre el ID, color y franja del rol difíciles de replicar en fotocopia. | Bajo: la copia solo sirve si el original no se usa y el portero no compara la foto. |
| A2 | **Pantallazo** de credencial digital (GEN) | Spoofing | Captura del QR rotativo y reenvío por chat. | Entrada de público sin pagar. | QR rotativo con `exp` de 60 s; el pantallazo caduca. Si se reenvía en vivo (videollamada), anti-passback impide dos entradas. | Bajo. |
| A3 | **Credencial prestada** (el COMP sale y se la pasa a un amigo) | Spoofing / Elevation | Intercambio físico. | Persona no acreditada en zona restringida. | Foto en pantalla; anti-passback exige registrar salida (si el titular no salió por un scanner, el amigo recibe `ALREADY_INSIDE`); supervisor en puertas de zona T. | Medio: depende de que se registren salidas. Mitigación operativa: scanner de salida en zonas W/T. |
| A4 | **Re-emisión fraudulenta** (alguien con acceso emite credenciales "extra") | Elevation / Repudiation | Coordinador o Admin malicioso. | Credenciales válidas no autorizadas. | Toda emisión queda en `AuditRecord` encadenado con actor; cupos por rol disparan alerta al superarse; el Auditor revisa emisiones vs inscripciones aprobadas; emisión fuera de nube (en host) requiere la passphrase de la clave. | Medio: detectable a posteriori; se reduce con segregación (quien aprueba ≠ quien imprime). |
| A5 | **Insider en acreditación** (entrega credencial a quien no corresponde, o marca "entregada" sin entregar) | Repudiation / Elevation | Operador de impresión. | Credenciales en manos incorrectas. | Entrega requiere escanear la credencial + verificar documento; `deliveredAt` con actor; conteo de impresas vs entregadas; impresión de lotes solo con Coordinador presente. | Medio. |
| A6 | **Robo del host** | Information disclosure / DoS | Hurto del mini PC. | Fuga de datos personales; caída del sistema. | Disco LUKS (datos ilegibles sin passphrase); clave privada cifrada aparte; standby se promueve en 1 comando; scanners siguen solos. | Bajo para datos; medio para operación (minutos). |
| A7 | **Scanner perdido o robado** | Information disclosure / Spoofing | Teléfono extraviado. | Lista de credenciales (nombre, foto, rol) expuesta; alguien podría marcar "ingreso manual". | PIN + bloqueo de pantalla; sesión 12 h; sin datos confidenciales en el scanner; supervisor desactiva el dispositivo (`Device.active=false`) y se rechaza su sync; ingresos manuales de ese dispositivo se marcan sospechosos. | Bajo. |
| A8 | **Wi-Fi hostil (evil twin)** | Spoofing / Tampering | Un atacante levanta un SSID igual al del staff. | Scanner se conecta al falso y no sincroniza; intento de MITM. | TLS con CA interna: el host falso no tiene el certificado y la PWA rechaza; WPA3 con contraseña; SSID oculto; el scanner sigue validando offline. | Bajo: lo peor es una desconexión. |
| A9 | **Replay de eventos de sync** | Tampering | Reenviar sobres capturados para "inyectar" salidas o entradas. | Alterar anti-passback. | Idempotencia por `(origin, seq)`: un sobre repetido se ignora; cada dispositivo tiene token propio; TLS impide capturar. Un dispositivo no puede emitir sobres con `origin` de otro (el host valida `origin == deviceId` del token). | Bajo. |
| A10 | **Manipulación del log** (borrar un ingreso para ocultar un fraude) | Repudiation / Tampering | Acceso a la base del host. | Pérdida de trazabilidad. | `AuditRecord` con hash encadenado: cualquier edición rompe la cadena desde ese punto; copias en standby, USB y nube para comparar; script `tatami audit verify`. | Bajo. |
| A11 | **Denegación de servicio en puerta** (saturar el scanner con QR inválidos) | DoS | Mostrar QR basura repetidamente. | Cola en la puerta. | Verificación < 300 ms, rechazo inmediato; el supervisor aparta a la persona. | Bajo. |
| A12 | **Filtración de la clave privada** | Spoofing total | Fuga del archivo + passphrase. | Cualquiera emite credenciales válidas. | Clave cifrada, passphrase separada, solo en nube y host de emisión; rotación por evento; procedimiento de emergencia §6.4. | Bajo; impacto alto. Por eso existe el runbook. |

## 4. Controles antifraude en capas

| Capa | Control | Qué detecta o impide | Rol que actúa |
|---|---|---|---|
| **Criptográfica** | Firma Ed25519 | QR inventado o modificado. | Nadie: el scanner rechaza solo. |
| | Versión `n` + revocación sincronizada | Credencial re-emitida o anulada. | Control: rechaza; Supervisor si hay reclamo. |
| | QR rotativo 60 s (GEN) | Pantallazos. | Control. |
| **Física** | Foto impresa y foto en pantalla del scanner | Credencial prestada o copiada. | Control: compara cara con pantalla. |
| | Color + franja diagonal por rol, holograma sobre ID | Fotocopia o impresión casera. | Control / Supervisor. |
| | Lanyard por color de rol | Detección a distancia de alguien en zona equivocada. | Supervisor, staff de zona. |
| **De comportamiento** | Anti-passback por zona | Dos entradas sin salida. | Control: pide salir y volver a escanear; Supervisor autoriza excepción. |
| | Alerta de duplicado (< 2 min en dos puertas) | Copia en uso simultáneo. | Supervisor: localiza ambas personas, retiene la credencial, el Coordinador revoca y re-emite. |
| | Cupos por rol y por club | Emisión excesiva. | Coordinador / Auditor. |
| | Conteo de ingresos manuales por dispositivo | Portero que deja pasar "a mano" demasiado. | Supervisor / Auditor. |
| **Humana** | Supervisor en puertas de zonas restringidas (T, J, V) | Lo que la máquina no ve. | Supervisor. |
| | Reporte de incidencia desde el scanner | Registro inmediato con hora y puerta. | Control registra; Supervisor atiende. |
| | Auditoría T+1 | Patrones anómalos. | Auditor. |

### Qué hace cada rol ante una alerta

| Alerta | Control de entradas | Supervisor de puerta | Coordinador | Administrador |
|---|---|---|---|---|
| Duplicado (`ALERT_DUPLICATE`) | No deja pasar; pide a la persona esperar a un lado; avisa al supervisor. | Va a la puerta; verifica documento; si es copia, retiene la credencial y pide al Coordinador revocar. Registra incidencia. | Revoca la credencial, re-emite al titular legítimo con `n+1`. | Informado al cierre. |
| Credencial revocada (`REVOKED`) | No deja pasar; indica ir a acreditación. | Si la persona insiste, verifica con el Coordinador. | Explica motivo; re-emite si procede. | — |
| Ya dentro (`ALREADY_INSIDE`) | Pide que salga por un scanner y vuelva a entrar; si no hay scanner de salida, llama al supervisor. | Verifica; puede autorizar excepción con motivo (queda en log). | — | — |
| Muchos ingresos manuales en un dispositivo | — | Pregunta al operador; revisa el log del dispositivo. | — | Puede desactivar el dispositivo. |
| Dispositivo sin reportar > 5 min | Verifica Wi-Fi; sigue escaneando. | Revisa cobertura; cambia el scanner por el de reserva si hace falta. | — | Técnico revisa red. |
| Cupo superado al emitir | — | — | Detiene emisión; revisa inscripciones. | Ajusta cupo solo si está justificado (queda en log). |

## 5. Gestión de claves

### 5.1 Inventario

| Clave | Algoritmo | Dónde vive | Quién la conoce |
|---|---|---|---|
| Clave de firma del evento (`k1`, privada) | Ed25519 | Nube (variable cifrada) + host primario (archivo cifrado). **Nunca** en scanners ni standby. | Administrador del evento (passphrase). |
| Clave pública `k1` | Ed25519 | Nube, hosts, todos los scanners (en el snapshot). | Pública. |
| Clave de campos (`field_key`) | AES-256 (derivación HKDF por evento) | Nube + hosts (secreto Docker). | Administrador. |
| Passphrase de LUKS del host y de las USB | — | Solo en la cabeza del Administrador técnico y en sobre sellado en custodia del Coordinador. | 2 personas. |
| CA interna de Caddy | ECDSA P-256 | Volumen `caddy_data` del host, copiada al standby. | Administrador técnico. |
| Tokens de dispositivo | Aleatorio 32 bytes | Cada scanner (IndexedDB) + tabla `Device`. | El dispositivo. |
| Token host↔nube | Aleatorio 32 bytes | Secreto Docker + variable en Vercel. | Administrador. |

### 5.2 Generación

```bash
# En el host de emisión o en la máquina del Administrador (offline):
tatami keys generate --event nac2026 --id k1
# → secrets/signing-k1.enc  (clave privada cifrada con la passphrase pedida en consola)
# → secrets/signing-k1.pub  (clave pública, se sube a la nube y se distribuye)
tatami keys fingerprint secrets/signing-k1.pub
# → anota la huella en el acta de claves del evento
```

La passphrase: mínimo 20 caracteres, generada con un gestor de contraseñas, nunca por chat ni correo.

### 5.3 Custodia

- La clave privada cifrada se guarda en: nube (variable), host primario (`secrets/`), y una USB cifrada en custodia del Administrador (fuera de la sede).
- El standby **no** tiene la clave privada: no emite credenciales. Si hay que emitir en sede sin el primario, el Administrador carga la clave en el standby desde la USB (procedimiento de 2 min).
- Regla de dos personas: la passphrase de LUKS del host la tienen dos personas distintas (Administrador técnico y Coordinador) para que una ausencia no bloquee el evento.

### 5.4 Rotación por evento

- Cada evento tiene su propia clave (`k1` de `nac2026` no sirve para otro evento: el payload lleva `e`).
- Al cerrar el evento (T+1), la clave privada se **destruye** (borrado seguro del archivo y de la variable en Vercel). La pública se conserva para verificar el log histórico.
- Si durante el evento hay que rotar (ver 5.5), se genera `k2`, se distribuye la pública a scanners (sync) y las credenciales nuevas se firman con `k2`. Las firmadas con `k1` siguen siendo válidas salvo que se revoquen.

### 5.5 Si se filtra la clave privada

1. **Minuto 0:** el Administrador marca `k1` como comprometida en el panel. Los scanners reciben por sync `keyStatus: compromised` y pasan a modo **ámbar** para toda credencial firmada con `k1`: "Revisa con el supervisor" (comparación de foto + documento obligatoria). No se bloquea el evento.
2. **Minuto 5:** generar `k2` en el host, distribuir la pública (sync automático, < 1 min en LAN).
3. **Minuto 15:** re-emitir con `k2` primero las credenciales de zonas críticas (JUR, STAFF, MED, VIP), imprimir y canjear en la mesa de acreditación contra la credencial anterior y documento. Las credenciales `k1` canjeadas se revocan.
4. **Durante el día:** re-emitir COMP y COACH por club (el Coordinador llama a los coaches).
5. **GEN:** los QR rotativos pasan a firmarse con `k2` de inmediato; los físicos GEN se validan con foto hasta canje.
6. Registrar incidente, identificar origen de la fuga, informar al comité.

## 6. Protección de datos personales (Colombia)

### 6.1 Marco

- **Ley 1581 de 2012** (régimen general de protección de datos personales) y **Decreto 1377 de 2013** (reglamentario): finalidad, consentimiento previo, expreso e informado, aviso de privacidad, derechos del titular, tratamiento de datos de menores.
- **Responsable del tratamiento:** el comité organizador / federación (no el software ni su desarrollador). Tatami Pass es la herramienta; el **encargado** técnico es quien opera el host y la nube.
- **Datos tratados:** nombre, documento de identidad, fecha de nacimiento, club, foto, correo y teléfono del inscriptor; para menores, nombre y documento del acudiente. No se tratan datos sensibles (salud, biometría) salvo la foto, que se usa solo para identificación visual y no para reconocimiento facial (`00 §13`).

### 6.2 Menores de edad

- Art. 7 de la Ley 1581: el tratamiento de datos de menores debe responder a su interés superior y respetar sus derechos. El formulario exige **consentimiento del acudiente**: checkbox + nombre + documento del acudiente, con fecha y versión del aviso (`Person.consentAt`, `consentVersion`).
- La categoría de edad se calcula al primer día del evento; la fecha de nacimiento se cifra y solo la ven Coordinador y Administrador.
- La foto de un menor nunca se muestra en listas públicas; solo en el scanner (miniatura) y en la credencial física.

### 6.3 Consentimiento y aviso

- El formulario de inscripción muestra el aviso de privacidad (§6.6) antes del botón de enviar; el consentimiento es un checkbox no premarcado.
- Para datos importados de SportData, el comité debe haber obtenido el consentimiento en la inscripción a SportData; se registra `source=import` y se envía un correo informativo con el aviso y el canal para ejercer derechos.

### 6.4 Retención y purga (90 días)

| Dato | Retención | Qué pasa a los 90 días |
|---|---|---|
| Datos personales (Person, fotos, consentimientos) | 90 días después del último día del evento | Purga automática en nube y host: se borran las filas y los archivos; queda un registro agregado (conteos por rol y club). |
| `ScanEvent` | 90 días | Se anonimizan: se conserva `credentialId` reemplazado por hash sin sal, zona, hora y decisión, para estadísticas. |
| `AuditRecord` | 2 años (requisito de trazabilidad del comité) | Se conserva, pero los `detail` con datos personales se reemplazan por `[purgado]` manteniendo el hash de la cadena (se registra un `AuditRecord` de purga que explica la ruptura controlada). |
| Backups (USB, nube) | 90 días | Borrado seguro de USB (`cryptsetup luksErase` + sobrescritura), eliminación de snapshots en nube. |
| Listas impresas de modo degradado | Hasta T+1 | Destrucción (trituradora) con acta. |

La purga la ejecuta `tatami purge --event nac2026` en el host y un cron en la nube; ambos registran conteos. El Auditor verifica en T+90.

### 6.5 Derechos del titular (habeas data / ARCO)

| Derecho | Cómo se atiende | Plazo (Ley 1581 art. 14–15) |
|---|---|---|
| Acceso (conocer) | El Coordinador exporta la ficha de la persona desde el panel. | Consulta: 10 días hábiles. |
| Rectificación | El Coordinador corrige; si cambia nombre o foto, se re-emite credencial. | Reclamo: 15 días hábiles. |
| Cancelación (supresión) | El Coordinador marca "solicitud de supresión"; se borra tras el evento (durante el evento la credencial se revoca si la persona lo pide). | 15 días hábiles. |
| Oposición | Se registra y no se usa el dato para nada distinto a la acreditación. | 15 días hábiles. |
| Revocar consentimiento | Igual que supresión. | — |

Canal: correo `datos@<dominio del comité>` indicado en el aviso. Cada solicitud se registra como `AuditRecord` tipo `ARCO_REQUEST`.

### 6.6 Texto modelo de aviso de privacidad (formulario)

> **Aviso de privacidad — Campeonato Nacional de Taekwondo ITF 2026**
>
> **Responsable:** [Nombre del comité organizador / federación], NIT [___], [dirección], [correo datos@___], [teléfono].
>
> **Finalidad:** los datos que registras (nombre, documento, fecha de nacimiento, club, foto y datos de contacto) se usan únicamente para inscribirte en el campeonato, emitir tu credencial de acceso, controlar el ingreso a las zonas del evento y cumplir obligaciones legales del organizador. No se usan para publicidad ni se venden.
>
> **Menores de edad:** si inscribes a un menor, declaras ser su padre, madre o acudiente legal, y autorizas el tratamiento de sus datos en su interés superior.
>
> **Con quién se comparten:** con el personal de acreditación y control de accesos del evento, y con los proveedores tecnológicos que alojan el sistema (Vercel y Neon, con servidores fuera de Colombia, bajo contratos que exigen protección equivalente). Los resultados deportivos los gestiona SportData conforme a su propia política.
>
> **Cuánto tiempo:** tus datos se conservan hasta 90 días después del evento y luego se eliminan. Solo se conservan registros estadísticos sin datos que te identifiquen.
>
> **Tus derechos:** puedes conocer, actualizar, rectificar y pedir la supresión de tus datos, y revocar esta autorización, escribiendo a [datos@___]. Responderemos en los plazos de la Ley 1581 de 2012.
>
> ☐ He leído el aviso de privacidad y autorizo el tratamiento de mis datos (y de los del menor que inscribo, si aplica) con la finalidad descrita.

## 7. Hardening

### 7.1 Host (Ubuntu 24.04 LTS)

```bash
# Instalación con disco cifrado (LUKS) desde el instalador de Ubuntu: marcar "Encrypt the new Ubuntu installation".
# Después de instalar:

# 1. Usuario sin privilegios para la aplicación
sudo adduser --system --group --uid 10001 --no-create-home tatami
sudo usermod -aG docker tatami   # solo si se usa Docker rootless; si no, omitir

# 2. Actualizaciones
sudo apt update && sudo apt full-upgrade -y
sudo apt install -y unattended-upgrades ufw fail2ban chrony
sudo dpkg-reconfigure -plow unattended-upgrades   # solo parches de seguridad; se pausan 7 días antes del evento

# 3. Firewall: todo cerrado salvo lo necesario
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow from 10.10.0.0/24 to any port 22 proto tcp   # SSH solo desde LAN
sudo ufw allow 80/tcp    # solo para servir ca.crt y redirigir
sudo ufw allow 443/tcp
sudo ufw allow 123/udp   # NTP
sudo ufw enable

# 4. SSH solo por llave
sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sudo systemctl restart ssh

# 5. Sin suspensión al cerrar la tapa (portátil) y sin apagado por inactividad
sudo sed -i 's/^#\?HandleLidSwitch=.*/HandleLidSwitch=ignore/' /etc/systemd/logind.conf
sudo systemctl restart systemd-logind

# 6. Montaje de USB de backup cifrada (ver 50 §7)
```

Reglas adicionales:

- No instalar navegador ni usar el host para nada más durante el evento.
- Congelar actualizaciones y versión de la app desde T-7 (lo que pasó el simulacro es lo que se usa).
- Sesión gráfica bloqueada; el panel admin se usa desde otro portátil en la LAN.
- Verificar `/health` cada hora durante el evento (lo hace el panel; el técnico mira el semáforo).

### 7.2 Scanner (Android / iOS)

| Medida | Android | iOS |
|---|---|---|
| Bloqueo de pantalla | PIN del teléfono + biometría; bloqueo a 1 min. | Igual. |
| Modo kiosk | "Fijar pantalla" (Ajustes › Seguridad › Fijar aplicación) con la PWA instalada; o Fully Kiosk Browser si el comité lo prefiere. | "Acceso guiado" (Ajustes › Accesibilidad › Acceso guiado; triple clic). |
| PIN del operador | 6 dígitos en la app; 3 fallos → 5 min de bloqueo. | Igual. |
| Expiración de sesión | 12 h; al expirar pide PIN de nuevo. | Igual. |
| Otras apps | Sin cuentas personales; sin chat; modo avión + Wi-Fi activada (evita datos móviles y llamadas). | Igual. |
| Pantalla | Brillo al 70 %, no apagar durante uso (la PWA pide wake lock). | Igual. |
| Pérdida | El supervisor desactiva el dispositivo en el panel; "Encontrar mi dispositivo" activado. | "Buscar" activado. |
| Fin de evento | Cerrar sesión, desenrolar, borrar datos del sitio en el navegador. | Igual. |

### 7.3 Wi-Fi de staff

| Parámetro | Valor |
|---|---|
| SSID | Oculto (sin broadcast); nombre no obvio (`TP-OPS-7F2`, no `TatamiPass`). |
| Seguridad | WPA3-Personal (SAE); si un equipo no lo soporta, WPA2/WPA3 mixto. Contraseña de 16+ caracteres, se cambia por evento. |
| Aislamiento de clientes | **Activado** (AP isolation): los scanners no se ven entre sí, solo al host. |
| Internet | Sin salida a internet en la red de staff (ruta por defecto eliminada o WAN desconectada). El host sincroniza con la nube por **su propia** interfaz (hotspot 4G por USB o segunda Wi-Fi) cuando se necesita. |
| DHCP | Rango `10.10.0.100–10.10.0.199`; host `10.10.0.2` y standby `10.10.0.3` con reserva por MAC. DNS = `10.10.0.2`. |
| Banda | 2,4 GHz canales 1/6/11 (cobertura); 5 GHz para host↔standby y panel. Mesh con el mismo SSID. |
| Admin del router | Contraseña fuerte, acceso solo por cable o desde `10.10.0.2`, WPS desactivado, UPnP desactivado, firmware actualizado en T-7. |
| Red pública | Si el coliseo ofrece Wi-Fi público, es una red distinta; nunca conectar scanners ni host a ella. |

## 8. Respuesta a incidentes (runbooks cortos)

Formato de cada runbook: **Detectar → Contener → Resolver → Registrar.** Toda incidencia se registra en el panel ("Nueva incidencia") con hora, puerta, personas y decisión; el log genera el `AuditRecord`.

### 8.1 Credencial duplicada en uso

1. Detectar: alerta ámbar en scanner y en panel del supervisor (mismo QR en 2 puertas < 2 min).
2. Contener: ambos porteros retienen a la persona a un lado sin confrontar. El supervisor va a la puerta más cercana.
3. Resolver: verificar documento contra la credencial. La persona cuyo documento coincide entra; la otra credencial se retiene. El Coordinador revoca `c` y re-emite `n+1` al titular (nueva impresión en 2 min).
4. Registrar: incidencia con ambas puertas y resultado.

### 8.2 Credencial perdida por un participante

1. Participante va a acreditación con documento.
2. Coordinador verifica identidad, revoca la versión actual, re-emite `n+1`, Operador imprime y entrega.
3. La versión anterior queda revocada en todos los scanners en el siguiente sync (< 1 min en LAN).
4. Registrar.

### 8.3 Scanner perdido

1. Detectar: el operador avisa, o el dispositivo no reporta > 5 min sin razón.
2. Contener: el supervisor desactiva el dispositivo en el panel (bloquea su sync); se entrega el scanner de reserva enrolado para esa puerta.
3. Resolver: usar "Encontrar mi dispositivo" si aplica. Revisar en el panel los últimos eventos de ese dispositivo (ingresos manuales sospechosos).
4. Registrar. Al final del evento, si no aparece, informar al comité (los datos a bordo son nombre, foto, rol: informar al responsable de datos).

### 8.4 Caída del host primario

1. Detectar: panel inaccesible, `/health` no responde, scanners muestran "sin conexión" (siguen escaneando).
2. Contener: nada urgente, las puertas siguen funcionando.
3. Resolver: en el standby ejecutar `tatami promote`; verificar que los scanners reconectan (semáforo verde en el panel del standby). Investigar el primario después, no durante.
4. Registrar hora de caída y de promoción.

### 8.5 Sospecha de Wi-Fi hostil

1. Detectar: scanners que "ven" el SSID pero no sincronizan; avisos de certificado inválido en la PWA.
2. Contener: no aceptar ningún aviso de certificado. Los scanners siguen offline.
3. Resolver: el técnico escanea con un analizador de Wi-Fi (p. ej. WiFiman) los BSSID que anuncian el SSID; apaga el router falso si está al alcance o cambia el canal/contraseña del legítimo y reconecta scanners en pausa de turno.
4. Registrar.

### 8.6 Cadena de auditoría rota

1. Detectar: `tatami audit verify` falla en el host o en el backup.
2. Contener: comparar con la copia del standby y la de nube; identificar desde qué `seq` difieren.
3. Resolver: la copia íntegra (que verifica) es la válida; se documenta la discrepancia; se revisa quién tuvo acceso al host.
4. Registrar como incidente de seguridad; informar al comité.

### 8.7 Solicitud de supresión de datos durante el evento

1. El participante lo pide en acreditación con documento.
2. Coordinador revoca la credencial (no puede seguir participando sin ella; se le explica) y marca `supresión solicitada`.
3. La purga se ejecuta en T+1 en lugar de T+90 para esa persona.
4. Registrar `ARCO_REQUEST`.

### 8.8 Filtración de la clave privada

Ver §5.5.

## 9. Checklist de auditoría previa al evento (T-7 a T-1)

Marcar cada ítem con fecha y responsable. Se archiva como evidencia.

**Claves y secretos**
- [ ] Clave `k1` del evento generada; huella anotada en acta; pública cargada en nube y en host.
- [ ] Passphrase de la clave y de LUKS en custodia de dos personas; sobre sellado.
- [ ] Token host↔nube rotado para este evento.
- [ ] Contraseña Wi-Fi nueva, no reutilizada.

**Host y standby**
- [ ] Ubuntu actualizado; `unattended-upgrades` pausado desde T-7.
- [ ] LUKS activo (`lsblk -f` muestra `crypto_LUKS`).
- [ ] `ufw status` muestra solo 22 (LAN), 80, 443, 123.
- [ ] SSH sin contraseña (`sshd -T | grep passwordauthentication` → `no`).
- [ ] `/health` OK; `ntpSynced=true`; `backupAgeSec < 600`.
- [ ] Standby con snapshot completo; `tp_standby_lag_events = 0`; `tatami promote` probado y revertido.
- [ ] CA de Caddy copiada al standby; certificado válido en ambos.
- [ ] Restauración desde USB probada en una máquina limpia.

**Dispositivos**
- [ ] Inventario de scanners (modelo, IMEI o serie, puerta asignada) firmado.
- [ ] Cada scanner: certificado raíz instalado, PWA instalada, enrolado, PIN definido, kiosk activo, modo avión + Wi-Fi, brillo 70 %, batería 100 %, power bank asignado.
- [ ] Scanner de reserva enrolado por puerta.
- [ ] Sin cuentas personales ni apps de chat en los scanners.

**Datos personales**
- [ ] Aviso de privacidad publicado en el formulario con la versión vigente.
- [ ] Consentimientos de menores completos (reporte "menores sin consentimiento" = 0).
- [ ] Datos importados de SportData con correo informativo enviado.
- [ ] Canal `datos@` operativo y asignado al Coordinador.
- [ ] Cron de purga a 90 días programado en nube y host.

**Personas y procesos**
- [ ] Usuarios nominales creados con rol correcto; ninguna cuenta compartida.
- [ ] Acuerdos de confidencialidad firmados por Coordinador, Operador de impresión y Supervisores.
- [ ] Capacitación realizada con manuales; acta firmada.
- [ ] Simulacro T-7 ejecutado: corte de energía, caída del host, pérdida de scanner, duplicado. Tiempos anotados.
- [ ] Listas de modo degradado impresas, en sobre cerrado por puerta, con planilla manual.
- [ ] Runbooks de §8 impresos en la sala del host.

**Red**
- [ ] SSID oculto, WPA3, aislamiento de clientes, sin internet en la red de staff.
- [ ] Cobertura medida en cada puerta (RSSI ≥ −70 dBm).
- [ ] Firmware del router/mesh actualizado; WPS y UPnP desactivados.
- [ ] Router y host en UPS; prueba de autonomía ≥ 45 min realizada.

**Software**
- [ ] CI verde: tests de `packages/core` al 100 %, `npm audit` sin severidad alta, SBOM generado.
- [ ] Versión desplegada en host = versión del simulacro (hash de imagen anotado).
- [ ] `tatami audit verify` pasa sobre la base del host.

# 34 · Tatami Radio — voz en tiempo real por la red local

> Comunicación por voz entre scanners y panel, por canales, **sin internet**, para coordinar y dar órdenes el día del evento. Decisión y alternativas: [ADR-0010](./95-ADR/0010-voz-en-tiempo-real-por-lan.md). Cómo usarla por rol: [60 §5 y §6](./60-MANUALES-POR-ROL.md). Protocolo de órdenes en operación: [50 §12](./50-OPERACION.md). Config: [32 §5.3](./32-CONFIG-EVENTO.md).

## 1. Qué es en una frase

Un walkie-talkie dentro de la PWA: mantienes pulsado el botón grande, hablas, sueltas. Los demás del canal te oyen al instante. El supervisor además manda **órdenes predefinidas** ("Abrir Puerta 3") que suenan, vibran y se leen en voz alta en el scanner, y cada operador confirma con **Recibido**.

## 2. Cómo funciona

```
 Scanner A ──┐                               ┌── Scanner B
             │  WebSocket /radio/ws (señal)  │
             ├────────── Host ───────────────┤   ← presencia, SDP/ICE, PTT, órdenes, acuses
             │                               │
 Scanner A ══╪═══════ audio Opus P2P ════════╪══ Scanner B   ← DTLS-SRTP, nunca pasa por el host
             │                               │
             └──════ audio P2P ══ Panel (supervisor en el portátil)
```

- **Señalización** (`apps/host/src/radio.ts`, `routes/radio.ts`): el host mantiene las salas (una por canal), sabe quién está, reparte las ofertas/respuestas WebRTC entre pares, arbitra quién habla y difunde órdenes y acuses. Se autentica con el mismo `deviceToken` del scanner o el token de sesión del panel, enviado como subprotocolo del WebSocket (`['tatami-radio', '<token>']`) porque el navegador no puede poner cabeceras en un WebSocket.
- **Audio** (`apps/scanner/src/radio/client.ts`): una `RTCPeerConnection` por compañero de canal, solo candidatos `host` (misma LAN; sin STUN ni TURN), Opus mono con `echoCancellation`, `noiseSuppression` y `autoGainControl`. La pista del micrófono existe desde que se enciende la radio pero está **deshabilitada** (silencio) salvo mientras el host concede la palabra. Cifrado DTLS-SRTP obligatorio (WebRTC no permite otra cosa).
- **Quién ofrece**: el que entra al canal ofrece a los que ya estaban; los que ya estaban esperan. Si dos ofrecen a la vez, cede el de id mayor. Tras una reconexión solo se renegocia con quien no siga `connected`.
- **PTT** (`RadioArbiter` en `packages/core/src/radio.ts`): un hablante por canal. El primero que pulsa habla; el segundo ve **Ocupado · Puerta 1 está hablando · sigue pulsando y te toca** y entra en cola: si sigue pulsando cuando el primero suelta, el host le concede la palabra y su micrófono se abre solo.
- **Emergencia**: canal con `emergency: true` y prioridad 100. Quien habla allí interrumpe: los demás canales quedan ocupados, todos los clientes reciben `emergency`, suenan la sirena de dos tonos, vibran y saltan al canal Emergencia; 5 s después de que termine, vuelven solos al canal donde estaban. Desde el scanner se habla en Emergencia manteniendo pulsado el botón rojo **🚨 Emergencia** (entra al canal y pide la palabra en un gesto).
- **Órdenes**: el supervisor (panel o scanner con rol Supervisor) elige una del catálogo, opcionalmente la puerta (`{n}`) y el destino (canal o puerta concreta). El scanner la recibe, suena (`order`), vibra, la lee con `speechSynthesis` (voz es-CO si está instalada, si no cualquier español) y abre el panel de radio con el botón **Recibido**. El acuse vuelve al emisor y a todos los paneles ("Puerta 3 recibió 10:42"). Sin host, el acuse queda pendiente y se envía al reconectar.
- **Log**: cada palabra concedida (al soltar), cada orden y cada acuse se guardan como eventos `EVENT` del dispositivo virtual `radio` en `scan_events` (mismo log append-only de los escaneos; se replican al respaldo y entran en las copias). `GET /radio/events?date=` los devuelve por día; el panel › Radio › Historial los muestra. **No se graba audio** por defecto (ni hay opción: habría que decidirlo en un ADR nuevo con base legal).

## 3. Protocolo de mensajes (resumen)

Tipos completos en `packages/core/src/radio.ts` (`RadioClientMessage`, `RadioServerMessage`).

| Cliente → host | Qué hace | Host → cliente(s) |
|---|---|---|
| (conexión) | Autentica por subprotocolo | `welcome { self, channels, orders, emergency }` |
| `join { channel }` | Entra (y sale del anterior) | Al que entra `presence { participants, speaker }`; a los demás `peer-joined`; al canal anterior `peer-left` |
| `leave` / cierre | Sale | `peer-left` al canal; si hablaba, `speaking null` |
| `offer/answer { to, sdp }`, `ice { to, candidate }` | Negociación WebRTC | Reenvío al destinatario con `from` (nunca al emisor; nunca audio) |
| `ptt-start` | Pide la palabra | `ptt-granted` o `ptt-busy { speaker, position }` o `error`; al canal `speaking { speaker }`; si es Emergencia, a todos `emergency { active: true }` |
| `ptt-end` | Suelta | `ptt-ended`; al siguiente de la cola `ptt-granted`; al canal `speaking`; si era Emergencia, `emergency { active: false }` |
| `order { code, gate?, channel? \| to? }` | Envía una orden | `order { order }` a los destinatarios, al emisor y a todos los usuarios del panel |
| `ack { orderId }` | Acusa recibo | `ack { orderId, by, at }` al que acusa, al emisor de la orden y a los paneles |
| `ping` | Latido | `pong`; además el host hace ping WebSocket cada 20 s y cierra a quien no responde |

Errores siempre como `error { error: "texto humano" }` (catálogo en docs/70 §4.5). Estado consultable sin WebSocket: `GET /radio/status` (canales, quién está, quién habla, cola, emergencia, últimas órdenes con acuses) y `GET /health` (`radio: N` equipos conectados).

## 4. Canales y permisos

Por defecto (`radio.channels`, editable en panel › Radio › Canales y órdenes):

| Canal | Hablan | Escuchan | Para qué |
|---|---|---|---|
| Puertas | todos | todos | Coordinación del día a día entre porteros y supervisores. |
| Supervisores | SUPERVISOR, ADMIN, COORDINATOR | los mismos | Decisiones sin ruido de las puertas. |
| Acreditación | ADMIN, COORDINATOR, PRINTER, REGISTRAR, SUPERVISOR | los mismos | Mesa de acreditación e impresión. |
| Emergencia 🚨 | todos | todos | Interrumpe a todos. Solo para eso. |

Roles de scanner: `CONTROL`, `SUPERVISOR` (los del enrolamiento). Roles de panel: los de `/auth` (`ADMIN`, `COORDINATOR`, `PRINTER`, `REGISTRAR`, `SUPERVISOR`, `AUDITOR`). Un rol que puede escuchar pero no hablar ve "En {canal} solo escuchas". Órdenes: solo `ADMIN`, `COORDINATOR` y `SUPERVISOR` (usuario o scanner Supervisor).

## 5. Requisitos de red y límites prácticos

- **Ancho de banda**: Opus a 32 kbps + RTP/SRTP ≈ **40 kbps por par** mientras alguien habla. En una malla el hablante sube a cada compañero: en un canal de 10 equipos, **~360 kbps de subida** para quien habla y 40 kbps de bajada para cada oyente. En silencio (PTT suelto) el consumo es casi nulo (paquetes de confort y latidos).
- **CPU y batería**: Opus es barato; lo que pesa es mantener N−1 conexiones DTLS. Con ≤ 10 por canal un celular de gama media aguanta el turno con power bank (igual que ya exige el runbook). Por eso `radio.maxPerChannel` es 10 por defecto y la recomendación es **canales pequeños**: Puertas para porteros, Supervisores aparte.
- **Wi-Fi**: misma red de staff del host (docs/50 §2); nada de red de invitados. Para supervisores que se mueven, **5 GHz** si el sitio lo permite (menos interferencia que 2,4 GHz en un coliseo lleno). El aislamiento de clientes (client isolation) **debe estar apagado** en la Wi-Fi de staff: la malla es tráfico directo entre celulares.
- **Latencia**: en LAN, 50–150 ms de boca a oreja. La primera conexión entre dos equipos tarda 0,3–0,8 s (ICE con candidatos host). Un salto a Emergencia implica esa renegociación: el tono de aviso cubre el hueco.
- **HTTPS**: `getUserMedia` exige contexto seguro. Con la app de escritorio (Caddy) o Docker + Caddy (ADR-0005) ya se cumple; en desarrollo vale `localhost`.
- **Primer plano**: la radio funciona con el scanner abierto y la pantalla encendida (como el escaneo). **iOS** corta el micrófono y el audio de una PWA al pasar a segundo plano o bloquear la pantalla; **Android** lo tolera unos segundos y después también. El modo kiosk del scanner (wake lock) evita que la pantalla se apague sola.
- **Botones físicos**: el navegador no deja usar el botón de volumen ni uno lateral como PTT. En un portátil sirve la **barra espaciadora** (no cuando se escribe en un campo). En el celular, el botón grande de pantalla (≥ 120 px; 150 px en modo guantes).
- **Cuando cae el host**: las conexiones vivas siguen y el PTT pasa a **"Hablando (sin host)"**: hablas con quien ya estaba conectado, sin arbitraje (si dos hablan a la vez, se pisan). No se puede entrar a un canal nuevo ni mandar órdenes hasta que vuelva el host o el respaldo promovido; el WebSocket reintenta cada 1 → 10 s y al volver solo renegocia con quien haga falta. Los acuses pendientes se envían entonces.
- **Respaldo (standby)**: la radio también funciona contra el respaldo promovido (misma URL que el scanner ya cambia). En standby (sin promover) la señalización funciona pero no se escriben eventos en el log (las escrituras van al principal).

## 6. Seguridad

- Autenticación con los mismos tokens del sistema (scanner enrolado o sesión del panel); un scanner desactivado recibe 401 al conectar.
- Audio cifrado extremo a extremo (DTLS-SRTP); el host solo ve SDP/ICE, nunca medios. Las SDP contienen IPs privadas de la LAN de staff: por eso el WebSocket va por HTTPS/WSS (ADR-0005).
- Sin grabación. El log guarda quién habló, dónde y cuánto, y las órdenes/acuses (hechos operativos, sin PII más allá del nombre del equipo o usuario).
- Solo `ADMIN` cambia canales y catálogo; el host valida (`validateEventConfig`: ids, colores, exactamente un canal de emergencia, `{n}` en órdenes con puerta, máximo 2–30 por canal).

## 7. Respaldos documentados

1. **Radios físicas** (docs/50 §1 y §12): siguen en la lista de compras. Si el Wi-Fi de staff falla, se usan; el protocolo de órdenes es el mismo (quién, qué, puerta, "recibido").
2. **Mumble** (servidor `murmur` en el host + app Mumble en los celulares): para sedes con > 15 equipos por canal o si hace falta voz con pantalla apagada. Exige instalar una app y repartir credenciales de otro sistema; no integra órdenes ni log. Instrucciones mínimas: `apt install mumble-server`, puerto 64738 TCP/UDP en la LAN de staff, contraseña del servidor en el sobre del técnico.

## 8. Cómo probarla

- Automático: `npm test` (árbitro en core, hub en host con `ws` real, cliente del scanner con dobles) y `npx playwright test tc-120 -w e2e` (dos Chromium con micrófono falso: audio real, bytes recibidos > 0, ocupado, orden con acuse desde `/admin`, host caído y recuperado).
- Con dos celulares: [80 §3.1](./80-COMO-PROBAR.md).

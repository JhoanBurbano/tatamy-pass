# ADR-0010 · Voz en tiempo real por la LAN ("Tatami Radio"): malla WebRTC por canal con pulsar-para-hablar

| Campo | Valor |
|---|---|
| **Estado** | Aceptado |
| **Fecha** | 2026-10-24 |
| **Decide** | Equipo Tatami Pass (ingeniería + operación) |
| **Afecta a** | `packages/core` (`radio.ts`, `types.ts`, `config-validation.ts`), `apps/host` (`radio.ts`, `routes/radio.ts`), `apps/scanner` (`src/radio/`), `apps/host-admin` (página Radio), `e2e` (TC-120), docs 20, 32, 34, 50, 60, 70, 80 |

## Contexto

El día del evento hay 8–12 puertas con scanner y 2–3 supervisores moviéndose por el coliseo. Hoy la coordinación depende de radios físicas (runbook §1) o de gritar: "abran la puerta 3", "pausen el ingreso", "supervisor a tatamis". Las radios cuestan, se pierden, tienen canales limitados y no dejan rastro de qué se ordenó y quién lo recibió. Lo que necesitamos es **voz en tiempo real, por canales, sin internet** (invariante 2: nada nuevo puede exigir nube en la puerta), **sin instalar apps extra** en los celulares (ADR-0003: el scanner es una PWA), que **no muera si cae el host** (ADR-0004 y el standby ya cubren los datos; la voz no debería ser más frágil) y que deje un registro de órdenes y acuses en el mismo log append-only.

Fuerzas que chocan: calidad y latencia (una orden debe oírse ya) contra CPU y batería de celulares baratos; "todos oyen a todos" contra canales pequeños y silencio cuando nadie habla; simplicidad (nada nativo en el host, ADR-0006) contra capacidad (muchos participantes por canal); y seguridad (el audio del staff no debe poder escucharse desde la red de invitados).

## Decisión

**Tatami Radio = malla WebRTC P2P por canal entre las PWAs (scanner y panel), con el host solo como señalización por WebSocket, Opus con cancelación de eco y supresión de ruido, micrófono silenciado salvo "pulsar para hablar" (PTT) y un árbitro de palabra en el host.** Las radios físicas siguen como respaldo documentado (docs/50 §12).

Detalle:

- **Señalización**: `GET /radio/ws` (`@fastify/websocket`, única dependencia nueva, JS puro) autenticado con el `deviceToken` o el token de sesión como subprotocolo (`['tatami-radio', '<token>']`; `?token=` como alternativa). Mensajes JSON tipados en `packages/core/src/radio.ts` (`join`, `leave`, `offer`, `answer`, `ice`, `ptt-start`, `ptt-end`, `order`, `ack`, `ping` ↔ `welcome`, `presence`, `peer-joined`, `peer-left`, `offer`, `answer`, `ice`, `ptt-granted`, `ptt-busy`, `ptt-ended`, `speaking`, `emergency`, `order`, `ack`, `error`, `pong`). **El host nunca recibe ni reenvía audio.**
- **Malla por canal**: cada participante tiene una `RTCPeerConnection` con cada compañero de su canal (solo candidatos `host`, sin STUN/TURN: todos están en la misma LAN). Quien entra ofrece a los que ya estaban; quien ya estaba espera la oferta. Colisiones: cede el id mayor. El audio va cifrado extremo a extremo con DTLS-SRTP (es lo único que WebRTC permite).
- **PTT con árbitro**: un hablante por canal. `RadioArbiter` (puro, en core) concede la palabra al primero que la pide; el segundo recibe `ptt-busy` y entra en cola: si sigue pulsando cuando el primero suelta, le toca. El canal **Emergencia** interrumpe: mientras alguien habla allí, los demás canales están ocupados y todos los clientes saltan a Emergencia (tono y vibración distintos) y vuelven solos 5 s después de que termine.
- **Órdenes con acuse**: catálogo editable en `event.config.json › radio.orders` ("Abrir Puerta {n}", "Cerrar Puerta {n}", "Pausar ingreso", "Reanudar ingreso", "Supervisor a Puerta {n}", "Evacuación"). El supervisor las envía a un canal o a una puerta; el scanner suena, vibra y la **lee en voz alta** (`speechSynthesis`, es-CO si existe) y el operador toca **Recibido**; el panel ve "Puerta 3 recibió" al instante.
- **Log**: `radio_ptt` (quién habló, en qué canal, cuándo y cuánto), `radio_order` y `radio_ack` se guardan como `ScanEvent` con `decision: 'EVENT'` bajo el dispositivo virtual `radio` (seq que asigna el host) en el mismo log append-only de los escaneos (ADR-0004). **No se graba audio.**
- **Resiliencia**: si el host cae, las conexiones P2P ya establecidas siguen y el PTT pasa a "modo local" (sin arbitraje, hablas con quien ya estaba). El WebSocket reintenta con backoff (1 → 10 s); al volver el host (o el respaldo), el cliente vuelve a entrar al canal y solo re-señaliza con quien no siga conectado.
- **Límites declarados**: ~10 participantes por canal (`radio.maxPerChannel`, validado 2–30), ~40 kbps por par (Opus 32 kbps + cabeceras), solo con el scanner en primer plano, HTTPS obligatorio (ADR-0005).

## Alternativas consideradas

| Alternativa | Por qué no |
|---|---|
| **(b) SFU en el host** (mediasoup, Pion, LiveKit) | Escala mejor (cada equipo sube una sola vez) y permitiría grabar, pero exige módulos nativos o un binario Go en el host (choca con ADR-0006 y con la app de escritorio Electron, que no recompila nativos), mete el audio por el host (si cae, se cae la voz: justo lo que no queremos) y añade un servicio más que operar el día D. Con ≤ 12 equipos por canal la malla alcanza. **Queda como camino si crecemos** (> 15 por canal o eventos con 30 puertas): la señalización y la UI no cambiarían. |
| **(c) Servidor Mumble en el host + app Mumble** | Excelente calidad, PTT nativo, funciona con pantalla apagada y cientos de usuarios. Pero obliga a instalar y configurar una app en cada celular (ADR-0003), a repartir certificados/contraseñas de otro sistema, no integra órdenes con acuse ni el log, y el host necesita un servicio nativo más (`murmur`). **Respaldo documentado** en docs/34 §7 para sedes grandes. |
| **(d) Radios físicas (walkie-talkie)** | Ya están en el runbook y siguen siendo el **respaldo**: no dependen de Wi-Fi ni de batería del celular. Pero cuestan, se pierden, no dejan rastro de órdenes/acuses, tienen pocos canales y no entran en el inventario que ya administra el panel. |
| Audio por WebSocket (chunks PCM/Opus vía el host) | Sin WebRTC se pierde cancelación de eco, jitter buffer y cifrado SRTP; el host tendría que mezclar; si cae el host cae la voz. |
| Multicast/mDNS sin host | Los navegadores no pueden abrir sockets UDP ni multicast; haría falta app nativa. |
| Malla única (todos con todos, canales solo lógicos) | Emergencia instantánea sin renegociar, pero cada equipo mantiene N−1 conexiones siempre y el hablante sube a todos los equipos del evento aunque sean de otro canal. Con 15 equipos duplica consumo frente a la malla por canal. Descartada; Emergencia se resuelve con el salto automático de canal (≈ 0,3–0,8 s en LAN). |

## Consecuencias

**Positivas**: voz entre puertas y supervisores sin internet, sin apps nuevas y sin dependencias nativas; órdenes que quedan en el log con quién las recibió; el audio sobrevive a la caída del host; cifrado DTLS-SRTP obligatorio; todo probado en Node (árbitro y cliente con dobles) y en Chromium real (TC-120: bytes de audio recibidos > 0).

**Negativas / costos**: el hablante sube ~40 kbps × (N−1); en un canal de 10, ~360 kbps de subida mientras habla (Wi-Fi 5 GHz recomendado para supervisores). Solo funciona con la PWA en primer plano y la pantalla encendida (iOS corta el micrófono en segundo plano; Android lo tolera unos segundos). Hablar en Emergencia desde otro canal implica un salto de canal (≈ 1 s) antes de que todos oigan; el tono de aviso cubre ese hueco. El árbitro vive en memoria del host: al reiniciar se pierde la cola (no los eventos del log). El panel reutiliza el cliente del scanner por ruta relativa (`apps/host-admin` → `apps/scanner/src/radio`), un acoplamiento que habría que mover a un paquete si crece.

**Qué vigilar**: más de ~12 participantes por canal, CPU/batería en celulares de gama baja con 10 conexiones, o la necesidad de grabar (cumplimiento) → reabrir con la opción (b) SFU. Si iOS sigue sin permitir micrófono en segundo plano en PWA y los supervisores lo necesitan → (c) Mumble para supervisores.

## Referencias

- `docs/34-VOZ-RADIO.md` (cómo funciona, protocolo, límites, requisitos de red), `docs/50-OPERACION.md` §12, `docs/60-MANUALES-POR-ROL.md` §5 y §6, `docs/70-UX-WRITING.md` §4.5, `docs/20-RF-TEST.md` (TC-120)
- Código: `packages/core/src/radio.ts`, `apps/host/src/radio.ts`, `apps/host/src/routes/radio.ts`, `apps/scanner/src/radio/`, `apps/host-admin/src/pages/Radio.tsx`
- Tests: `packages/core/test/radio.test.ts`, `apps/host/test/radio.test.ts`, `apps/scanner/test/radio-client.test.ts`, `e2e/specs/tc-120-radio-voz.spec.ts`

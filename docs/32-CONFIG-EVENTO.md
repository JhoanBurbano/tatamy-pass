# 32 · Configuración del evento (`event.config.json`)

> **Generado automáticamente** por `scripts/docs/gen-config.ts` (`npm run docs:gen`) a partir de `packages/core/src/types.ts`, `default-config.ts` y `config-validation.ts`. Para cambiar algo aquí, cambia el JSDoc del tipo o la regla de validación y vuelve a generar.

El archivo vive en `apps/host/event.config.json` (o donde apunte `TP_EVENT_CONFIG`). Se edita desde el panel › **Evento y roles** (valida, guarda y recarga en caliente) o a mano con el host apagado. La nube (`apps/registration`) usa la misma forma (`EVENT_CONFIG_PATH`) para cupos, edades y acompañantes del formulario. Cómo cambiar roles y cupos paso a paso: [50-OPERACION.md §5](./50-OPERACION.md).

## 1. Raíz (`EventConfig`)

Configuración completa de un evento (`event.config.json`).

| Campo | Tipo | Qué es | Por defecto | Validación |
|---|---|---|---|---|
| `eventId` | `string` | Identificador del evento; va dentro del QR (`e`), p. ej. `nac2026`. | `"nac2026"` | El id del evento solo admite letras, números, guion y guion bajo. |
| `name` | `string` | Nombre completo del evento (se imprime y se pide como confirmación en la purga). | `"Campeonato Nacional de Taekwondo ITF 2026"` | El evento necesita un nombre. |
| `idPrefix` | `string` | Prefijo de IDs cortos, p. ej. `TP-2026`. | `"TP-2026"` | El prefijo de IDs solo admite mayúsculas, números y guiones (p. ej. TP-2026). |
| `startDate` | `IsoDate` | Primer día del evento; referencia para calcular edades y vigencia. | `"2026-11-20"` | La fecha de inicio debe tener formato AAAA-MM-DD. |
| `endDate` | `IsoDate` | Último día del evento (inclusive). | `"2026-11-22"` | La fecha de fin debe tener formato AAAA-MM-DD. · La fecha de fin no puede ser anterior a la de inicio. |
| `utcOffsetMinutes` | `number` | Desfase respecto a UTC en minutos (Colombia = -300). | `-300` | El desfase horario debe ser un número entero de minutos (Colombia = -300). |
| `zones` | `Zone[]` | Ver §2. | 9 elementos (ver más abajo) | Define al menos una zona. |
| `roles` | `AccessRole[]` | Ver §3. | 10 elementos (ver más abajo) | Define al menos un rol de acceso. |
| `ageCategories` | `AgeCategory[]` | Ver §4. | 5 elementos (ver más abajo) | Las categorías de edad deben ser una lista. · Las categorías … y … se solapan en edad. |
| `duplicateWindowSeconds` | `number` | Ventana para alerta de QR duplicado en otra puerta (segundos). | `120` | — |
| `digitalTokenWindowSeconds` | `number` | Vida de un token digital rotativo (segundos). | `60` | — |
| `clockToleranceSeconds` | `number` | Tolerancia de reloj para tokens rotativos (segundos). | `300` | — |
| `signingKeys` | `SigningKey[]` | El host la **sobrescribe al arrancar** con la clave pública de `keys/signing.enc.json` (`kid` + `publicKeyHex`), así que no hace falta editarla a mano. Los scanners la reciben en el snapshot y con ella verifican los QR. | `[]` | — |
| `companions` | `{ perParticipant: number \| null; total: number \| null }` | Límites de acompañantes por participante y totales (`null` = sin límite). | `{"perParticipant":2,"total":null}` | Faltan los límites de acompañantes. |
| `totalCapacity` | `number \| null` | Aforo total del evento (personas con credencial). `null` = sin límite. | `2000` | El aforo total debe ser un entero o "sin límite". |
| `registration` (opcional) | `RegistrationOptions` | Opciones del formulario de inscripción (nube). Opcional: por defecto nada es obligatorio. Ver §5.1. | — | — |
| `radio` (opcional) | `RadioConfig` | Tatami Radio (voz por la LAN entre scanners y panel). Opcional: si falta se usan los canales y órdenes por defecto. Ver §5.3. | canales y órdenes por defecto (ver §5.3) | La configuración de radio debe ser un objeto con canales y órdenes. |
| `configVersion` | `number` | Versión monotónica; sirve para LWW en sync. La incrementa el host en cada `PUT /config`. El panel la envía como `expectedVersion`: si otro admin guardó antes, 409. | `1` | — |
| `updatedAt` | `IsoDateTime` | La pone el host al guardar. | `"2026-10-09T00:00:00.000Z"` | — |

## 2. Zonas (`zones[]`, tipo `Zone`)

Zona con control de acceso (una o varias puertas).

| Campo | Tipo | Qué es | Por defecto | Validación |
|---|---|---|---|---|
| `code` | `string` | Código corto, p. ej. `G`, `W`, `T`, `P`, `J`, `V`, `H`, `S`, `M`. | — | El código de zona va en mayúsculas, sin espacios (p. ej. T). · La zona … está repetida. |
| `name` | `string` | Nombre que ven operadores y participantes, p. ej. `Tatamis`. | — | La zona necesita un nombre. |
| `tracksExit` | `boolean` | Si la zona controla salida (necesario para anti-passback). | — | Indica si la zona controla salida (sí/no). |

Reglas de la lista: Define al menos una zona.

Zonas por defecto:

| Código | Nombre | Controla salida |
|---|---|---|
| `G` | Gradería | no |
| `W` | Área de calentamiento | sí |
| `T` | Tatamis | sí |
| `P` | Pesaje | sí |
| `J` | Sala de jueces | sí |
| `V` | Palco | sí |
| `H` | Zona de hospitalidad | sí |
| `S` | Stands | no |
| `M` | Zona de prensa | sí |

## 3. Roles de acceso (`roles[]`, tipo `AccessRole`)

Rol de acceso (tipo de entrada). Configurable en event.config.json.

| Campo | Tipo | Qué es | Por defecto | Validación |
|---|---|---|---|---|
| `code` | `string` | Código en mayúsculas, p. ej. `COMP`. Va dentro del QR (`r`). | — | El código del rol va en mayúsculas, sin espacios (p. ej. COMP). · El rol … está repetido. |
| `name` | `string` | Nombre impreso en la credencial, p. ej. `Competidor`. | — | El rol necesita un nombre. |
| `zones` | `string[]` | Zonas permitidas. `['*']` = todas. | — | El rol necesita al menos una zona (o * para todas). · La zona … no existe. |
| `days` | `IsoDate[] \| null` | Días válidos (`YYYY-MM-DD`). `null` = todos los días del evento. | — | Los días válidos deben ser fechas AAAA-MM-DD o "todos los días". · El día … está fuera del evento. |
| `capacity` | `number \| null` | Cupo máximo de credenciales emitidas. `null` = sin límite. | — | El cupo debe ser un número entero o "sin límite". |
| `requiresPhoto` | `boolean` | Si la credencial lleva foto (obligatoria en la inscripción). | — | Indica si el rol requiere foto. |
| `color` | `string` | Color hex de fondo/franja en la credencial impresa. | — | El color debe ser hexadecimal de 6 dígitos (p. ej. #1C4FD1). |
| `allowsDigital` | `boolean` | Si admite credencial digital (QR rotativo en el celular) en vez de impresa. | — | Indica si el rol admite credencial digital. |
| `antiPassbackZones` | `string[]` | Zonas donde aplica anti-passback para este rol. `['*']` = todas. | — | La zona … no existe. · Las zonas con anti-passback deben ser una lista (puede estar vacía). |

Reglas de la lista: Define al menos un rol de acceso. El rol `ACOMP` (acompañante) es especial: no cuenta contra su propio cupo sino contra `companions` y `totalCapacity` (ver [00-DECISIONES.md §7](./00-DECISIONES.md)).

Roles por defecto:

| Código | Nombre | Zonas | Cupo | Foto | Digital | Anti-passback | Color |
|---|---|---|---|---|---|---|---|
| `GEN` | General | G | 1500 | no | sí | — | `#64748B` |
| `COMP` | Competidor | G, W, T, P | 1200 | sí | no | W, T, P | `#1C4FD1` |
| `COACH` | Coach / Entrenador | G, W, T | 300 | sí | no | W, T | `#0E7490` |
| `JUR` | Jurado / Árbitro | G, W, T, J | 80 | sí | no | J | `#0F172A` |
| `VIP` | VIP | G, V, H | 100 | sí | no | V | `#B45309` |
| `SPON` | Patrocinador | G, H, S | 60 | sí | no | — | `#7C3AED` |
| `PRESS` | Prensa | G, M, T | 40 | sí | no | M | `#DB2777` |
| `MED` | Médico | * | 20 | sí | no | — | `#16A34A` |
| `STAFF` | Staff / Organización | * | 150 | sí | no | — | `#E0323B` |
| `ACOMP` | Acompañante | G | sin límite | no | sí | — | `#6B7F99` |

## 4. Categorías de edad (`ageCategories[]`, tipo `AgeCategory`)

La edad se calcula a la fecha de `startDate`. Un competidor (`COMP`) debe caer en una categoría; si elige otra, el formulario y la emisión en sitio lo bloquean y explican cuál le corresponde.

| Campo | Tipo | Qué es | Por defecto | Validación |
|---|---|---|---|---|
| `code` | `string` | Código en mayúsculas, p. ej. `JUV`. | — | El código de la categoría va en mayúsculas, sin espacios. · La categoría … está repetida. |
| `name` | `string` | Nombre, p. ej. `Juvenil`. | — | La categoría necesita un nombre. |
| `minAge` | `number` | Edad mínima incluida. | — | La edad mínima debe ser un entero ≥ 0. |
| `maxAge` | `number \| null` | `null` = sin límite superior. | — | La edad máxima debe ser un entero mayor o igual a la mínima, o "sin límite". |
| `capacity` | `number \| null` | Cupo de competidores en la categoría. `null` = sin límite. | — | El cupo debe ser un número entero o "sin límite". |

Reglas de la lista: Las categorías de edad deben ser una lista. · Las categorías … y … se solapan en edad.

| Código | Nombre | Edad | Cupo |
|---|---|---|---|
| `INF_A` | Infantil A | 6–9 | sin límite |
| `INF_B` | Infantil B | 10–13 | sin límite |
| `JUV` | Juvenil | 14–17 | sin límite |
| `ADU` | Adulto | 18–35 | sin límite |
| `SEN` | Senior | 36–∞ | sin límite |

## 5. Claves de firma (`signingKeys[]`, tipo `SigningKey`)

| Campo | Tipo | Qué es | Por defecto | Validación |
|---|---|---|---|---|
| `kid` | `string` | Identificador de la clave; va dentro del QR (`k`). | — | — |
| `publicKeyHex` | `string` | Clave pública Ed25519 en hex (32 bytes). | — | — |

### 5.1 Opciones de inscripción (`registration`, tipo `RegistrationOptions`)

Opciones del formulario público de inscripción (`registration`).

| Campo | Tipo | Qué es | Por defecto | Validación |
|---|---|---|---|---|
| `requireEmergencyContact` (opcional) | `boolean` | Si el contacto de emergencia (nombre y teléfono) es obligatorio al inscribirse. Por defecto `false`. | — | — |

### 5.2 Persona (`Person`): campos que se imprimen en la credencial

No viven en `event.config.json` sino en cada persona (nube → host, SportData o emisión en sitio). La plantilla de credencial ([33-DISENO-CREDENCIAL.md](./33-DISENO-CREDENCIAL.md)) decide cuáles se imprimen (`privacy`).

| Campo | Tipo | Qué es | Por defecto | Validación |
|---|---|---|---|---|
| `documentNumber` (opcional) | `string` | — | — | — |
| `club` (opcional) | `string` | — | — | — |
| `delegation` (opcional) | `string` | Delegación (departamento o región), p. ej. `Cauca`. Se imprime en la credencial. | — | — |
| `emergencyContact` (opcional) | `EmergencyContact` | Contacto de emergencia (reverso de la credencial). | — | — |
| `eps` (opcional) | `Eps` | EPS (reverso de la credencial). | — | — |

`EmergencyContact`: Contacto de emergencia impreso en el reverso de la credencial (el teléfono se cifra en reposo).

| Campo | Tipo | Qué es | Por defecto | Validación |
|---|---|---|---|---|
| `name` | `string` | — | — | — |
| `phone` | `string` | — | — | — |

`Eps`: EPS (entidad de salud) impresa en el reverso de la credencial.

| Campo | Tipo | Qué es | Por defecto | Validación |
|---|---|---|---|---|
| `name` | `string` | — | — | — |
| `regime` (opcional) | `string` | Régimen: `Contributivo`, `Subsidiado`, etc. Texto libre. | — | — |

### 5.3 Tatami Radio (`radio`, tipo `RadioConfig`)

Configuración de Tatami Radio (`radio`): canales de voz por la LAN y catálogo de órdenes. Cómo funciona, límites y requisitos de red: [34-VOZ-RADIO.md](./34-VOZ-RADIO.md) y ADR-0010. Se edita desde el panel › **Radio** › Canales y órdenes.

| Campo | Tipo | Qué es | Por defecto | Validación |
|---|---|---|---|---|
| `channels` | `RadioChannel[]` | Canales. Siempre debe existir uno con `emergency: true`. | 4 elementos (ver más abajo) | Define al menos un canal de radio. · Debe haber exactamente un canal de emergencia. |
| `orders` | `RadioOrderTemplate[]` | Órdenes predefinidas que el supervisor envía con un toque (editable). | 6 elementos (ver más abajo) | Las órdenes deben ser una lista (puede estar vacía). |
| `maxPerChannel` | `number` | Participantes máximos por canal (malla P2P: cada uno manda audio a todos). Por defecto 10. | `10` | El máximo por canal debe ser un entero entre 2 y 30 (la malla P2P no aguanta más). |

Reglas de la lista de canales: Define al menos un canal de radio. · Debe haber exactamente un canal de emergencia. · La configuración de radio debe ser un objeto con canales y órdenes.

`RadioChannel` (`radio.channels[]`): Canal de voz. Quién habla y quién escucha se decide por rol: de scanner (`CONTROL`, `SUPERVISOR`) o de usuario del panel (`ADMIN`, `COORDINATOR`, `SUPERVISOR`…). `['*']` = todos.

| Campo | Tipo | Qué es | Por defecto | Validación |
|---|---|---|---|---|
| `id` | `string` | Identificador corto en minúsculas, p. ej. `puertas`. | — | El id del canal va en minúsculas, sin espacios (p. ej. puertas). · El canal … está repetido. |
| `name` | `string` | Nombre que se muestra, p. ej. `Puertas`. | — | El canal necesita un nombre. |
| `color` | `string` | Color hex del canal en scanner y panel. | — | El color del canal debe ser hexadecimal de 6 dígitos. |
| `talk` | `string[]` | Roles que pueden hablar (pulsar para hablar). `['*']` = todos. | — | Indica qué roles pueden hablar (o * para todos). |
| `listen` | `string[]` | Roles que pueden escuchar y entrar al canal. `['*']` = todos. | — | Indica qué roles pueden escuchar (o * para todos). |
| `priority` | `number` | Prioridad (0 = normal). El canal de emergencia debe tener la más alta. | — | La prioridad del canal debe ser un entero ≥ 0. |
| `emergency` (opcional) | `boolean` | Si es el canal de emergencia: quien habla aquí interrumpe a todos los canales. Exactamente uno. | — | — |

Canales por defecto:

| Id | Nombre | Hablan | Escuchan | Prioridad | Emergencia | Color |
|---|---|---|---|---|---|---|
| `puertas` | Puertas | * | * | 0 | no | `#1C4FD1` |
| `supervisores` | Supervisores | SUPERVISOR, ADMIN, COORDINATOR | SUPERVISOR, ADMIN, COORDINATOR | 1 | no | `#0E7490` |
| `acreditacion` | Acreditación | ADMIN, COORDINATOR, PRINTER, REGISTRAR, SUPERVISOR | ADMIN, COORDINATOR, PRINTER, REGISTRAR, SUPERVISOR | 1 | no | `#7C3AED` |
| `emergencia` | Emergencia | * | * | 100 | sí | `#E0323B` |

`RadioOrderTemplate` (`radio.orders[]`): Orden predefinida del catálogo. `{n}` en el texto se sustituye por el número o nombre de la puerta.

| Campo | Tipo | Qué es | Por defecto | Validación |
|---|---|---|---|---|
| `code` | `string` | Código en mayúsculas, p. ej. `OPEN_GATE`. | — | El código de la orden va en mayúsculas, sin espacios (p. ej. OPEN_GATE). · La orden … está repetida. |
| `label` | `string` | Texto que se muestra y se lee en voz alta, p. ej. `Abrir Puerta {n}`. | — | La orden necesita un texto. · Una orden con puerta debe llevar {n} en el texto. |
| `requiresGate` (opcional) | `boolean` | Si la orden necesita elegir una puerta (`{n}`). | — | — |
| `emergency` (opcional) | `boolean` | Si es una orden de emergencia (tono y vibración distintos, se difunde a todos los canales). | — | — |

Órdenes por defecto:

| Código | Texto | Pide puerta | Emergencia |
|---|---|---|---|
| `OPEN_GATE` | Abrir Puerta {n} | sí | no |
| `CLOSE_GATE` | Cerrar Puerta {n} | sí | no |
| `PAUSE` | Pausar ingreso | no | no |
| `RESUME` | Reanudar ingreso | no | no |
| `SUPERVISOR_TO_GATE` | Supervisor a Puerta {n} | sí | no |
| `EVACUATE` | Evacuación | no | sí |

## 6. Ejemplo mínimo válido

```json
{
  "eventId": "nac2026",
  "name": "Campeonato Nacional de Taekwondo ITF 2026",
  "idPrefix": "TP-2026",
  "startDate": "2026-11-20",
  "endDate": "2026-11-22",
  "utcOffsetMinutes": -300,
  "zones": [
    {
      "code": "G",
      "name": "Gradería",
      "tracksExit": false
    },
    {
      "code": "W",
      "name": "Área de calentamiento",
      "tracksExit": true
    },
    {
      "code": "T",
      "name": "Tatamis",
      "tracksExit": true
    }
  ],
  "roles": [
    {
      "code": "GEN",
      "name": "General",
      "zones": [
        "G"
      ],
      "days": null,
      "capacity": 1500,
      "requiresPhoto": false,
      "color": "#64748B",
      "allowsDigital": true,
      "antiPassbackZones": []
    },
    {
      "code": "COMP",
      "name": "Competidor",
      "zones": [
        "G",
        "W",
        "T"
      ],
      "days": null,
      "capacity": 1200,
      "requiresPhoto": true,
      "color": "#1C4FD1",
      "allowsDigital": false,
      "antiPassbackZones": [
        "W",
        "T"
      ]
    },
    {
      "code": "STAFF",
      "name": "Staff / Organización",
      "zones": [
        "*"
      ],
      "days": null,
      "capacity": 150,
      "requiresPhoto": true,
      "color": "#E0323B",
      "allowsDigital": false,
      "antiPassbackZones": []
    }
  ],
  "ageCategories": [
    {
      "code": "INF_A",
      "name": "Infantil A",
      "minAge": 6,
      "maxAge": 9,
      "capacity": null
    },
    {
      "code": "INF_B",
      "name": "Infantil B",
      "minAge": 10,
      "maxAge": 13,
      "capacity": null
    }
  ],
  "duplicateWindowSeconds": 120,
  "digitalTokenWindowSeconds": 60,
  "clockToleranceSeconds": 300,
  "signingKeys": [],
  "companions": {
    "perParticipant": 2,
    "total": null
  },
  "totalCapacity": 2000,
  "radio": {
    "channels": [
      {
        "id": "puertas",
        "name": "Puertas",
        "color": "#1C4FD1",
        "talk": [
          "*"
        ],
        "listen": [
          "*"
        ],
        "priority": 0
      },
      {
        "id": "supervisores",
        "name": "Supervisores",
        "color": "#0E7490",
        "talk": [
          "SUPERVISOR",
          "ADMIN",
          "COORDINATOR"
        ],
        "listen": [
          "SUPERVISOR",
          "ADMIN",
          "COORDINATOR"
        ],
        "priority": 1
      },
      {
        "id": "acreditacion",
        "name": "Acreditación",
        "color": "#7C3AED",
        "talk": [
          "ADMIN",
          "COORDINATOR",
          "PRINTER",
          "REGISTRAR",
          "SUPERVISOR"
        ],
        "listen": [
          "ADMIN",
          "COORDINATOR",
          "PRINTER",
          "REGISTRAR",
          "SUPERVISOR"
        ],
        "priority": 1
      },
      {
        "id": "emergencia",
        "name": "Emergencia",
        "color": "#E0323B",
        "talk": [
          "*"
        ],
        "listen": [
          "*"
        ],
        "priority": 100,
        "emergency": true
      }
    ],
    "orders": [
      {
        "code": "OPEN_GATE",
        "label": "Abrir Puerta {n}",
        "requiresGate": true
      },
      {
        "code": "CLOSE_GATE",
        "label": "Cerrar Puerta {n}",
        "requiresGate": true
      },
      {
        "code": "PAUSE",
        "label": "Pausar ingreso"
      },
      {
        "code": "RESUME",
        "label": "Reanudar ingreso"
      },
      {
        "code": "SUPERVISOR_TO_GATE",
        "label": "Supervisor a Puerta {n}",
        "requiresGate": true
      },
      {
        "code": "EVACUATE",
        "label": "Evacuación",
        "emergency": true
      }
    ],
    "maxPerChannel": 10
  },
  "configVersion": 1,
  "updatedAt": "2026-10-09T00:00:00.000Z"
}
```

## 7. Cómo validar antes de guardar

- Panel › Evento y roles marca el campo con error (misma función `validateEventConfig`).
- API: `POST /config/validate` con `{ config }` devuelve `{ errors: [{ path, message }], warnings }` sin guardar.
- Consola: `npx tsx -e "import('@tatami/core').then(m => console.log(m.validateEventConfig(JSON.parse(require('fs').readFileSync('apps/host/event.config.json','utf8')))))"` desde la raíz (tras `npm run build -w packages/core`).
- Skill para agentes: `.claude/skills/tatami-evento-config/SKILL.md`.

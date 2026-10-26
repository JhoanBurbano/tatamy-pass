/**
 * Tipos de dominio de Tatami Pass. Sin IO. Coherentes con docs/00-DECISIONES.md.
 */

/** Fecha en formato ISO `YYYY-MM-DD`. */
export type IsoDate = string;
/** Instante en formato ISO 8601 completo (`2026-11-20T09:14:00.000Z`). */
export type IsoDateTime = string;

/** Zona con control de acceso (una o varias puertas). */
export interface Zone {
  /** Código corto, p. ej. `G`, `W`, `T`, `P`, `J`, `V`, `H`, `S`, `M`. */
  code: string;
  /** Nombre que ven operadores y participantes, p. ej. `Tatamis`. */
  name: string;
  /** Si la zona controla salida (necesario para anti-passback). */
  tracksExit: boolean;
}

/** Rol de acceso (tipo de entrada). Configurable en event.config.json. */
export interface AccessRole {
  /** Código en mayúsculas, p. ej. `COMP`. Va dentro del QR (`r`). */
  code: string;
  /** Nombre impreso en la credencial, p. ej. `Competidor`. */
  name: string;
  /** Zonas permitidas. `['*']` = todas. */
  zones: string[];
  /** Días válidos (`YYYY-MM-DD`). `null` = todos los días del evento. */
  days: IsoDate[] | null;
  /** Cupo máximo de credenciales emitidas. `null` = sin límite. */
  capacity: number | null;
  /** Si la credencial lleva foto (obligatoria en la inscripción). */
  requiresPhoto: boolean;
  /** Color hex de fondo/franja en la credencial impresa. */
  color: string;
  /** Si admite credencial digital (QR rotativo en el celular) en vez de impresa. */
  allowsDigital: boolean;
  /** Zonas donde aplica anti-passback para este rol. `['*']` = todas. */
  antiPassbackZones: string[];
}

/** Categoría de edad ITF; la edad se calcula a la fecha de inicio del evento. */
export interface AgeCategory {
  /** Código en mayúsculas, p. ej. `JUV`. */
  code: string;
  /** Nombre, p. ej. `Juvenil`. */
  name: string;
  /** Edad mínima incluida. */
  minAge: number;
  /** `null` = sin límite superior. */
  maxAge: number | null;
  /** Cupo de competidores en la categoría. `null` = sin límite. */
  capacity: number | null;
}

/** Clave pública con la que los scanners verifican los QR. */
export interface SigningKey {
  /** Identificador de la clave; va dentro del QR (`k`). */
  kid: string;
  /** Clave pública Ed25519 en hex (32 bytes). */
  publicKeyHex: string;
}

/** Configuración completa de un evento (`event.config.json`). */
export interface EventConfig {
  /** Identificador del evento; va dentro del QR (`e`), p. ej. `nac2026`. */
  eventId: string;
  /** Nombre completo del evento (se imprime y se pide como confirmación en la purga). */
  name: string;
  /** Prefijo de IDs cortos, p. ej. `TP-2026`. */
  idPrefix: string;
  /** Primer día del evento; referencia para calcular edades y vigencia. */
  startDate: IsoDate;
  /** Último día del evento (inclusive). */
  endDate: IsoDate;
  /** Desfase respecto a UTC en minutos (Colombia = -300). */
  utcOffsetMinutes: number;
  zones: Zone[];
  roles: AccessRole[];
  ageCategories: AgeCategory[];
  /** Ventana para alerta de QR duplicado en otra puerta (segundos). */
  duplicateWindowSeconds: number;
  /** Vida de un token digital rotativo (segundos). */
  digitalTokenWindowSeconds: number;
  /** Tolerancia de reloj para tokens rotativos (segundos). */
  clockToleranceSeconds: number;
  signingKeys: SigningKey[];
  /** Límites de acompañantes por participante y totales (`null` = sin límite). */
  companions: { perParticipant: number | null; total: number | null };
  /** Aforo total del evento (personas con credencial). `null` = sin límite. */
  totalCapacity: number | null;
  /** Opciones del formulario de inscripción (nube). Opcional: por defecto nada es obligatorio. */
  registration?: RegistrationOptions;
  /** Tatami Radio (voz por la LAN entre scanners y panel). Opcional: si falta se usan los canales y órdenes por defecto. */
  radio?: RadioConfig;
  /** Versión monotónica; sirve para LWW en sync. */
  configVersion: number;
  updatedAt: IsoDateTime;
}

/** Opciones del formulario público de inscripción (`registration`). */
export interface RegistrationOptions {
  /** Si el contacto de emergencia (nombre y teléfono) es obligatorio al inscribirse. Por defecto `false`. */
  requireEmergencyContact?: boolean;
}

/** Configuración de Tatami Radio (`radio`): canales de voz por la LAN y catálogo de órdenes. */
export interface RadioConfig {
  /** Canales. Siempre debe existir uno con `emergency: true`. */
  channels: RadioChannel[];
  /** Órdenes predefinidas que el supervisor envía con un toque (editable). */
  orders: RadioOrderTemplate[];
  /** Participantes máximos por canal (malla P2P: cada uno manda audio a todos). Por defecto 10. */
  maxPerChannel: number;
}

/** Canal de voz. Quién habla y quién escucha se decide por rol: de scanner (`CONTROL`, `SUPERVISOR`) o de usuario del panel (`ADMIN`, `COORDINATOR`, `SUPERVISOR`…). `['*']` = todos. */
export interface RadioChannel {
  /** Identificador corto en minúsculas, p. ej. `puertas`. */
  id: string;
  /** Nombre que se muestra, p. ej. `Puertas`. */
  name: string;
  /** Color hex del canal en scanner y panel. */
  color: string;
  /** Roles que pueden hablar (pulsar para hablar). `['*']` = todos. */
  talk: string[];
  /** Roles que pueden escuchar y entrar al canal. `['*']` = todos. */
  listen: string[];
  /** Prioridad (0 = normal). El canal de emergencia debe tener la más alta. */
  priority: number;
  /** Si es el canal de emergencia: quien habla aquí interrumpe a todos los canales. Exactamente uno. */
  emergency?: boolean;
}

/** Orden predefinida del catálogo. `{n}` en el texto se sustituye por el número o nombre de la puerta. */
export interface RadioOrderTemplate {
  /** Código en mayúsculas, p. ej. `OPEN_GATE`. */
  code: string;
  /** Texto que se muestra y se lee en voz alta, p. ej. `Abrir Puerta {n}`. */
  label: string;
  /** Si la orden necesita elegir una puerta (`{n}`). */
  requiresGate?: boolean;
  /** Si es una orden de emergencia (tono y vibración distintos, se difunde a todos los canales). */
  emergency?: boolean;
}

export interface Guardian {
  name: string;
  document: string;
  consentAt: IsoDateTime;
}

/** Contacto de emergencia impreso en el reverso de la credencial (el teléfono se cifra en reposo). */
export interface EmergencyContact {
  name: string;
  phone: string;
}

/** EPS (entidad de salud) impresa en el reverso de la credencial. */
export interface Eps {
  name: string;
  /** Régimen: `Contributivo`, `Subsidiado`, etc. Texto libre. */
  regime?: string;
}

export interface Person {
  id: string;
  firstName: string;
  lastName: string;
  birthDate: IsoDate;
  documentNumber?: string;
  club?: string;
  /** Delegación (departamento o región), p. ej. `Cauca`. Se imprime en la credencial. */
  delegation?: string;
  photoUrl?: string;
  guardian?: Guardian;
  /** Contacto de emergencia (reverso de la credencial). */
  emergencyContact?: EmergencyContact;
  /** EPS (reverso de la credencial). */
  eps?: Eps;
  /** Origen del registro: inscripción online o importación SportData. */
  source: 'online' | 'sportdata' | 'seed';
  externalId?: string;
  /** Si es acompañante: id de la credencial o inscripción del participante al que acompaña. */
  companionOf?: string | null;
  /** Parentesco con el participante (opcional). */
  relationship?: string;
}

export type CredentialStatus = 'ISSUED' | 'PRINTED' | 'DELIVERED' | 'REVOKED';

export interface Credential {
  /** ID público corto, p. ej. `TP-2026-00123-C`. */
  id: string;
  /** Secuencial numérico (00123 → 123). */
  seq: number;
  eventId: string;
  personId: string;
  displayName: string;
  club?: string;
  roleCode: string;
  zones: string[];
  validFrom: IsoDate;
  validTo: IsoDate;
  /** Versión de emisión; re-emitir incrementa y revoca anteriores. */
  version: number;
  status: CredentialStatus;
  kid: string;
  categoryCode?: string;
  photoUrl?: string;
  /** Si es acompañante: id de la credencial del participante. */
  companionOf?: string | null;
  issuedAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** Payload firmado dentro del QR (compacto a propósito). */
export interface QrPayload {
  v: 1;
  /** eventId */
  e: string;
  /** seq de la credencial como string con ceros, p. ej. "00123" */
  c: string;
  /** rol */
  r: string;
  /** zonas */
  z: string[];
  /** vigencia desde */
  f: IsoDate;
  /** vigencia hasta */
  t: IsoDate;
  /** versión */
  n: number;
  /** id de clave */
  k: string;
  /** Solo credencial digital rotativa: expiración (epoch segundos). */
  exp?: number;
  /** Solo credencial digital rotativa: emitido en (epoch segundos). */
  iat?: number;
}

export type Decision = 'ALLOW' | 'DENY' | 'ALERT';

export type ReasonCode =
  | 'OK'
  | 'OK_PHOTO_CHECK'
  | 'OK_EXIT'
  | 'OK_MANUAL'
  | 'MALFORMED'
  | 'BAD_SIGNATURE'
  | 'UNKNOWN_KEY'
  | 'WRONG_EVENT'
  | 'UNKNOWN_CREDENTIAL'
  | 'REVOKED'
  | 'OLD_VERSION'
  | 'NOT_YET_VALID'
  | 'EXPIRED'
  | 'DAY_NOT_ALLOWED'
  | 'ZONE_NOT_ALLOWED'
  | 'DIGITAL_NOT_ALLOWED'
  | 'DIGITAL_TOKEN_EXPIRED'
  | 'ANTI_PASSBACK'
  | 'DUPLICATE'
  | 'NOT_INSIDE';

export interface ScanEvent {
  /** `${deviceId}:${seq}` — identidad idempotente. */
  id: string;
  deviceId: string;
  seq: number;
  credentialId: string | null;
  zone: string;
  direction: 'IN' | 'OUT';
  decision: Decision;
  reasonCode: ReasonCode;
  at: IsoDateTime;
  /** Versión del token escaneado (si se pudo leer). */
  tokenVersion?: number;
  manual?: { reason: string; by: string };
  /** Instante en que el host lo recibió (lo pone el host). */
  receivedAt?: IsoDateTime;
}

export type DeviceRole = 'CONTROL' | 'SUPERVISOR';

export interface Device {
  id: string;
  name: string;
  zone: string;
  role: DeviceRole;
  enrolledAt: IsoDateTime;
  /** Último seq conocido por el host. */
  lastSeq: number;
}

export interface RevocationEntry {
  credentialId: string;
  /** Revoca versiones `<= version`. `null` = todas las versiones. */
  version: number | null;
  reason: string;
  at: IsoDateTime;
  by: string;
}

export interface AuditRecord {
  seq: number;
  at: IsoDateTime;
  actor: string;
  action: string;
  /** JSON serializable. */
  payload: unknown;
  prevHash: string;
  hash: string;
}

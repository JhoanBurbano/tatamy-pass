/**
 * Motor de reglas de acceso. Puro: recibe todo lo que necesita y devuelve una
 * decisión con mensajes en español listos para la pantalla del scanner (§12).
 */
import type {
  Credential, Decision, Device, EventConfig, QrPayload, ReasonCode, RevocationEntry, ScanEvent
} from './types.js';
import type { TokenVerification } from './qr-token.js';
import { checkRotatingWindow } from './qr-token.js';
import { formatCredentialId } from './credential-id.js';
import { findRole, resolveZones } from './default-config.js';

export type ScanSource =
  | { kind: 'token'; verification: TokenVerification }
  /** El operador escribió el ID corto porque el QR no se pudo leer. */
  | { kind: 'manual-id'; credentialId: string }
  /** Supervisor autoriza el paso con motivo (queda en el log). */
  | { kind: 'override'; credentialId: string; reason: string; by: string };

export interface ScanInput {
  source: ScanSource;
  /** Credencial local (buscada por el llamador a partir del token o del ID). */
  credential: Credential | undefined;
  zone: string;
  direction?: 'IN' | 'OUT';
  now: Date | number | string;
  device: Pick<Device, 'id' | 'zone' | 'role'>;
  /** Escaneos recientes de esta credencial (cualquier dispositivo). */
  recentScans: ScanEvent[];
  revocations: RevocationEntry[];
  config: EventConfig;
}

export interface ScanResult {
  decision: Decision;
  reasonCode: ReasonCode;
  messageTitle: string;
  messageBody: string;
  nextAction: string;
  /** El operador debe comparar la foto con la persona. */
  requiresPhotoCheck: boolean;
  credential?: Credential;
  /** Versión leída del token (si aplica). */
  tokenVersion?: number;
  /** Patrón de sonido/vibración sugerido. */
  feedback: 'ok' | 'no' | 'alert';
}

// ---------- utilidades de tiempo ----------

export function toMs(now: Date | number | string): number {
  if (now instanceof Date) return now.getTime();
  if (typeof now === 'number') return now;
  return new Date(now).getTime();
}

/** Fecha local `YYYY-MM-DD` según el desfase del evento. */
export function localDate(nowMs: number, utcOffsetMinutes: number): string {
  return new Date(nowMs + utcOffsetMinutes * 60_000).toISOString().slice(0, 10);
}

/** Hora local `H:MM` para mensajes ("ya entró a las 9:14"). */
export function localTime(iso: string | number, utcOffsetMinutes: number): string {
  const d = new Date(toMs(iso) + utcOffsetMinutes * 60_000);
  return `${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

export function credentialIdFromPayload(payload: QrPayload, config: EventConfig): string {
  return formatCredentialId(config.idPrefix, Number(payload.c));
}

function firstName(cred: Credential | undefined): string {
  if (!cred) return '';
  return cred.displayName.split(' ')[0] ?? cred.displayName;
}

function zoneName(code: string, config: EventConfig): string {
  return config.zones.find((z) => z.code === code)?.name ?? code;
}

function roleName(code: string, config: EventConfig): string {
  return findRole(config, code)?.name ?? code;
}

const SUPERVISOR = 'Si crees que es un error, llama al supervisor de puerta.';

function deny(reasonCode: ReasonCode, body: string, next: string, cred?: Credential, tokenVersion?: number): ScanResult {
  return {
    decision: 'DENY', reasonCode, messageTitle: 'No puede entrar', messageBody: body, nextAction: next,
    requiresPhotoCheck: false, credential: cred, tokenVersion, feedback: 'no'
  };
}

// ---------- motor ----------

export function evaluateScan(input: ScanInput): ScanResult {
  const { source, credential, zone, device, config, revocations } = input;
  const direction = input.direction ?? 'IN';
  const nowMs = toMs(input.now);

  // 1. Autorización manual de supervisor: pasa con motivo, queda registrado.
  if (source.kind === 'override') {
    const name = firstName(credential) || source.credentialId;
    return {
      decision: 'ALLOW', reasonCode: 'OK_MANUAL',
      messageTitle: `Adelante, ${name}`,
      messageBody: `Ingreso manual autorizado por ${source.by}. Motivo: ${source.reason}.`,
      nextAction: 'Quedó registrado en el log de auditoría.',
      requiresPhotoCheck: false, credential, feedback: 'ok'
    };
  }

  // 2. Formato y firma del token.
  let payload: QrPayload | undefined;
  if (source.kind === 'token') {
    const v = source.verification;
    if (!v.ok) {
      if (v.reason === 'MALFORMED') {
        return deny('MALFORMED', 'Este código no es una credencial de Tatami Pass.', 'Pide la credencial impresa o escribe el ID corto que aparece bajo el QR.');
      }
      if (v.reason === 'UNKNOWN_KEY') {
        return deny('UNKNOWN_KEY', 'La credencial fue firmada con una clave que este dispositivo no conoce.', 'Sincroniza el dispositivo con el host y vuelve a escanear. ' + SUPERVISOR);
      }
      return deny('BAD_SIGNATURE', 'La firma del QR no es válida. Puede ser una credencial alterada o falsificada.', 'No dejes pasar. Retén la credencial y llama al supervisor.');
    }
    payload = v.payload;
    if (payload.e !== config.eventId) {
      return deny('WRONG_EVENT', 'Esta credencial es de otro evento.', 'No dejes pasar. ' + SUPERVISOR);
    }
  }

  // 3. Credencial conocida.
  if (!credential) {
    return deny('UNKNOWN_CREDENTIAL', 'Esta credencial no está en la lista de este evento.', 'Verifica que el dispositivo esté sincronizado. ' + SUPERVISOR, undefined, payload?.n);
  }
  const tokenVersion = payload?.n;
  const name = firstName(credential);

  // 4. Revocación y versión.
  const revs = revocations.filter((r) => r.credentialId === credential.id);
  const revokedMsg = `La credencial de ${credential.displayName} fue anulada por la organización.`;
  const revokedNext = 'No dejes pasar. Pide que se acerque a acreditación.';
  if (credential.status === 'REVOKED' || revs.some((r) => r.version === null)) {
    return deny('REVOKED', revokedMsg, revokedNext, credential, tokenVersion);
  }
  const oldVersionMsg = `Esta es una versión anterior de la credencial de ${credential.displayName}. Ya se emitió una nueva.`;
  const oldVersionNext = 'Pide la credencial nueva. Si no la tiene, que pase por acreditación.';
  if (tokenVersion !== undefined && tokenVersion < credential.version) {
    return deny('OLD_VERSION', oldVersionMsg, oldVersionNext, credential, tokenVersion);
  }
  const effectiveVersion = tokenVersion ?? credential.version;
  if (revs.some((r) => r.version !== null && effectiveVersion <= r.version)) {
    return tokenVersion !== undefined
      ? deny('OLD_VERSION', oldVersionMsg, oldVersionNext, credential, tokenVersion)
      : deny('REVOKED', revokedMsg, revokedNext, credential, tokenVersion);
  }

  // 5. Rol y zona.
  const role = findRole(config, credential.roleCode);
  const allowedZones = resolveZones(payload?.z ?? credential.zones, config);
  if (!allowedZones.includes(zone)) {
    return deny(
      'ZONE_NOT_ALLOWED',
      `${credential.displayName} es ${roleName(credential.roleCode, config)} y no tiene acceso a ${zoneName(zone, config)}.`,
      `Puede entrar a: ${allowedZones.map((z) => zoneName(z, config)).join(', ')}.`,
      credential, tokenVersion
    );
  }

  // 6. Vigencia (fecha local del evento).
  const today = localDate(nowMs, config.utcOffsetMinutes);
  const from = payload?.f ?? credential.validFrom;
  const to = payload?.t ?? credential.validTo;
  if (today < from) {
    return deny('NOT_YET_VALID', `Esta credencial es válida desde el ${from}.`, 'Hoy no puede entrar con ella. ' + SUPERVISOR, credential, tokenVersion);
  }
  if (today > to) {
    return deny('EXPIRED', `Esta credencial venció el ${to}.`, 'No dejes pasar. ' + SUPERVISOR, credential, tokenVersion);
  }
  if (role?.days && !role.days.includes(today)) {
    return deny('DAY_NOT_ALLOWED', `La entrada ${role.name} no es válida para hoy (${today}).`, `Días válidos: ${role.days.join(', ')}.`, credential, tokenVersion);
  }

  // 7. Token digital rotativo.
  if (payload?.exp !== undefined) {
    if (!role?.allowsDigital) {
      return deny('DIGITAL_NOT_ALLOWED', `El rol ${roleName(credential.roleCode, config)} debe usar credencial física impresa.`, 'Pide la credencial impresa. Si no la tiene, que pase por acreditación.', credential, tokenVersion);
    }
    if (checkRotatingWindow(payload, nowMs, config.clockToleranceSeconds) === 'EXPIRED') {
      return deny('DIGITAL_TOKEN_EXPIRED', 'Este código digital ya caducó. Los códigos cambian cada minuto; un pantallazo no sirve.', 'Pide que abra la credencial en su celular y muestre el código actual.', credential, tokenVersion);
    }
  }

  const scans = input.recentScans.filter((s) => s.credentialId === credential.id);

  // 8. Salida: siempre se registra.
  if (direction === 'OUT') {
    return {
      decision: 'ALLOW', reasonCode: 'OK_EXIT',
      messageTitle: `Salida registrada, ${name}`,
      messageBody: `${credential.displayName} salió de ${zoneName(zone, config)}.`,
      nextAction: 'Puede volver a entrar escaneando de nuevo.',
      requiresPhotoCheck: false, credential, tokenVersion, feedback: 'ok'
    };
  }

  // 9. Duplicado: mismo QR aceptado en otra puerta hace menos de N segundos.
  const dupWindowMs = config.duplicateWindowSeconds * 1000;
  const dup = scans.find(
    (s) => s.direction === 'IN' && s.decision !== 'DENY' && s.deviceId !== device.id && nowMs - toMs(s.at) >= 0 && nowMs - toMs(s.at) < dupWindowMs
  );
  if (dup) {
    return {
      decision: 'ALERT', reasonCode: 'DUPLICATE',
      messageTitle: 'Atención: posible duplicado',
      messageBody: `Esta misma credencial entró por otra puerta (${dup.zone === zone ? zoneName(zone, config) : zoneName(dup.zone, config)}) a las ${localTime(dup.at, config.utcOffsetMinutes)}. Puede ser una copia del QR.`,
      nextAction: 'Compara la foto con la persona. Si no coincide, retén la credencial y llama al supervisor.',
      requiresPhotoCheck: true, credential, tokenVersion, feedback: 'alert'
    };
  }

  // 10. Anti-passback: ya está dentro de la zona sin salida registrada.
  const zoneCfg = config.zones.find((z) => z.code === zone);
  const apbZones = role ? resolveZones(role.antiPassbackZones, config) : [];
  if (zoneCfg?.tracksExit && apbZones.includes(zone)) {
    const inZone = scans
      .filter((s) => s.zone === zone && s.decision !== 'DENY' && toMs(s.at) <= nowMs)
      .sort((a, b) => toMs(b.at) - toMs(a.at))[0];
    if (inZone && inZone.direction === 'IN') {
      return deny(
        'ANTI_PASSBACK',
        `Esta credencial ya entró a ${zoneName(zone, config)} a las ${localTime(inZone.at, config.utcOffsetMinutes)} y no registró salida.`,
        'Pide que salga por el punto de salida y vuelva a escanear, o llama al supervisor.',
        credential, tokenVersion
      );
    }
  }

  // 11. Todo bien.
  const requiresPhoto = role?.requiresPhoto ?? false;
  const club = credential.club ? ` · ${credential.club}` : '';
  return {
    decision: 'ALLOW',
    reasonCode: requiresPhoto ? 'OK_PHOTO_CHECK' : 'OK',
    messageTitle: `Adelante, ${name}`,
    messageBody: `${roleName(credential.roleCode, config)}${club}`,
    nextAction: requiresPhoto ? 'Compara la foto con la persona antes de dejar pasar.' : 'Deja pasar.',
    requiresPhotoCheck: requiresPhoto,
    credential, tokenVersion, feedback: 'ok'
  };
}

/** Construye el ScanEvent a guardar a partir de un resultado. */
export function toScanEvent(args: {
  deviceId: string; seq: number; zone: string; direction?: 'IN' | 'OUT';
  at: Date | number | string; result: ScanResult; credentialId?: string | null; manual?: { reason: string; by: string };
}): ScanEvent {
  const { deviceId, seq, zone, result } = args;
  return {
    id: `${deviceId}:${seq}`,
    deviceId, seq,
    credentialId: args.credentialId ?? result.credential?.id ?? null,
    zone,
    direction: args.direction ?? 'IN',
    decision: result.decision,
    reasonCode: result.reasonCode,
    at: new Date(toMs(args.at)).toISOString(),
    tokenVersion: result.tokenVersion,
    manual: args.manual
  };
}

/**
 * Credencial digital (QR rotativo) para roles con `allowsDigital` (General y Acompañante).
 *
 * Cómo funciona:
 * - La credencial la emite el host (ID `TP-2026-00123-C`); el host la reporta a la nube con
 *   `POST /api/host-report` y queda en `registrations.credential_id`.
 * - La nube firma el token rotativo (`signRotatingToken` del core, ventana `digitalTokenWindowSeconds`,
 *   60 s por defecto) con la MISMA clave Ed25519 del host, puesta en `TP_SIGNING_KEY`
 *   (`{"kid":"k1","privateKeyHex":"…"}`). Los scanners ya tienen la pública, así que el QR vale en
 *   las puertas. Sin esa variable, la página muestra el estado pero no el QR.
 * - El participante entra por `/credencial/<token>`; el token es opaco (24 bytes) y va en el correo
 *   de aprobación. La página pide un QR nuevo cada 30 s; un pantallazo caduca en un minuto.
 */
import { parseCredentialId, resolveZones, signRotatingToken, type Credential, type EventConfig, type KeyPair } from '@tatami/core';
import type { Registration } from './repo/types';

export interface DigitalInfo {
  /** El rol admite credencial digital. */
  allowed: boolean;
  /** Estado para la pantalla: qué ve la persona y por qué. */
  state: 'NOT_ALLOWED' | 'NOT_APPROVED' | 'REVOKED' | 'WAITING_HOST' | 'NO_KEY' | 'READY';
  title: string;
  hint: string;
  credentialId?: string;
}

let cached: KeyPair | null | undefined;

/** Clave de firma de la nube (`TP_SIGNING_KEY`). `null` si no está definida o es inválida. */
export function signingKey(): KeyPair | null {
  if (cached !== undefined) return cached;
  const raw = process.env.TP_SIGNING_KEY;
  if (!raw) { cached = null; return null; }
  try {
    const j = JSON.parse(raw) as Partial<KeyPair>;
    if (!j.kid || !j.privateKeyHex || !/^[0-9a-f]{64}$/i.test(j.privateKeyHex)) throw new Error('faltan kid/privateKeyHex');
    cached = { kid: j.kid, privateKeyHex: j.privateKeyHex, publicKeyHex: j.publicKeyHex ?? '' };
  } catch (e) {
    console.warn('[digital] TP_SIGNING_KEY inválida:', (e as Error).message);
    cached = null;
  }
  return cached;
}

/** Para tests. */
export function setSigningKeyForTests(k: KeyPair | null | undefined): void { cached = k; }

export function digitalInfo(r: Registration, config: EventConfig, key: KeyPair | null = signingKey()): DigitalInfo {
  const role = config.roles.find((x) => x.code === r.roleCode);
  if (!role?.allowsDigital) return { allowed: false, state: 'NOT_ALLOWED', title: 'Credencial física', hint: `${role?.name ?? r.roleCode} usa credencial impresa: recógela en la mesa de acreditación con tu documento.` };
  if (r.revokedAt || r.credentialStatus === 'REVOKED') return { allowed: true, state: 'REVOKED', title: 'Credencial anulada', hint: `Motivo: ${r.revokeReason ?? 'sin detalle'}. Ve a la mesa de acreditación con tu documento.`, credentialId: r.credentialId };
  if (r.status !== 'APPROVED') return { allowed: true, state: 'NOT_APPROVED', title: 'Todavía no está aprobada', hint: 'Cuando el coordinador apruebe la inscripción, aquí aparecerá tu credencial digital. Te avisamos por correo.' };
  if (!r.credentialId || !parseCredentialId(r.credentialId)) return { allowed: true, state: 'WAITING_HOST', title: 'Credencial en preparación', hint: 'La organización emite las credenciales unos días antes del evento. Vuelve a este enlace: el código aparecerá aquí.' };
  if (!key) return { allowed: true, state: 'NO_KEY', title: 'Credencial en preparación', hint: 'El código digital todavía no está activo. Si el evento ya empezó, acércate a la mesa de acreditación con tu documento.', credentialId: r.credentialId };
  return { allowed: true, state: 'READY', title: 'Tu credencial digital', hint: 'Muestra este código en la puerta. Cambia cada minuto: no sirve en pantallazo.', credentialId: r.credentialId };
}

/** Construye la credencial (como la ve el core) a partir de la inscripción y el ID que asignó el host. */
export function credentialFor(r: Registration, config: EventConfig, kid: string): Credential | null {
  const parsed = r.credentialId ? parseCredentialId(r.credentialId) : null;
  if (!parsed) return null;
  const role = config.roles.find((x) => x.code === r.roleCode);
  if (!role) return null;
  return {
    id: r.credentialId!, seq: parsed.seq, eventId: config.eventId, personId: r.id, displayName: `${r.firstName} ${r.lastName}`.trim(), club: r.club,
    roleCode: role.code, zones: resolveZones(role.zones, config), validFrom: config.startDate, validTo: config.endDate, version: r.credentialVersion ?? 1,
    status: r.credentialStatus === 'REVOKED' ? 'REVOKED' : 'ISSUED', kid, categoryCode: r.categoryCode, photoUrl: r.photoUrl, companionOf: r.companionOf ?? null,
    issuedAt: r.credentialUpdatedAt ?? r.updatedAt, updatedAt: r.updatedAt
  };
}

export interface RotatingQr { token: string; expiresAt: string; windowSeconds: number }

/** Token rotativo firmado para la credencial, o null si no se puede (ver `digitalInfo`). */
export function rotatingQr(r: Registration, config: EventConfig, now = Date.now(), key: KeyPair | null = signingKey()): RotatingQr | null {
  if (!key || digitalInfo(r, config, key).state !== 'READY') return null;
  const cred = credentialFor(r, config, key.kid);
  if (!cred) return null;
  const windowSeconds = config.digitalTokenWindowSeconds || 60;
  const token = signRotatingToken(cred, key, now, windowSeconds);
  return { token, expiresAt: new Date(Math.floor(now / 1000) * 1000 + windowSeconds * 1000).toISOString(), windowSeconds };
}

/**
 * Código de enrolamiento desde la app: mismo formato que `POST /devices/enroll-token`
 * del host (QR con `{ hostUrl, token }`, caduca en 10 min). El scanner lo lee
 * y canjea el token en `POST /devices/enroll` con un PIN.
 */
import QRCode from 'qrcode';
import type { EnrollInput, EnrollResult, FieldError } from '../shared/ipc.js';

export interface EnrollCtx {
  config: { zones: { code: string; name: string }[] };
  devices: { createEnrollToken(args: { name: string; zone: string; role: 'CONTROL' | 'SUPERVISOR'; ttlMinutes?: number }): { token: string; expiresAt: string } };
  audit: { append(actor: string, action: string, payload: unknown): unknown };
  mode: 'primary' | 'standby';
}

export function validateEnrollInput(zones: { code: string }[], input: Partial<EnrollInput>): FieldError[] {
  const errors: FieldError[] = [];
  if (!input.name?.trim()) errors.push({ path: 'name', message: 'Ponle un nombre al scanner (p. ej. "Puerta G1").' });
  if (!input.zone || !zones.some((z) => z.code === input.zone)) errors.push({ path: 'zone', message: 'Elige la zona que va a controlar.' });
  if (input.role !== 'CONTROL' && input.role !== 'SUPERVISOR') errors.push({ path: 'role', message: 'El rol del scanner es Control o Supervisor.' });
  return errors;
}

export function enrollQrText(hostUrl: string, token: string): string {
  return JSON.stringify({ hostUrl, token });
}

export async function createEnrollment(ctx: EnrollCtx, input: EnrollInput, hostUrl: string, toDataUrl: (text: string) => Promise<string> = (t) => QRCode.toDataURL(t, { margin: 1, width: 360, errorCorrectionLevel: 'M' })): Promise<EnrollResult> {
  const errors = validateEnrollInput(ctx.config.zones, input);
  if (errors.length) throw new Error(errors[0].message);
  const t = ctx.devices.createEnrollToken({ name: input.name.trim(), zone: input.zone, role: input.role });
  if (ctx.mode === 'primary') ctx.audit.append('desktop', 'ENROLL_TOKEN_CREATED', { name: input.name.trim(), zone: input.zone, role: input.role, expiresAt: t.expiresAt });
  const qrText = enrollQrText(hostUrl, t.token);
  return { token: t.token, expiresAt: t.expiresAt, hostUrl, qrText, qrDataUrl: await toDataUrl(qrText) };
}

/**
 * Sesión del panel: JWT HS256 (jose) en cookie HttpOnly `tp_session`, SameSite=Lax,
 * Secure en producción, 12 h de vida. El secreto es `SESSION_SECRET` (≥ 32 caracteres);
 * sin él, en desarrollo se usa uno fijo con aviso y en producción se rechaza.
 *
 * Funciona en Edge (middleware) y en Node (páginas, acciones, rutas).
 */
import { jwtVerify, SignJWT } from 'jose';
import type { UserRole } from '../repo/types';

export const SESSION_COOKIE = 'tp_session';
export const SESSION_HOURS = 12;

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  delegationId?: string;
}

let warned = false;
function secret(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 32) return new TextEncoder().encode(s);
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_INSECURE_SESSION !== '1') {
    throw new Error('Define SESSION_SECRET (≥ 32 caracteres) para firmar las sesiones del panel.');
  }
  if (!warned) { warned = true; console.warn('[registration] SESSION_SECRET no definida: usando secreto de desarrollo.'); }
  return new TextEncoder().encode('tatami-pass-dev-secret-change-me-please-0000');
}

export async function createSessionToken(user: SessionUser, hours = SESSION_HOURS): Promise<string> {
  return new SignJWT({ email: user.email, name: user.name, role: user.role, delegationId: user.delegationId ?? null })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${hours}h`)
    .sign(secret());
}

export async function readSessionToken(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ['HS256'] });
    if (!payload.sub || typeof payload.role !== 'string') return null;
    return { id: payload.sub, email: String(payload.email ?? ''), name: String(payload.name ?? ''), role: payload.role as UserRole, delegationId: (payload.delegationId as string | null) ?? undefined };
  } catch {
    return null;
  }
}

export function sessionCookieOptions() {
  return { httpOnly: true, sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production', path: '/', maxAge: SESSION_HOURS * 3600 };
}

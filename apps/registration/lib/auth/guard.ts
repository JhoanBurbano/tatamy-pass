/** Lectura de la sesión en páginas, acciones de servidor y rutas del panel. */
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { readSessionToken, SESSION_COOKIE, type SessionUser } from './session';
import type { UserRole } from '../repo/types';

export async function currentUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  return readSessionToken(jar.get(SESSION_COOKIE)?.value);
}

export class Forbidden extends Error {
  status = 403;
  constructor(msg = 'No tienes permiso para hacer esto.') { super(msg); }
}

/** Para páginas: redirige al login si no hay sesión; si el rol no alcanza, vuelve a Inscripciones con aviso. */
export async function requireUser(roles?: UserRole[]): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect('/panel/login');
  if (roles && !roles.includes(user.role)) redirect(`/panel/inscripciones?error=${encodeURIComponent('Esa sección no está disponible para tu usuario.')}`);
  return user;
}

/** Para acciones y rutas API: lanza en vez de redirigir. */
export async function requireUserOrThrow(roles?: UserRole[]): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) throw new Forbidden('Inicia sesión para continuar.');
  if (roles && !roles.includes(user.role)) throw new Forbidden();
  return user;
}

export function canManage(user: SessionUser): boolean {
  return user.role === 'admin' || user.role === 'coord';
}

/**
 * CSRF para rutas API del panel que reciben POST desde el navegador: la cookie es
 * SameSite=Lax y además exigimos que `Origin` (o `Sec-Fetch-Site`) sea del mismo sitio.
 * Las acciones de servidor de Next ya hacen esta comprobación por sí mismas.
 */
export async function assertSameOrigin(req: Request): Promise<void> {
  const h = await headers();
  const origin = req.headers.get('origin');
  const site = req.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') throw new Forbidden('Petición rechazada (origen distinto).');
  if (origin) {
    const host = h.get('x-forwarded-host') ?? h.get('host') ?? '';
    const originHost = (() => { try { return new URL(origin).host; } catch { return ''; } })();
    if (originHost !== host) throw new Forbidden('Petición rechazada (origen distinto).');
  }
}

/**
 * Protege /panel/*: sin sesión válida redirige al login (salvo login y activación de invitación).
 * La comprobación fina por rol se hace en cada página/acción con `requireUser`.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { readSessionToken, SESSION_COOKIE } from '@/lib/auth/session';

const PUBLIC = [/^\/panel\/login$/, /^\/panel\/activar\//];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => p.test(pathname))) return NextResponse.next();
  const user = await readSessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!user) {
    const url = req.nextUrl.clone();
    url.pathname = '/panel/login';
    url.search = pathname !== '/panel' ? `?next=${encodeURIComponent(pathname)}` : '';
    const res = NextResponse.redirect(url);
    if (req.cookies.get(SESSION_COOKIE)) res.cookies.delete(SESSION_COOKIE);
    return res;
  }
  return NextResponse.next();
}

export const config = { matcher: ['/panel/:path*'] };

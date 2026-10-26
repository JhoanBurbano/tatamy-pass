import { NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { eventConfig } from '@/lib/config';
import { getRepos } from '@/lib/db';
import { digitalInfo, rotatingQr } from '@/lib/digital';
import { clientIp, rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

/**
 * Credencial digital: estado + QR rotativo (SVG) para la página pública `/credencial/<token>`.
 * El token es opaco (va en el correo de aprobación). Sin datos sensibles: nombre, rol, zonas, estado.
 */
export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const rl = rateLimit(`credencial:${clientIp(req)}`, 60, 60_000);
  if (!rl.ok) return NextResponse.json({ error: 'Demasiadas peticiones. Espera un momento.' }, { status: 429, headers: { 'retry-after': String(rl.retryAfterSeconds) } });
  const { token } = await ctx.params;
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return NextResponse.json({ error: 'Este enlace no es válido.' }, { status: 404 });
  const repos = await getRepos();
  const r = await repos.registrations.byCredentialToken(token);
  if (!r) return NextResponse.json({ error: 'Este enlace no es válido o ya no existe la inscripción.' }, { status: 404 });
  const { config } = await eventConfig(repos);
  const info = digitalInfo(r, config);
  const role = config.roles.find((x) => x.code === r.roleCode);
  const zones = (role?.zones.includes('*') ? config.zones.map((z) => z.code) : role?.zones ?? []).map((z) => config.zones.find((x) => x.code === z)?.name ?? z);
  const qr = rotatingQr(r, config);
  const svg = qr ? await QRCode.toString(qr.token, { type: 'svg', errorCorrectionLevel: 'M', margin: 1 }) : null;
  return NextResponse.json({
    name: `${r.firstName} ${r.lastName}`.trim(), role: role?.name ?? r.roleCode, zones, club: r.club ?? null, photoUrl: r.photoUrl ?? null,
    event: { name: config.name, startDate: config.startDate, endDate: config.endDate },
    state: info.state, title: info.title, hint: info.hint, credentialId: info.credentialId ?? null,
    qr: qr ? { token: qr.token, svg, expiresAt: qr.expiresAt, windowSeconds: qr.windowSeconds } : null,
    serverTime: new Date().toISOString()
  }, { headers: { 'cache-control': 'no-store' } });
}

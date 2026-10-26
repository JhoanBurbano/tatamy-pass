import { NextResponse } from 'next/server';
import { getRepos } from '@/lib/db';
import { checkCloudKey } from '@/lib/cloud-auth';
import { eventConfig } from '@/lib/config';
import { sendMail } from '@/lib/mail';
import { expireOffers } from '@/lib/waitlist';

export const dynamic = 'force-dynamic';

/**
 * Vence ofertas de cupo caducadas y avisa al siguiente. Lo llama el cron de Vercel
 * (vercel.json) con `Authorization: Bearer $CRON_SECRET`, o cualquiera con `x-tatami-key`.
 * También se ejecuta al abrir la lista de espera en el panel, así que el cron es opcional.
 */
export async function GET(req: Request) {
  const bearer = req.headers.get('authorization')?.replace(/^Bearer /, '');
  const repos = await getRepos();
  const okCron = process.env.CRON_SECRET && bearer === process.env.CRON_SECRET;
  const okKey = (await checkCloudKey(req, repos)).ok;
  if (!okCron && !okKey) return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
  const { config } = await eventConfig(repos);
  const r = await expireOffers({ repos, config, sendMail });
  return NextResponse.json({ ok: true, expired: r.expired.length, offered: r.offered.length });
}

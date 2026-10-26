import { NextResponse } from 'next/server';
import { approveRegistration } from '@/lib/approval';
import { checkCloudKey } from '@/lib/cloud-auth';
import { eventConfig } from '@/lib/config';
import { getRepos } from '@/lib/db';
import { sendMail } from '@/lib/mail';

export const dynamic = 'force-dynamic';

/** Aprueba inscripciones (y sus acompañantes) con la clave del host. Cuerpo: `{ ids: string[] }` o `{ all: true }`. Para pruebas y scripts; el panel usa acciones con sesión. Envía los mismos correos que el panel. */
export async function POST(req: Request) {
  const repos = await getRepos();
  const auth = await checkCloudKey(req, repos);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = (await req.json().catch(() => ({}))) as { ids?: string[]; all?: boolean };
  const { config } = await eventConfig(repos);
  const ids = body.all ? (await repos.registrations.list({ status: 'PENDING', limit: 5000 })).map((r) => r.id) : Array.isArray(body.ids) ? body.ids.map(String).slice(0, 5000) : [];
  let approved = 0;
  for (const id of ids) if ((await approveRegistration({ repos, config, sendMail, actor: 'x-tatami-key' }, id)).ok) approved++;
  await repos.settings.audit('x-tatami-key', 'APPROVE_BATCH', undefined, { approved });
  return NextResponse.json({ ok: true, approved });
}

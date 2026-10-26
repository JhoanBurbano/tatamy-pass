import { NextResponse } from 'next/server';
import { getRepos } from '@/lib/db';
import { checkCloudKey } from '@/lib/cloud-auth';
import { applyHostReport, type HostReportInput } from '@/lib/host-report';

export const dynamic = 'force-dynamic';

/**
 * El host sube al cierre (o cuando tenga internet) el estado de las credenciales y un resumen
 * de escaneos. Requiere `x-tatami-key`. Ver formato en lib/host-report.ts.
 */
export async function POST(req: Request) {
  const repos = await getRepos();
  const auth = await checkCloudKey(req, repos);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = (await req.json().catch(() => null)) as HostReportInput | null;
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Cuerpo JSON inválido.' }, { status: 400 });
  const result = await applyHostReport(repos, body);
  return NextResponse.json(result);
}

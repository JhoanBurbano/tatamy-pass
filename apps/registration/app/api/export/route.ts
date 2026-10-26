import { NextResponse } from 'next/server';
import { getRepos } from '@/lib/db';
import { checkCloudKey } from '@/lib/cloud-auth';
import { buildExport } from '@/lib/export';

export const dynamic = 'force-dynamic';

/**
 * Exportación para el host (§8): inscripciones APROBADAS creadas/actualizadas después de `since`
 * (ISO), cada una con sus acompañantes, `photoUrl` y `revoked`. Requiere `x-tatami-key`.
 */
export async function GET(req: Request) {
  const repos = await getRepos();
  const auth = await checkCloudKey(req, repos);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const since = new URL(req.url).searchParams.get('since') || undefined;
  return NextResponse.json(await buildExport(repos, since, { markExported: true }));
}

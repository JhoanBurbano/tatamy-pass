import { currentUser } from '@/lib/auth/guard';
import { getRepos } from '@/lib/db';
import { buildExport } from '@/lib/export';

export const dynamic = 'force-dynamic';

/** JSON de aprobados con el mismo formato que `GET /api/export` (sin marcar como exportado). Solo admin/coord. */
export async function GET() {
  const user = await currentUser();
  if (!user || user.role === 'club') return new Response('No tienes permiso.', { status: user ? 403 : 401 });
  const repos = await getRepos();
  const data = await buildExport(repos, undefined, { markExported: false });
  await repos.settings.audit(user.email, 'EXPORT_APPROVED_JSON', undefined, { count: data.count });
  return new Response(JSON.stringify(data, null, 2), { headers: { 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="aprobados-${new Date().toISOString().slice(0, 10)}.json"`, 'cache-control': 'no-store' } });
}

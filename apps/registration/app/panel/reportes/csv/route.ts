import { currentUser } from '@/lib/auth/guard';
import { eventConfig } from '@/lib/config';
import { toCsv } from '@/lib/csv';
import { getRepos } from '@/lib/db';
import { STATUS_SHORT } from '@/lib/labels';

export const dynamic = 'force-dynamic';

/** CSV de reportes: `?by=role|category|club|status|all`. Los inscriptores solo ven su delegación. */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return new Response('Inicia sesión.', { status: 401 });
  const by = new URL(req.url).searchParams.get('by') ?? 'all';
  const repos = await getRepos();
  const { config } = await eventConfig(repos);
  const scope = user.role === 'club' ? { delegationId: user.delegationId } : {};
  const stamp = new Date().toISOString().slice(0, 10);
  let csv: string; let name: string;
  if (by === 'all') {
    const rows = await repos.registrations.list({ status: 'ALL', participantsOnly: false, limit: 5000, ...scope });
    const roleName = (c: string) => config.roles.find((r) => r.code === c)?.name ?? c;
    csv = toCsv(['Código', 'Nombre', 'Apellido', 'Fecha de nacimiento', 'Documento', 'Club', 'Correo', 'Rol', 'Categoría', 'Estado', 'Motivo rechazo', 'Acompañante de', 'Parentesco', 'Credencial', 'Estado credencial', 'Anulada', 'Foto', 'Origen', 'Recibida'],
      rows.map((r) => [r.code, r.firstName, r.lastName, r.birthDate, r.documentNumber, r.club, r.email, roleName(r.roleCode), r.categoryCode, STATUS_SHORT[r.status], r.rejectionReason, r.companionOf, r.relationship, r.credentialId, r.credentialStatus, r.revokedAt ? `Sí: ${r.revokeReason ?? ''}` : '', r.photoUrl, r.source, r.createdAt]));
    name = `inscripciones-${stamp}.csv`;
  } else {
    const col = ({ role: 'role_code', category: 'category_code', club: 'club', status: 'status' } as const)[by as 'role'];
    if (!col) return new Response('Parámetro by inválido.', { status: 400 });
    const rows = await repos.registrations.countBy(col, scope);
    csv = toCsv([by, 'Inscritos'], rows.map((r) => [r.key || '(sin dato)', r.n]));
    name = `inscritos-por-${by}-${stamp}.csv`;
  }
  await repos.settings.audit(user.email, 'EXPORT_CSV', by);
  return new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${name}"`, 'cache-control': 'no-store' } });
}

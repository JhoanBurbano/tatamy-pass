import { currentUser } from '@/lib/auth/guard';
import { eventConfig } from '@/lib/config';
import { toCsv } from '@/lib/csv';
import { getRepos } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** CSV de aprobados (participantes y acompañantes). Solo admin/coord. */
export async function GET() {
  const user = await currentUser();
  if (!user || user.role === 'club') return new Response('No tienes permiso.', { status: user ? 403 : 401 });
  const repos = await getRepos();
  const { config } = await eventConfig(repos);
  const rows = await repos.registrations.exportSince(undefined);
  const roleName = (c: string) => config.roles.find((r) => r.code === c)?.name ?? c;
  const flat = rows.flatMap((r) => [r, ...r.companions]);
  const csv = toCsv(['ID', 'Código', 'Nombre', 'Apellido', 'Fecha de nacimiento', 'Documento', 'Club', 'Correo', 'Rol', 'Categoría', 'Acompañante de', 'Parentesco', 'Acudiente', 'Doc. acudiente', 'Foto', 'Credencial', 'Estado credencial', 'Anulada', 'Motivo anulación', 'Actualizada'],
    flat.map((r) => [r.id, r.code, r.firstName, r.lastName, r.birthDate, r.documentNumber, r.club, r.email, roleName(r.roleCode), r.categoryCode, r.companionOf, r.relationship, r.guardian?.name, r.guardian?.document, r.photoUrl, r.credentialId, r.credentialStatus, r.revokedAt ? 'Sí' : '', r.revokeReason, r.updatedAt]));
  await repos.settings.audit(user.email, 'EXPORT_APPROVED_CSV', undefined, { rows: flat.length });
  return new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="aprobados-${new Date().toISOString().slice(0, 10)}.csv"`, 'cache-control': 'no-store' } });
}

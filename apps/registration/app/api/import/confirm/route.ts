import { NextResponse } from 'next/server';
import { ageOn, categoryForAge, csvToTable, importSportData, type ColumnMapping } from '@tatami/core';
import { eventConfig } from '@/lib/config';
import { getRepos } from '@/lib/db';
import { readBody } from '@/lib/csv-body';
import { assertSameOrigin, Forbidden, requireUserOrThrow } from '@/lib/auth/guard';

export const dynamic = 'force-dynamic';

/** Mismo cuerpo que preview; aplica la importación (idempotente) y la guarda como lote. Solo admin/coord. */
export async function POST(req: Request) {
  let actor: string;
  try {
    actor = (await requireUserOrThrow(['admin', 'coord'])).email;
    await assertSameOrigin(req);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: (e as Forbidden).status ?? 403 });
  }
  const { csv, mapping, fileName } = await readBody(req);
  if (!csv.trim() || !mapping?.birthDate) return NextResponse.json({ error: 'Falta el CSV o el mapeo de columnas.' }, { status: 400 });
  const repos = await getRepos();
  const { config } = await eventConfig(repos);
  const table = csvToTable(csv);
  const existing = (await repos.registrations.all()).map((r) => ({ id: r.id, firstName: r.firstName, lastName: r.lastName, birthDate: r.birthDate, club: r.club, documentNumber: r.documentNumber, externalId: r.externalId, source: r.source }));
  const result = importSportData(table, { mapping: mapping as ColumnMapping, existing });
  let created = 0; let updated = 0;
  for (const p of [...result.created, ...result.updated]) {
    const categoryCode = categoryForAge(ageOn(p.birthDate, config.startDate), config.ageCategories)?.code;
    const delegationId = p.club ? (await repos.users.delegationByName(p.club))?.id : undefined;
    const r = await repos.registrations.upsert({ ...p, roleCode: 'COMP', categoryCode, delegationId, status: 'APPROVED', source: 'sportdata' });
    if (r.created) created++; else updated++;
  }
  const batch = await repos.settings.addImportBatch({ fileName, rows: table.rows.length, created, updated, unchanged: result.unchanged.length, duplicatesInFile: result.duplicatesInFile, errors: result.errors, mapping: mapping as Record<string, string | undefined>, byUser: actor });
  await repos.settings.audit(actor, 'IMPORT_SPORTDATA', batch.id, { created, updated, unchanged: result.unchanged.length });
  return NextResponse.json({ ok: true, batchId: batch.id, created, updated, unchanged: result.unchanged.length, duplicatesInFile: result.duplicatesInFile, errors: result.errors });
}

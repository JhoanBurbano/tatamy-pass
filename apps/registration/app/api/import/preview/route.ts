import { NextResponse } from 'next/server';
import { csvToTable, guessMapping, importSportData, type ColumnMapping } from '@tatami/core';
import { getRepos } from '@/lib/db';
import { readBody } from '@/lib/csv-body';
import { assertSameOrigin, Forbidden, requireUserOrThrow } from '@/lib/auth/guard';

export const dynamic = 'force-dynamic';

/** Sube el CSV (campo `file` o texto `csv`) y opcionalmente `mapping` JSON. Devuelve vista previa sin guardar. Solo admin/coord. */
export async function POST(req: Request) {
  try {
    await requireUserOrThrow(['admin', 'coord']);
    await assertSameOrigin(req);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: (e as Forbidden).status ?? 403 });
  }
  const { csv, mapping } = await readBody(req);
  if (!csv.trim()) return NextResponse.json({ error: 'Sube un archivo CSV exportado de SportData.' }, { status: 400 });
  const table = csvToTable(csv);
  const guessed = guessMapping(table.headers);
  const finalMapping = { ...guessed, ...(mapping ?? {}) } as ColumnMapping;
  if (!finalMapping.birthDate || !(finalMapping.fullName || (finalMapping.firstName && finalMapping.lastName))) {
    return NextResponse.json({ headers: table.headers, mapping: finalMapping, needsMapping: true, sample: table.rows.slice(0, 5), error: 'No pude identificar las columnas de nombre y fecha de nacimiento. Elige el mapeo.' }, { status: 422 });
  }
  const repos = await getRepos();
  const existing = (await repos.registrations.all()).map((r) => ({ id: r.id, firstName: r.firstName, lastName: r.lastName, birthDate: r.birthDate, club: r.club, documentNumber: r.documentNumber, externalId: r.externalId, source: r.source }));
  const result = importSportData(table, { mapping: finalMapping, existing });
  return NextResponse.json({
    headers: table.headers, mapping: finalMapping, rows: table.rows.length,
    summary: { created: result.created.length, updated: result.updated.length, unchanged: result.unchanged.length, duplicatesInFile: result.duplicatesInFile, errors: result.errors },
    preview: result.created.slice(0, 10)
  });
}

import type { ColumnMapping } from '@tatami/core';

/** Lee el CSV del cuerpo: multipart (campo `file` o `csv`) o JSON `{csv, mapping, fileName}`. */
export async function readBody(req: Request): Promise<{ csv: string; mapping?: Partial<ColumnMapping>; fileName?: string }> {
  const ct = req.headers.get('content-type') ?? '';
  if (ct.includes('multipart/form-data')) {
    const form = await req.formData();
    const file = form.get('file');
    const csv = file instanceof File ? await file.text() : String(form.get('csv') ?? '');
    const m = form.get('mapping');
    return { csv, mapping: typeof m === 'string' && m ? JSON.parse(m) : undefined, fileName: file instanceof File ? file.name : undefined };
  }
  const body = (await req.json().catch(() => ({}))) as { csv?: string; mapping?: Partial<ColumnMapping>; fileName?: string };
  return { csv: body.csv ?? '', mapping: body.mapping, fileName: body.fileName };
}

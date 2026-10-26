'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Preview {
  headers: string[];
  mapping: Record<string, string | undefined>;
  rows?: number;
  needsMapping?: boolean;
  error?: string;
  summary?: { created: number; updated: number; unchanged: number; duplicatesInFile: number; errors: { row: number; message: string }[] };
  preview?: { firstName: string; lastName: string; birthDate: string; club?: string }[];
}

const FIELDS: [string, string][] = [['firstName', 'Nombre'], ['lastName', 'Apellido'], ['fullName', 'Nombre completo (si viene en una sola columna)'], ['birthDate', 'Fecha de nacimiento'], ['club', 'Club'], ['documentNumber', 'Documento'], ['externalId', 'ID SportData'],
  ['delegation', 'Delegación / departamento (opcional)'], ['emergencyName', 'Contacto de emergencia: nombre (opcional)'], ['emergencyPhone', 'Contacto de emergencia: teléfono (opcional)'], ['epsName', 'EPS (opcional)'], ['epsRegime', 'Régimen EPS (opcional)']];

export function ImportForm() {
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<Preview>();
  const [mapping, setMapping] = useState<Record<string, string | undefined>>({});
  const [result, setResult] = useState<{ created: number; updated: number; unchanged: number; duplicatesInFile: number }>();
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function call(path: string) {
    setBusy(true);
    try {
      const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ csv, mapping, fileName }) });
      const data = (await res.json()) as Preview & { ok?: boolean; created?: number; updated?: number; unchanged?: number; duplicatesInFile?: number };
      if (res.status === 401 || res.status === 403) window.location.href = '/panel/login?next=/panel/importar';
      return data;
    } finally {
      setBusy(false);
    }
  }

  async function doPreview() {
    setResult(undefined);
    const p = await call('/api/import/preview');
    setPreview(p);
    setMapping(p.mapping ?? {});
  }

  async function doConfirm() {
    const r = await call('/api/import/confirm');
    if (r.ok) { setResult({ created: r.created!, updated: r.updated!, unchanged: r.unchanged!, duplicatesInFile: r.duplicatesInFile! }); router.refresh(); }
  }

  return (
    <div className="card">

      <div className="grid">
        <label><span className="label">Archivo CSV</span>
          <input type="file" accept=".csv,text/csv" className="input" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { setFileName(f.name); setCsv(await f.text()); setPreview(undefined); setResult(undefined); } }} />
          {fileName && <div className="label" style={{ marginTop: 6 }}>{fileName} · {csv.split('\n').length - 1} filas</div>}
        </label>
      </div>
      <div style={{ marginTop: 16 }}>
        <button className="btn primary" disabled={!csv || busy} onClick={() => void doPreview()}>Ver vista previa</button>
      </div>

      {preview && (
        <div style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: 20 }}>Mapeo de columnas</h2>
          {preview.error && <div className="notice warn">{preview.error}</div>}
          <div className="grid">
            {FIELDS.map(([key, label]) => (
              <label key={key}><span className="label">{label}</span>
                <select className="input" value={mapping[key] ?? ''} onChange={(e) => setMapping((m) => ({ ...m, [key]: e.target.value || undefined }))}>
                  <option value="">—</option>
                  {preview.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </label>
            ))}
          </div>
          <div style={{ marginTop: 12 }}>
            <button className="btn secondary" disabled={busy} onClick={() => void doPreview()}>Recalcular vista previa</button>
          </div>

          {preview.summary && (
            <>
              <div className="notice ok">
                Nuevos: <strong>{preview.summary.created}</strong> · Actualizados: <strong>{preview.summary.updated}</strong> · Sin cambios: <strong>{preview.summary.unchanged}</strong> · Repetidos en el archivo: <strong>{preview.summary.duplicatesInFile}</strong> · Filas con error: <strong>{preview.summary.errors.length}</strong>
              </div>
              {preview.summary.errors.length > 0 && (
                <div className="notice bad">
                  {preview.summary.errors.slice(0, 10).map((e) => <div key={e.row}>Fila {e.row}: {e.message}</div>)}
                </div>
              )}
              {preview.preview && preview.preview.length > 0 && (
                <table>
                  <thead><tr><th>Nombre</th><th>Apellido</th><th>Nacimiento</th><th>Club</th></tr></thead>
                  <tbody>{preview.preview.map((p, i) => <tr key={i}><td>{p.firstName}</td><td>{p.lastName}</td><td>{p.birthDate}</td><td>{p.club ?? ''}</td></tr>)}</tbody>
                </table>
              )}
              <div style={{ marginTop: 16 }}>
                <button className="btn primary" disabled={busy || !!result} onClick={() => void doConfirm()}>Confirmar importación</button>
              </div>
            </>
          )}
        </div>
      )}

      {result && (
        <div className="notice ok" style={{ marginTop: 20 }}>
          Importación aplicada: {result.created} nuevos, {result.updated} actualizados, {result.unchanged} sin cambios. Quedan como competidores aprobados con categoría calculada por edad.
        </div>
      )}
    </div>
  );
}

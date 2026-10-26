import { requireUser } from '@/lib/auth/guard';
import { getRepos } from '@/lib/db';
import { fmt, PageHead } from '../ui';
import { ImportForm } from './form';

export const dynamic = 'force-dynamic';

export default async function ImportarPage() {
  await requireUser(['admin', 'coord']);
  const repos = await getRepos();
  const batches = await repos.settings.importBatches(30);
  return (
    <>
      <PageHead title="Importar SportData" subtitle="Exporta la lista en CSV desde SportData, súbela, revisa el mapeo y la vista previa y confirma. Reimportar el mismo archivo no duplica a nadie: actualiza." />
      <ImportForm />
      <div className="card" style={{ marginTop: 20 }}>
        <h2 style={{ fontSize: 18 }}>Historial de lotes</h2>
        {batches.length === 0 ? <p className="small muted" style={{ marginTop: 8 }}>Todavía no se ha importado nada.</p> : (
          <table>
            <thead><tr><th>Fecha</th><th>Archivo</th><th>Filas</th><th>Nuevos</th><th>Actualizados</th><th>Sin cambios</th><th>Repetidos</th><th>Errores</th><th>Por</th></tr></thead>
            <tbody>{batches.map((b) => <tr key={b.id}><td className="small">{fmt(b.createdAt)}</td><td>{b.fileName ?? '—'}</td><td>{b.rows}</td><td>{b.created}</td><td>{b.updated}</td><td>{b.unchanged}</td><td>{b.duplicatesInFile}</td><td>{b.errors.length}</td><td className="small muted">{b.byUser ?? '—'}</td></tr>)}</tbody>
          </table>
        )}
      </div>
    </>
  );
}

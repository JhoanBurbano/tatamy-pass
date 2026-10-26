import Link from 'next/link';
import { requireUser } from '@/lib/auth/guard';
import { eventConfig } from '@/lib/config';
import { getRepos } from '@/lib/db';
import { saveEventAction, saveFormAction } from '../actions';
import { Flash, PageHead, type Search } from '../ui';

export const dynamic = 'force-dynamic';

/** ISO → valor para <input type="datetime-local"> en hora de Colombia. */
function toLocal(iso: string): string {
  if (!iso) return '';
  const d = new Date(new Date(iso).getTime() - 5 * 3600_000);
  return d.toISOString().slice(0, 16);
}

export default async function EventoPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireUser(['admin', 'coord']);
  const sp = await searchParams;
  const repos = await getRepos();
  const { config, form, window } = await eventConfig(repos);
  const usedCat = await repos.registrations.countByCategory();
  const cats = [...config.ageCategories, ...Array.from({ length: 2 }, () => undefined)];

  return (
    <>
      <PageHead title="Configuración del evento" subtitle="Nombre, fechas, tipos de inscripción, categorías de edad y textos del formulario. Los cupos se editan en Cupos.">
        <Link className="btn ghost sm" href="/panel/cupos">Ir a Cupos →</Link>
      </PageHead>
      <Flash sp={sp} />
      <form action={saveEventAction} className="stack">
        <div className="card">
          <h2 style={{ fontSize: 18 }}>Datos del evento</h2>
          <div className="grid">
            <label style={{ gridColumn: '1 / -1' }}><span className="label">Nombre</span><input className="input" name="name" defaultValue={config.name} required maxLength={120} /></label>
            <label><span className="label">Primer día (la edad se calcula a esta fecha)</span><input className="input" type="date" name="startDate" defaultValue={config.startDate} required /></label>
            <label><span className="label">Último día</span><input className="input" type="date" name="endDate" defaultValue={config.endDate} required /></label>
          </div>
          <p className="small muted" style={{ marginTop: 8 }}>Identificador del evento: <code>{config.eventId}</code> · prefijo de credenciales <code>{config.idPrefix}</code> (se definen en el host y no se cambian desde aquí).</p>
        </div>

        <div className="card">
          <h2 style={{ fontSize: 18 }}>Tipos de inscripción (roles de acceso)</h2>
          <p className="small muted">Las zonas y colores vienen de la configuración del host. Aquí decides el nombre que ve la gente, si el formulario pide foto y si el rol usa credencial digital (QR rotativo en el celular) en vez de impresa.</p>
          <table>
            <thead><tr><th>Código</th><th>Nombre</th><th>Zonas</th><th>Pide foto</th><th>Credencial digital</th></tr></thead>
            <tbody>
              {config.roles.map((r) => (
                <tr key={r.code}>
                  <td className="mono">{r.code}</td>
                  <td><input className="input sm" name={`role.${r.code}.name`} defaultValue={r.name} maxLength={60} /></td>
                  <td className="small muted">{r.zones.join(', ')}</td>
                  <td><input type="checkbox" name={`role.${r.code}.requiresPhoto`} defaultChecked={r.requiresPhoto} aria-label={`Pide foto ${r.name}`} /></td>
                  <td><input type="checkbox" name={`role.${r.code}.allowsDigital`} defaultChecked={r.allowsDigital} aria-label={`Credencial digital ${r.name}`} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h2 style={{ fontSize: 18 }}>Categorías por edad (competidores)</h2>
          <p className="small muted">Edades cumplidas el primer día del evento. Deja la edad máxima vacía para “en adelante”. Borra el código para quitar una categoría (los cupos por categoría se editan en Cupos).</p>
          <table>
            <thead><tr><th>Código</th><th>Nombre</th><th>Edad mín.</th><th>Edad máx.</th><th>Inscritos</th></tr></thead>
            <tbody>
              {cats.map((c, i) => (
                <tr key={i}>
                  <td><input className="input sm" name={`cat.${i}.code`} defaultValue={c?.code ?? ''} style={{ width: 90 }} placeholder={c ? '' : 'NUEVA'} maxLength={10} /></td>
                  <td><input className="input sm" name={`cat.${i}.name`} defaultValue={c?.name ?? ''} maxLength={60} /></td>
                  <td><input className="input sm" type="number" min={0} name={`cat.${i}.min`} defaultValue={c?.minAge ?? ''} style={{ width: 80 }} /></td>
                  <td><input className="input sm" type="number" min={0} name={`cat.${i}.max`} defaultValue={c?.maxAge ?? ''} style={{ width: 80 }} /></td>
                  <td>{c ? usedCat[c.code] ?? 0 : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div><button className="btn primary" type="submit">Guardar configuración</button></div>
      </form>

      <form action={saveFormAction} className="stack" style={{ marginTop: 28 }}>
        <div className="card">
          <h2 style={{ fontSize: 18 }}>Formulario público, consentimiento y aviso de privacidad</h2>
          <div className={`notice ${window.open ? 'ok' : 'warn'}`} style={{ marginTop: 10 }}>{window.open ? 'Las inscripciones están abiertas ahora.' : window.reason}</div>
          <div className="grid">
            <label><span className="label">Apertura (hora de Colombia; vacío = abierto)</span><input className="input" type="datetime-local" name="opensAt" defaultValue={toLocal(form.opensAt)} /></label>
            <label><span className="label">Cierre (vacío = sin cierre). Después del cierre los inscriptores ya no editan.</span><input className="input" type="datetime-local" name="closesAt" defaultValue={toLocal(form.closesAt)} /></label>
            <label style={{ gridColumn: '1 / -1' }}><span className="label">Texto de introducción</span><textarea className="input" name="intro" rows={2} defaultValue={form.intro} maxLength={600} /></label>
            <label style={{ gridColumn: '1 / -1' }}><span className="label">Texto tras enviar</span><textarea className="input" name="successNote" rows={2} defaultValue={form.successNote} maxLength={600} /></label>
            <label style={{ gridColumn: '1 / -1' }}><span className="label">Aviso de privacidad (Ley 1581 de 2012). Se muestra junto a la casilla de consentimiento y en los correos.</span><textarea className="input" name="privacyNotice" rows={6} defaultValue={form.privacyNotice} maxLength={4000} required /></label>
          </div>
          <p className="small muted" style={{ marginTop: 8 }}>La casilla de consentimiento del acudiente (menores) y la de aviso de privacidad son obligatorias siempre; su texto fijo está en docs/70-UX-WRITING.md §5.4.</p>
        </div>
        <div><button className="btn primary" type="submit">Guardar textos y fechas</button></div>
      </form>
    </>
  );
}

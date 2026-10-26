import Link from 'next/link';
import { eventConfig } from '@/lib/config';
import { getRepos } from '@/lib/db';
import { digitalInfo } from '@/lib/digital';
import { publicStatus } from '@/lib/labels';
import { credentialUrl } from '@/lib/mail-templates';
import type { Registration } from '@/lib/repo/types';

export const dynamic = 'force-dynamic';

/** Página pública: solo muestra lo necesario (nombre, rol, estado). Sin documento ni correo. */
export default async function EstadoCodigoPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const repos = await getRepos();
  const r = await repos.registrations.byCode(decodeURIComponent(code));
  if (!r) {
    return (
      <div className="card belt" style={{ maxWidth: 520, margin: '20px auto' }}>
        <h1 className="title">No encontré ese código</h1>
        <p className="subtitle">Revisa que esté completo, por ejemplo N26-ABC234. Si lo perdiste, escribe al coordinador con tu nombre y club.</p>
        <Link className="btn secondary" href="/estado" style={{ display: 'inline-block', marginTop: 16, textDecoration: 'none' }}>Probar otro código</Link>
      </div>
    );
  }
  const { config } = await eventConfig(repos);
  const role = config.roles.find((x) => x.code === r.roleCode);
  const cat = config.ageCategories.find((x) => x.code === r.categoryCode);
  const companions = await repos.registrations.companionsOf(r.id);
  const st = publicStatus(r);
  const digital = digitalInfo(r, config);
  const digitalCompanions = companions.filter((c) => c.credentialToken && digitalInfo(c, config).allowed);
  return (
    <div className="card belt" style={{ maxWidth: 560, margin: '20px auto' }}>
      <div className="status-hero">
        <div className="label">Inscripción</div>
        <div className="code">{r.code}</div>
        <h1 className="title" style={{ fontSize: 24, marginTop: 8 }}>{r.firstName} {r.lastName}</h1>
        <p className="subtitle">{role?.name ?? r.roleCode}{cat ? ` · ${cat.name}` : ''}{r.club ? ` · ${r.club}` : ''}</p>
        <div style={{ marginTop: 14 }}><span className={`badge ${st.tone}`} style={{ fontSize: 15, padding: '8px 14px' }}>{st.label}</span></div>
        <p className="subtitle" style={{ marginTop: 12 }}>{st.hint}</p>
      </div>
      <Timeline r={r} />
      {(digital.allowed || digitalCompanions.length > 0) && r.status === 'APPROVED' && (
        <div className="notice info" style={{ marginTop: 16 }}>
          <strong>Credencial digital.</strong> {digital.allowed && r.credentialToken ? <>Ábrela en tu celular el día del evento: <Link href={credentialUrl(r.credentialToken)}>{credentialUrl(r.credentialToken)}</Link>. </> : null}
          {digitalCompanions.length > 0 && <div className="small" style={{ marginTop: 6 }}>Acompañantes: {digitalCompanions.map((c) => <span key={c.id}>{c.firstName} {c.lastName} → <Link href={credentialUrl(c.credentialToken!)}>abrir</Link>. </span>)}Cada uno la abre en su propio celular.</div>}
        </div>
      )}
      {companions.length > 0 && <p className="small muted" style={{ marginTop: 16 }}>Acompañantes: {companions.map((c) => `${c.firstName} ${c.lastName}`.trim()).join(', ')}. Entran contigo a la gradería con credencial digital.</p>}
      <p className="small muted" style={{ marginTop: 16 }}>Evento: {config.name}, del {config.startDate} al {config.endDate}.</p>
    </div>
  );
}

function Timeline({ r }: { r: Registration }) {
  const steps: { label: string; state: 'done' | 'now' | 'todo' | 'bad' }[] = [];
  const rejected = r.status === 'REJECTED';
  const approved = r.status === 'APPROVED';
  const cred = r.credentialStatus;
  steps.push({ label: 'Inscripción recibida', state: 'done' });
  if (r.status === 'WAITLIST' || r.status === 'OFFERED' || r.status === 'EXPIRED') steps.push({ label: r.status === 'OFFERED' ? 'Cupo ofrecido: confirma por correo' : r.status === 'EXPIRED' ? 'La oferta de cupo venció' : 'En lista de espera', state: r.status === 'EXPIRED' ? 'bad' : 'now' });
  steps.push({ label: 'Validada (edad y cupo)', state: r.status === 'PENDING' || approved || rejected ? 'done' : 'todo' });
  steps.push({ label: rejected ? `No aprobada${r.rejectionReason ? `: ${r.rejectionReason}` : ''}` : 'Aprobada por el coordinador', state: rejected ? 'bad' : approved ? 'done' : r.status === 'PENDING' ? 'now' : 'todo' });
  if (!rejected) {
    steps.push({ label: 'Credencial emitida e impresa', state: r.revokedAt ? 'bad' : cred === 'DELIVERED' || cred === 'PRINTED' || cred === 'ISSUED' ? 'done' : approved ? 'now' : 'todo' });
    steps.push({ label: r.revokedAt ? 'Credencial anulada' : 'Credencial entregada en acreditación', state: r.revokedAt ? 'bad' : cred === 'DELIVERED' ? 'done' : 'todo' });
  }
  return <ul className="timeline">{steps.map((s, i) => <li key={i} className={s.state === 'todo' ? '' : s.state}><span className="dot" />{s.label}</li>)}</ul>;
}

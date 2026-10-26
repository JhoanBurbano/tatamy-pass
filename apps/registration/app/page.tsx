'use client';

import { useEffect, useMemo, useState } from 'react';
import { ageOn, categoryForAge, companionsCounterLabel, isIsoDate, remainingFor, type AgeCategory } from '@tatami/core';
import { PhotoCrop } from './photo-crop';
import { whoAmI } from './panel/actions';

interface Status {
  event: { id: string; name: string; startDate: string; endDate: string };
  window: { open: boolean; reason?: string };
  form: { intro: string; successNote: string; privacyNotice: string; opensAt: string | null; closesAt: string | null };
  roles: { code: string; name: string; capacity: number | null; requiresPhoto: boolean; used: number; remaining: number | null }[];
  ageCategories: AgeCategory[];
  delegations: { id: string; name: string }[];
  companions: { perParticipant: number | null; total: number | null; usedTotal: number; remainingTotal: number | null };
  totalCapacity: number | null;
  /** Si el contacto de emergencia es obligatorio (event.config.json › registration.requireEmergencyContact). */
  requireEmergencyContact?: boolean;
  usedTotalEvent: number;
  remainingTotalEvent: number | null;
}

interface CompanionDraft { name: string; document: string; relationship: string; photo?: string }

type Outcome =
  | { ok: true; status: 'PENDING' | 'WAITLIST'; message: string; registration: { code?: string; email?: string }; companions: { firstName: string; lastName: string }[] }
  | { ok: false; code: 'VALIDATION' | 'CAPACITY_FULL' | 'CLOSED' | 'RATE_LIMIT'; errors: Record<string, string>; message: string };

const PUBLIC_ROLES = ['COMP', 'COACH', 'GEN', 'PRESS'];

export default function RegisterPage() {
  const [status, setStatus] = useState<Status>();
  const [form, setForm] = useState({
    firstName: '', lastName: '', birthDate: '', documentNumber: '', club: '', email: '', roleCode: 'COMP', categoryCode: '',
    guardianName: '', guardianDocument: '', guardianConsent: false, acceptWaitlist: false, privacyConsent: false,
    delegation: '', emergencyName: '', emergencyPhone: '', epsName: '', epsRegime: ''
  });
  const [photo, setPhoto] = useState<string>();
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [companions, setCompanions] = useState<CompanionDraft[]>([]);
  const [outcome, setOutcome] = useState<Outcome>();
  const [busy, setBusy] = useState(false);

  useEffect(() => { void fetch('/api/status').then((r) => r.json()).then(setStatus); }, []);
  // Inscriptor con sesión: precarga el club de su delegación para que la inscripción quede en su lista.
  useEffect(() => {
    if (!status) return;
    void whoAmI().then((me) => {
      const name = me?.delegationId ? status.delegations.find((d) => d.id === me.delegationId)?.name : undefined;
      if (name) setForm((f) => (f.club ? f : { ...f, club: name }));
    }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.event.id]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value }));

  const age = useMemo(() => (status && isIsoDate(form.birthDate) ? ageOn(form.birthDate, status.event.startDate) : undefined), [form.birthDate, status]);
  const suggested = useMemo(() => (age !== undefined && status ? categoryForAge(age, status.ageCategories) : undefined), [age, status]);
  const minor = age !== undefined && age < 18;
  const role = status?.roles.find((r) => r.code === form.roleCode);
  const roleFull = role?.remaining === 0;
  const errors = outcome && !outcome.ok ? outcome.errors : {};

  // Acompañantes: límite por participante, cupo total y aforo (mismas reglas que el servidor).
  const perLimit = status?.companions.perParticipant ?? null;
  const remainingPer = remainingFor(perLimit, companions.length);
  const remainingTotal = status ? remainingFor(status.companions.total, status.companions.usedTotal + companions.length) : Infinity;
  const remainingEvent = status ? remainingFor(status.totalCapacity, status.usedTotalEvent + 1 + companions.length) : Infinity;
  const companionBlock = remainingPer <= 0 ? `Este participante ya tiene ${companions.length} acompañante${companions.length === 1 ? '' : 's'}, el máximo permitido.`
    : remainingTotal <= 0 ? 'Se llenó el cupo de acompañantes del evento.'
    : remainingEvent <= 0 ? 'El evento llegó a su aforo total.' : undefined;
  const updateCompanion = (i: number, k: keyof CompanionDraft, v: string | undefined) => setCompanions((cs) => cs.map((c, j) => (j === i ? { ...c, [k]: v } : c)));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch('/api/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...form, photo, companions }) });
      setOutcome((await res.json()) as Outcome);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      void fetch('/api/status').then((r) => r.json()).then(setStatus);
    } finally {
      setBusy(false);
    }
  }

  if (!status) return <div className="card"><p>Cargando…</p></div>;

  if (outcome?.ok) {
    return (
      <div className="card belt">
        <h1 className="title">{outcome.status === 'WAITLIST' ? 'Quedaste en lista de espera' : '¡Inscripción recibida!'}</h1>
        <p className="subtitle">{outcome.message}</p>
        {outcome.registration.code && (
          <div className="status-hero" style={{ marginTop: 12 }}>
            <div className="label">Código de inscripción</div>
            <div className="code">{outcome.registration.code}</div>
            <p className="small muted">Guárdalo: con él consultas el estado en <a href={`/estado/${outcome.registration.code}`}>/estado/{outcome.registration.code}</a>.{outcome.registration.email ? ` También te lo enviamos a ${outcome.registration.email}.` : ''}</p>
          </div>
        )}
        {outcome.companions.length > 0 && <p className="subtitle">Acompañantes registrados: {outcome.companions.map((c) => `${c.firstName} ${c.lastName}`.trim()).join(', ')}.</p>}
        <p className="subtitle">{status.form.successNote}</p>
        <button className="btn secondary" style={{ marginTop: 20 }} onClick={() => { setOutcome(undefined); setCompanions([]); setPhoto(undefined); setForm((f) => ({ ...f, firstName: '', lastName: '', birthDate: '', documentNumber: '', email: '', categoryCode: '', acceptWaitlist: false, privacyConsent: false })); }}>Inscribir a otra persona</button>
      </div>
    );
  }

  if (!status.window.open) {
    return (
      <div className="card belt">
        <h1 className="title">Inscripción · {status.event.name}</h1>
        <div className="notice warn">{status.window.reason}</div>
        <p className="subtitle">¿Ya te inscribiste? <a href="/estado">Consulta el estado con tu código</a>.</p>
      </div>
    );
  }

  return (
    <form className="card belt" onSubmit={(e) => void submit(e)} noValidate>
      <h1 className="title">Inscripción · {status.event.name}</h1>
      <p className="subtitle">Del {status.event.startDate} al {status.event.endDate}. {status.form.intro}</p>
      <div className="chips">
        {status.roles.filter((r) => PUBLIC_ROLES.includes(r.code)).map((r) => (
          <span key={r.code} className={`chip ${r.remaining === 0 ? 'full' : ''}`}>{r.name}: {r.remaining === null ? 'sin límite' : r.remaining === 0 ? 'cupo lleno' : `${r.remaining} cupos`}</span>
        ))}
      </div>

      <div className="grid">
        <label><span className="label">Tipo de inscripción</span>
          <select className="input" value={form.roleCode} onChange={set('roleCode')}>
            {status.roles.filter((r) => PUBLIC_ROLES.includes(r.code)).map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
          </select>
        </label>
        <label><span className="label">Nombre</span><input className={`input ${errors.firstName ? 'invalid' : ''}`} value={form.firstName} onChange={set('firstName')} />{errors.firstName && <div className="err">{errors.firstName}</div>}</label>
        <label><span className="label">Apellido</span><input className={`input ${errors.lastName ? 'invalid' : ''}`} value={form.lastName} onChange={set('lastName')} />{errors.lastName && <div className="err">{errors.lastName}</div>}</label>
        <label><span className="label">Fecha de nacimiento</span><input type="date" className={`input ${errors.birthDate ? 'invalid' : ''}`} value={form.birthDate} onChange={set('birthDate')} />
          {age !== undefined && <div className="label" style={{ marginTop: 6 }}>Tendrá {age} años el {status.event.startDate}{suggested ? ` · categoría ${suggested.name}` : ''}</div>}
          {errors.birthDate && <div className="err">{errors.birthDate}</div>}
        </label>
        <label><span className="label">Documento de identidad</span><input className="input" value={form.documentNumber} onChange={set('documentNumber')} /></label>
        <label><span className="label">Club / delegación</span><input className="input" list="delegations" value={form.club} onChange={set('club')} placeholder="Escribe o elige" />
          <datalist id="delegations">{status.delegations.map((d) => <option key={d.id} value={d.name} />)}</datalist>
        </label>
        <label><span className="label">Delegación (departamento o región)</span><input className="input" value={form.delegation} onChange={set('delegation')} placeholder="Cauca" /><div className="label" style={{ marginTop: 6 }}>Se imprime en la credencial.</div></label>
        <label><span className="label">Correo (para avisos)</span><input type="email" className={`input ${errors.email ? 'invalid' : ''}`} value={form.email} onChange={set('email')} />{errors.email && <div className="err">{errors.email}</div>}</label>
        {form.roleCode === 'COMP' && (
          <label><span className="label">Categoría</span>
            <select className={`input ${errors.categoryCode ? 'invalid' : ''}`} value={form.categoryCode} onChange={set('categoryCode')}>
              <option value="">Elige…</option>
              {status.ageCategories.map((c) => <option key={c.code} value={c.code}>{c.name} ({c.minAge}{c.maxAge === null ? '+' : `–${c.maxAge}`} años)</option>)}
            </select>
            {errors.categoryCode && <div className="err">{errors.categoryCode}</div>}
          </label>
        )}
      </div>

      {role?.requiresPhoto !== false && (
        <div className="card" style={{ marginTop: 20, boxShadow: 'none', border: '2px solid #E2E8F0' }}>
          <h2 style={{ fontSize: 20 }}>Foto para la credencial</h2>
          <p className="subtitle">{role?.requiresPhoto ? 'Las credenciales con foto se comparan en la puerta.' : 'Opcional para este tipo de inscripción.'}</p>
          <div style={{ marginTop: 12 }}><PhotoCrop label="" value={photo} onChange={setPhoto} /></div>
          {errors.photo && <div className="err">{errors.photo}</div>}
        </div>
      )}

      <div className="card" style={{ marginTop: 20, boxShadow: 'none', border: '2px solid #E2E8F0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: 20 }}>Acompañantes</h2>
          <span className="chip">{companionsCounterLabel(companions.length, perLimit)}</span>
        </div>
        <p className="subtitle">Personas que entran contigo a la gradería. Reciben credencial digital en su celular.</p>
        {companions.map((c, i) => (
          <div className="grid" key={i} style={{ alignItems: 'end' }}>
            <label><span className="label">Nombre completo</span><input className="input" value={c.name} onChange={(e) => updateCompanion(i, 'name', e.target.value)} /></label>
            <label><span className="label">Documento (opcional)</span><input className="input" value={c.document} onChange={(e) => updateCompanion(i, 'document', e.target.value)} /></label>
            <label><span className="label">Parentesco (opcional)</span><input className="input" value={c.relationship} onChange={(e) => updateCompanion(i, 'relationship', e.target.value)} placeholder="Madre, pareja, amigo…" /></label>
            <button type="button" className="btn secondary" onClick={() => setCompanions((cs) => cs.filter((_, j) => j !== i))}>Quitar</button>
            <div style={{ gridColumn: '1 / -1' }}><PhotoCrop label="Foto (opcional)" value={c.photo} onChange={(v) => updateCompanion(i, 'photo', v)} hint="Opcional: la credencial digital del acompañante puede llevar foto." /></div>
          </div>
        ))}
        <div style={{ marginTop: 12 }}>
          <button type="button" className="btn secondary" disabled={!!companionBlock} onClick={() => setCompanions((cs) => [...cs, { name: '', document: '', relationship: '' }])}>Agregar acompañante</button>
          {companionBlock && <div className="err">{companionBlock}</div>}
          {errors.companions && <div className="err">{errors.companions}</div>}
        </div>
      </div>

      <div className="card" style={{ marginTop: 20, boxShadow: 'none', border: '2px solid #E2E8F0' }}>
        <h2 style={{ fontSize: 20 }}>Contacto de emergencia y EPS</h2>
        <p className="subtitle">{status.requireEmergencyContact ? 'Obligatorio: ' : 'Opcional: '}van impresos en el reverso de la credencial para que el equipo médico sepa a quién llamar.</p>
        <div className="grid">
          <label><span className="label">A quién llamar en una emergencia{status.requireEmergencyContact ? '' : ' (opcional)'}</span><input className={`input ${errors.emergencyName ? 'invalid' : ''}`} value={form.emergencyName} onChange={set('emergencyName')} placeholder="Nombre" />{errors.emergencyName && <div className="err">{errors.emergencyName}</div>}</label>
          <label><span className="label">Teléfono de ese contacto</span><input type="tel" className={`input ${errors.emergencyPhone ? 'invalid' : ''}`} value={form.emergencyPhone} onChange={set('emergencyPhone')} placeholder="310 234 5678" />{errors.emergencyPhone && <div className="err">{errors.emergencyPhone}</div>}</label>
          <label><span className="label">EPS (opcional)</span><input className="input" value={form.epsName} onChange={set('epsName')} placeholder="EPS Sura" /></label>
          <label><span className="label">Régimen (opcional)</span>
            <select className="input" value={form.epsRegime} onChange={set('epsRegime')}><option value="">Elige…</option><option>Régimen Contributivo</option><option>Régimen Subsidiado</option><option>Régimen Especial</option><option>Medicina prepagada</option></select>
          </label>
        </div>
      </div>

      {minor && (
        <div className="notice warn">
          <strong>Menor de edad.</strong> Un acudiente debe autorizar el tratamiento de sus datos.
          <div className="grid">
            <label><span className="label">Nombre del acudiente</span><input className={`input ${errors.guardianName ? 'invalid' : ''}`} value={form.guardianName} onChange={set('guardianName')} />{errors.guardianName && <div className="err">{errors.guardianName}</div>}</label>
            <label><span className="label">Documento del acudiente</span><input className={`input ${errors.guardianDocument ? 'invalid' : ''}`} value={form.guardianDocument} onChange={set('guardianDocument')} />{errors.guardianDocument && <div className="err">{errors.guardianDocument}</div>}</label>
          </div>
          <label className="check"><input type="checkbox" checked={form.guardianConsent} onChange={set('guardianConsent')} /><span>Como acudiente autorizo la inscripción y el tratamiento de los datos del menor para la acreditación del evento (Ley 1581 de 2012).</span></label>
          {errors.guardianConsent && <div className="err">{errors.guardianConsent}</div>}
        </div>
      )}

      {(roleFull || outcome?.code === 'CAPACITY_FULL') && (
        <div className="notice bad">
          <strong>Cupo lleno para {role?.name}.</strong> {outcome?.code === 'CAPACITY_FULL' ? outcome.message : 'Puedes inscribirte en lista de espera.'}
          <label className="check"><input type="checkbox" checked={form.acceptWaitlist} onChange={set('acceptWaitlist')} /><span>Quiero quedar en lista de espera.</span></label>
        </div>
      )}
      {outcome && !outcome.ok && (outcome.code === 'VALIDATION' || outcome.code === 'CLOSED' || outcome.code === 'RATE_LIMIT') && <div className="notice bad">{outcome.message}</div>}

      <div className="notice muted" style={{ marginTop: 20 }}>
        <label className="check" style={{ marginTop: 0 }}><input type="checkbox" checked={form.privacyConsent} onChange={set('privacyConsent')} /><span>He leído el <button type="button" className="btn ghost sm" style={{ minHeight: 0, padding: '0 4px', border: 'none' }} onClick={() => setShowPrivacy((v) => !v)}>aviso de privacidad</button> y autorizo el tratamiento de mis datos (y de los del menor que inscribo, si aplica) para el campeonato.</span></label>
        {showPrivacy && <p className="small" style={{ marginTop: 10, whiteSpace: 'pre-wrap' }}>{status.form.privacyNotice}</p>}
        {errors.privacyConsent && <div className="err">{errors.privacyConsent}</div>}
      </div>

      <div style={{ marginTop: 24 }}>
        <button className="btn primary" type="submit" disabled={busy || (roleFull && !form.acceptWaitlist) || !form.privacyConsent}>{busy ? 'Enviando…' : roleFull ? 'Entrar en lista de espera' : 'Enviar inscripción'}</button>
        <p className="small muted" style={{ marginTop: 10 }}>¿Ya te inscribiste? <a href="/estado">Consulta el estado con tu código</a>.</p>
      </div>
    </form>
  );
}

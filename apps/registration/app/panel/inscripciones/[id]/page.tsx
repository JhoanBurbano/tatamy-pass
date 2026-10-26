import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ageOn } from '@tatami/core';
import { requireUser } from '@/lib/auth/guard';
import { eventConfig } from '@/lib/config';
import { getRepos } from '@/lib/db';
import { digitalInfo } from '@/lib/digital';
import { STATUS_LABEL } from '@/lib/labels';
import { credentialUrl } from '@/lib/mail-templates';
import { canEdit } from '@/lib/permissions';
import { addCompanionAction, approveAction, editRegistrationAction, rejectAction, removeCompanionAction, revokeAction, unrevokeAction } from '../../actions';
import { Avatar, CredentialBadge, Flash, fmt, fullName, PageHead, StatusBadge, type Search } from '../../ui';
import { PhotoForm } from './photo-form';

export const dynamic = 'force-dynamic';

export default async function DetallePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  const user = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const repos = await getRepos();
  const { config } = await eventConfig(repos);
  const r = await repos.registrations.byId(id);
  if (!r) notFound();
  if (user.role === 'club') {
    const own = user.delegationId && (r.delegationId === user.delegationId || (await repos.users.delegationById(user.delegationId))?.name.toLowerCase() === r.club?.toLowerCase());
    if (!own) notFound();
  }
  const manage = user.role !== 'club';
  const editable = await canEdit(user, r, repos);
  const companions = r.companionOf ? [] : await repos.registrations.companionsOf(r.id);
  const parent = r.companionOf ? await repos.registrations.byId(r.companionOf) : undefined;
  const role = config.roles.find((x) => x.code === r.roleCode);
  const cat = config.ageCategories.find((x) => x.code === r.categoryCode);
  const returnTo = `/panel/inscripciones/${r.id}`;
  const age = r.birthDate ? ageOn(r.birthDate, config.startDate) : undefined;
  const digital = digitalInfo(r, config);
  const remainingCompanions = config.companions.perParticipant === null ? Infinity : Math.max(0, config.companions.perParticipant - companions.length);

  return (
    <>
      <PageHead title={fullName(r)} subtitle={`${role?.name ?? r.roleCode}${cat ? ` · ${cat.name}` : ''}${r.club ? ` · ${r.club}` : ''}`}>
        <Link className="btn ghost sm" href={parent ? `/panel/inscripciones/${parent.id}` : '/panel/inscripciones'}>← Volver</Link>
      </PageHead>
      <Flash sp={sp} />
      <div className="cards">
        <div className="stack">
          <div className="card">
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <Avatar r={r} size="lg" />
              <div className="stack" style={{ gap: 6 }}>
                <div><StatusBadge status={r.status} /> <CredentialBadge r={r} /></div>
                <div className="small muted">{STATUS_LABEL[r.status]}{r.rejectionReason ? ` · ${r.rejectionReason}` : ''}</div>
                <div className="mono">{r.code ?? `acompañante de ${parent ? fullName(parent) : '—'}`}</div>
                {r.code && <a className="small" href={`/estado/${r.code}`} target="_blank" rel="noopener">Página pública de estado ↗</a>}
              </div>
            </div>
            <dl className="side-by" style={{ marginTop: 16, background: 'transparent', padding: 0 }}>
              <dt>Fecha de nacimiento</dt><dd>{r.birthDate || '—'}{age !== undefined && r.birthDate ? ` · ${age} años el ${config.startDate}` : ''}</dd>
              <dt>Documento</dt><dd>{r.documentNumber ?? '—'}</dd>
              <dt>Correo</dt><dd>{r.email ?? '—'}</dd>
              <dt>Origen</dt><dd>{r.source === 'sportdata' ? 'Importación SportData' : 'Formulario en línea'}{r.externalId ? ` · ID ${r.externalId}` : ''}</dd>
              <dt>Recibida / actualizada</dt><dd>{fmt(r.createdAt)} · {fmt(r.updatedAt)}</dd>
              {r.credentialId && <><dt>Credencial</dt><dd className="mono">{r.credentialId}{r.credentialVersion ? ` · v${r.credentialVersion}` : ''} · {fmt(r.credentialUpdatedAt)}</dd></>}
              {r.exportedAt && <><dt>Enviada al host</dt><dd>{fmt(r.exportedAt)}</dd></>}
              {r.revokedAt && <><dt>Anulada</dt><dd>{fmt(r.revokedAt)} · {r.revokeReason}</dd></>}
            </dl>
          </div>

          {editable.ok ? (
            <div className="card">
              <h2 style={{ fontSize: 18 }}>Editar datos</h2>
              <p className="small muted" style={{ marginTop: 4 }}>{manage ? 'Los cambios quedan en el registro de auditoría y, si ya está aprobada, el host los recibe en su próxima actualización.' : 'Puedes corregir los datos hasta el cierre de inscripciones.'}</p>
              <form action={editRegistrationAction} className="grid" style={{ marginTop: 12 }}>
                <input type="hidden" name="id" value={r.id} />
                <label><span className="label">Nombre</span><input className="input sm" name="firstName" defaultValue={r.firstName} required maxLength={80} /></label>
                <label><span className="label">Apellido</span><input className="input sm" name="lastName" defaultValue={r.lastName} required maxLength={80} /></label>
                {!r.companionOf && <label><span className="label">Fecha de nacimiento</span><input className="input sm" type="date" name="birthDate" defaultValue={r.birthDate} required /></label>}
                <label><span className="label">Documento</span><input className="input sm" name="documentNumber" defaultValue={r.documentNumber ?? ''} maxLength={30} /></label>
                {!r.companionOf && (
                  <label><span className="label">Club / delegación</span><input className="input sm" name="club" defaultValue={r.club ?? ''} maxLength={120} disabled={!manage} />{!manage && <input type="hidden" name="club" value={r.club ?? ''} />}</label>
                )}
                <label><span className="label">Correo</span><input className="input sm" type="email" name="email" defaultValue={r.email ?? ''} maxLength={160} /></label>
                {!r.companionOf && r.roleCode === 'COMP' && (
                  <label><span className="label">Categoría</span>
                    <select className="input sm" name="categoryCode" defaultValue={r.categoryCode ?? ''}>
                      <option value="">Elige…</option>
                      {config.ageCategories.map((c) => <option key={c.code} value={c.code}>{c.name} ({c.minAge}{c.maxAge === null ? '+' : `–${c.maxAge}`})</option>)}
                    </select>
                  </label>
                )}
                {r.companionOf && <label><span className="label">Parentesco</span><input className="input sm" name="relationship" defaultValue={r.relationship ?? ''} maxLength={60} /></label>}
                {!r.companionOf && (
                  <>
                    <label><span className="label">Acudiente (si es menor)</span><input className="input sm" name="guardianName" defaultValue={r.guardian?.name ?? ''} maxLength={120} /></label>
                    <label><span className="label">Documento del acudiente</span><input className="input sm" name="guardianDocument" defaultValue={r.guardian?.document ?? ''} maxLength={30} /></label>
                  </>
                )}
                <div style={{ alignSelf: 'end' }}><button className="btn primary sm" type="submit">Guardar cambios</button></div>
              </form>
              <div style={{ marginTop: 16 }}>
                <div className="label">Foto para la credencial {role?.requiresPhoto ? '(este rol la requiere)' : '(opcional)'}</div>
                <PhotoForm id={r.id} current={r.photoUrl} />
              </div>
            </div>
          ) : (
            !manage && <div className="notice muted small" style={{ marginTop: 0 }}>{editable.reason}</div>
          )}
        </div>

        <div className="stack">
          <div className="card">
            <h2 style={{ fontSize: 18 }}>Consentimiento</h2>
            {r.guardian ? (
              <p className="small" style={{ marginTop: 8 }}>Menor de edad. Acudiente <strong>{r.guardian.name}</strong> (doc. {r.guardian.document}) autorizó el tratamiento de datos el {fmt(r.guardian.consentAt)} (Ley 1581 de 2012).</p>
            ) : (
              <p className="small muted" style={{ marginTop: 8 }}>{r.companionOf ? 'Acompañante: consentimiento recogido con la inscripción del participante.' : 'Mayor de edad; no requiere acudiente.'}</p>
            )}
            <p className="small muted" style={{ marginTop: 6 }}>Aviso de privacidad: {r.consentAt ? `aceptado el ${fmt(r.consentAt)}` : r.source === 'sportdata' ? 'importado de SportData (consentimiento recogido por la federación)' : parent ? `aceptado con la inscripción de ${fullName(parent)}` : 'no registrado'}.</p>
          </div>

          {digital.allowed && (
            <div className="card">
              <h2 style={{ fontSize: 18 }}>Credencial digital</h2>
              <p className="small" style={{ marginTop: 8 }}><strong>{digital.title}.</strong> {digital.hint}</p>
              {r.credentialToken && (manage || editable.ok) && (
                <p className="small muted" style={{ marginTop: 6, wordBreak: 'break-all' }}>Enlace (va en el correo de aprobación): <a href={credentialUrl(r.credentialToken)} target="_blank" rel="noopener">{credentialUrl(r.credentialToken)}</a></p>
              )}
            </div>
          )}

          {!r.companionOf && (
            <div className="card">
              <h2 style={{ fontSize: 18 }}>Acompañantes ({companions.length}{config.companions.perParticipant !== null ? ` de ${config.companions.perParticipant}` : ''})</h2>
              {companions.length === 0 ? <p className="small muted" style={{ marginTop: 8 }}>Sin acompañantes.</p> : (
                <table><thead><tr><th></th><th>Nombre</th><th>Documento</th><th>Parentesco</th><th>Estado</th>{editable.ok && <th></th>}</tr></thead>
                  <tbody>{companions.map((c) => (
                    <tr key={c.id}>
                      <td><Avatar r={c} /></td>
                      <td><Link href={`/panel/inscripciones/${c.id}`}>{fullName(c)}</Link></td>
                      <td>{c.documentNumber ?? '—'}</td><td>{c.relationship ?? '—'}</td>
                      <td><StatusBadge status={c.status} /> <CredentialBadge r={c} /></td>
                      {editable.ok && <td><form action={removeCompanionAction}><input type="hidden" name="companionId" value={c.id} /><button className="btn ghost sm" type="submit">Quitar</button></form></td>}
                    </tr>
                  ))}</tbody>
                </table>
              )}
              {editable.ok && remainingCompanions > 0 && (
                <form action={addCompanionAction} className="grid" style={{ marginTop: 12 }}>
                  <input type="hidden" name="id" value={r.id} />
                  <label><span className="label">Nombre completo</span><input className="input sm" name="name" required maxLength={120} /></label>
                  <label><span className="label">Documento (opcional)</span><input className="input sm" name="document" maxLength={30} /></label>
                  <label><span className="label">Parentesco (opcional)</span><input className="input sm" name="relationship" maxLength={60} placeholder="Madre, pareja, amigo…" /></label>
                  <div style={{ alignSelf: 'end' }}><button className="btn secondary sm" type="submit">Agregar acompañante</button></div>
                </form>
              )}
              {editable.ok && remainingCompanions <= 0 && <p className="small muted" style={{ marginTop: 8 }}>Este participante ya tiene el máximo de acompañantes permitido.</p>}
            </div>
          )}

          {manage && !r.companionOf && (
            <div className="card">
              <h2 style={{ fontSize: 18 }}>Acciones</h2>
              <div className="row" style={{ marginTop: 12 }}>
                {r.status !== 'APPROVED' && <form action={approveAction}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="returnTo" value={returnTo} /><button className="btn primary sm" type="submit">Aprobar</button></form>}
                {r.status !== 'REJECTED' && (
                  <form action={rejectAction} className="inline-form"><input type="hidden" name="id" value={r.id} /><input type="hidden" name="returnTo" value={returnTo} />
                    <input className="input sm" name="reason" placeholder="Motivo del rechazo" required style={{ width: 220 }} /><button className="btn danger sm" type="submit">Rechazar</button>
                  </form>
                )}
              </div>
              {r.status === 'APPROVED' && (
                <div style={{ marginTop: 16 }}>
                  <div className="label">Credencial</div>
                  {r.revokedAt ? (
                    <form action={unrevokeAction} className="inline-form"><input type="hidden" name="id" value={r.id} /><input type="hidden" name="returnTo" value={returnTo} /><button className="btn secondary sm" type="submit">Retirar anulación</button></form>
                  ) : (
                    <form action={revokeAction} className="inline-form"><input type="hidden" name="id" value={r.id} /><input type="hidden" name="returnTo" value={returnTo} />
                      <input className="input sm" name="reason" placeholder="Motivo (perdida, uso indebido…)" required style={{ width: 240 }} /><button className="btn danger sm" type="submit">Anular credencial</button>
                    </form>
                  )}
                  <p className="small muted" style={{ marginTop: 6 }}>Anular aquí deja de servir en las puertas cuando el host actualice desde la nube (cada {process.env.TP_CLOUD_INTERVAL_MIN ?? 5} min o con el botón).</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

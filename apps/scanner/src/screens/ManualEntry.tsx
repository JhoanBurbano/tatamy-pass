import { useEffect, useState } from 'react';
import type { Credential, EventConfig } from '@tatami/core';
import { db, searchLocal } from '../db.js';
import { checkManualId, MANUAL_ENTRY_REASONS } from '../lib/manual.js';
import { Photo } from './Photo.js';
import { ReasonSheet, type ReasonResult } from './ReasonSheet.js';

/**
 * Ingreso manual (§4): el QR no se lee → ID corto (con dígito verificador
 * validado al escribir) o nombre → se ve la persona → motivo del catálogo →
 * "Registrar ingreso". Las reglas deciden igual; el motivo viaja en el evento.
 */
export function ManualEntry({ config, operator, onValidate, onManual, onCancel }: {
  config: EventConfig; operator: string;
  onValidate: (id: string) => void;
  onManual: (id: string, reason: ReasonResult) => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Credential[]>([]);
  const [selected, setSelected] = useState<Credential>();
  const [askReason, setAskReason] = useState(false);
  const idCheck = checkManualId(query);
  /** Código QR pegado (p. ej. desde un lector externo o en escritorio). */
  const pastedToken = query.trim().startsWith('TP1.') ? query.trim() : undefined;
  const looksLikeId = !pastedToken && (/^\s*[A-Za-z]{2}[\s\-_.]*\d/.test(query) || /^\s*\d{4}/.test(query));
  const roleName = (code: string) => config.roles.find((r) => r.code === code)?.name ?? code;

  // Búsqueda local mientras se escribe (por nombre o por número).
  useEffect(() => {
    let alive = true;
    const q = query.trim();
    if (q.length < 2 || q.startsWith('TP1.')) { setResults([]); return; }
    void searchLocal(q).then((r) => { if (alive) setResults(r); });
    return () => { alive = false; };
  }, [query]);

  // ID completo y válido → se busca directo en la lista local.
  useEffect(() => {
    let alive = true;
    if (!idCheck.ok) return;
    void db.credentials.get(idCheck.id).then((c) => { if (alive && c) setSelected(c); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idCheck.ok ? idCheck.id : '']);

  const target = selected?.id ?? (idCheck.ok ? idCheck.id : undefined) ?? pastedToken;
  const unknownId = idCheck.ok && !selected;

  return (
    <div className="card belt stack" data-testid="manual-screen">
      <div className="row">
        <div className="grow">
          <h1 className="title" style={{ fontSize: 24 }}>Ingreso manual</h1>
          <p className="subtitle">Solo si el QR no se lee. Queda registrado con tu nombre ({operator}).</p>
        </div>
      </div>
      <label>
        <span className="label">ID corto impreso bajo el QR, o nombre</span>
        <input
          className={`input big ${looksLikeId && !idCheck.ok && idCheck.state === 'check' ? 'invalid' : ''} ${idCheck.ok ? 'valid' : ''}`}
          data-testid="manual-input" value={query}
          onChange={(e) => { setQuery(e.target.value); setSelected(undefined); }}
          placeholder="TP-2026-00123-C o apellido" autoCapitalize="characters" autoCorrect="off" autoFocus
        />
      </label>
      {looksLikeId && (
        <p className={`id-check ${idCheck.ok ? 'ok' : idCheck.state}`} data-testid="id-check" data-state={idCheck.ok ? 'ok' : idCheck.state} role="status">
          {idCheck.ok ? `✓ ID correcto: ${idCheck.id}` : idCheck.error}
        </p>
      )}
      {pastedToken && <p className="id-check ok" data-testid="token-pasted">Código QR pegado · se valida igual que con la cámara.</p>}
      {unknownId && <p className="error" data-testid="id-unknown">Ese ID no está en la lista de este dispositivo. Puedes registrar igual: saldrá "No reconozco esta credencial" y el supervisor podrá autorizar.</p>}

      {results.length > 0 && !selected && (
        <ul className="search-list" data-testid="search-results">
          {results.map((c) => (
            <li key={c.id}>
              <button type="button" className="search-item" data-testid="search-item" onClick={() => setSelected(c)}>
                <span className="avatar"><Photo url={c.photoUrl} name={c.displayName} /></span>
                <span className="grow">
                  <span className="name">{c.displayName}</span>
                  <span className="meta">{roleName(c.roleCode)}{c.club ? ` · ${c.club}` : ''}</span>
                </span>
                <span className="id">{c.id}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {selected && (
        <div className="person-card" data-testid="manual-person">
          <div className="photo"><Photo url={selected.photoUrl} name={selected.displayName} /></div>
          <div className="grow">
            <div className="name">{selected.displayName}</div>
            <div className="meta">{roleName(selected.roleCode)}{selected.club ? ` · ${selected.club}` : ''}</div>
            <div className="meta">Zonas: {selected.zones.join(' · ')}</div>
            <div className="id">{selected.id}</div>
          </div>
          <button type="button" className="btn ghost" style={{ width: 'auto' }} onClick={() => { setSelected(undefined); setQuery(''); }} aria-label="Quitar">✕</button>
        </div>
      )}
      {selected && <p className="muted">Compara la foto con la persona antes de registrar.</p>}

      <button className="btn primary" type="button" data-testid="manual-selected" disabled={!target || !!pastedToken} onClick={() => setAskReason(true)}>Registrar ingreso con motivo</button>
      <button className={`btn ${pastedToken ? 'primary' : 'secondary'}`} type="button" data-testid="validate-selected" disabled={!target} onClick={() => target && onValidate(target)}>{pastedToken ? 'Validar código pegado' : 'Solo validar (sin motivo)'}</button>
      <button className="btn ghost" type="button" data-testid="manual-cancel" onClick={onCancel}>Volver a la cámara</button>

      {askReason && target && (
        <ReasonSheet
          title={`Motivo · ${selected?.displayName ?? target}`}
          intro="Elige por qué registras a mano. Queda en el log de auditoría con tu nombre."
          catalog={MANUAL_ENTRY_REASONS} confirmLabel="Registrar ingreso"
          onConfirm={(r) => { setAskReason(false); onManual(target, r); }}
          onCancel={() => setAskReason(false)}
        />
      )}
    </div>
  );
}

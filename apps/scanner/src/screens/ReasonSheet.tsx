import { useState } from 'react';
import { checkReason, MIN_REASON_TEXT, type ReasonOption } from '../lib/manual.js';

export const MIN_REASON_LENGTH = MIN_REASON_TEXT;

export interface ReasonResult {
  reason: string;
  reasonCode: string;
}

/**
 * Hoja de motivo: una opción del catálogo (botones grandes) + texto opcional
 * (obligatorio en "Otro"). Sirve para ingreso manual y para excepciones.
 */
export function ReasonSheet({ title, intro, catalog, confirmLabel, onConfirm, onCancel }: {
  title: string; intro: string; catalog: ReasonOption[]; confirmLabel: string;
  onConfirm: (r: ReasonResult) => void; onCancel: () => void;
}) {
  const [code, setCode] = useState<string>();
  const [text, setText] = useState('');
  const check = checkReason(code ? { code, text } : undefined, catalog);
  const selected = catalog.find((o) => o.code === code);

  return (
    <div className="sheet" onClick={onCancel}>
      <div className="card stack" onClick={(e) => e.stopPropagation()} data-testid="reason-sheet" role="dialog" aria-labelledby="reason-title">
        <h2 className="title" id="reason-title" style={{ fontSize: 22 }}>{title}</h2>
        <p className="muted">{intro}</p>
        <div className="reason-grid" role="radiogroup" aria-label="Motivo">
          {catalog.map((o) => (
            <button key={o.code} type="button" role="radio" aria-checked={code === o.code} className={`reason-btn ${code === o.code ? 'selected' : ''}`} data-testid={`reason-${o.code}`} onClick={() => setCode(o.code)}>
              {o.label}
            </button>
          ))}
        </div>
        <label>
          <span className="label">{selected?.requiresText ? `Explica el motivo (mínimo ${MIN_REASON_TEXT} caracteres)` : 'Detalle (opcional)'}</span>
          <textarea className="input" data-testid="reason-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Ej.: documento verificado, credencial dañada" />
        </label>
        {!check.ok && code && <p className="muted" data-testid="reason-hint">{check.error}</p>}
        <button className="btn primary" type="button" data-testid="reason-confirm" disabled={!check.ok} onClick={() => { if (check.ok) onConfirm({ reason: check.reason, reasonCode: check.reasonCode }); }}>{confirmLabel}</button>
        <button className="btn ghost" type="button" onClick={onCancel}>Cancelar</button>
      </div>
    </div>
  );
}

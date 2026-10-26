import type { Direction } from '../lib/mode.js';

/** Modo Entrada + Salida: tras cada lectura se pregunta la dirección con dos botones grandes. */
export function DirectionPrompt({ who, zoneName, onPick, onCancel }: { who?: string; zoneName: string; onPick: (d: Direction) => void; onCancel: () => void }) {
  return (
    <div className="sheet" onClick={onCancel}>
      <div className="card stack" onClick={(e) => e.stopPropagation()} data-testid="direction-prompt" role="dialog" aria-labelledby="dir-title">
        <div>
          <h2 className="title" id="dir-title" style={{ fontSize: 24 }}>¿Entra o sale?</h2>
          <p className="muted">{who ? `${who} · ` : ''}{zoneName}</p>
        </div>
        <div className="dir-prompt">
          <button type="button" className="dir-big in" data-testid="pick-in" onClick={() => onPick('IN')}>
            <span className="dir-icon">→</span>Entrada
          </button>
          <button type="button" className="dir-big out" data-testid="pick-out" onClick={() => onPick('OUT')}>
            <span className="dir-icon">←</span>Salida
          </button>
        </div>
        <button className="btn ghost" type="button" onClick={onCancel}>Cancelar lectura</button>
      </div>
    </div>
  );
}

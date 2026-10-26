import { useEffect, useState } from 'react';
import { localTime, type EventConfig } from '@tatami/core';
import type { DeviceSettings } from '../db.js';
import type { ScanOutcome } from '../scan-engine.js';
import { EXCEPTION_REASONS } from '../lib/manual.js';
import { Photo } from './Photo.js';
import { ReasonSheet, type ReasonResult } from './ReasonSheet.js';
import { SupervisorAuth, type SupervisorGrant } from './SupervisorAuth.js';

const ICON = { ALLOW: '✓', DENY: '✕', ALERT: '!' } as const;
/** Verde se cierra solo a los 3 s; rojo y ámbar esperan al operador. */
export const AUTO_CLOSE_MS = { ALLOW: 3000, DENY: 0, ALERT: 0 } as const;

export interface ExceptionRequest {
  credentialId: string;
  reason: ReasonResult;
  authorizedBy: string;
  overrides: string;
}

export function Result({ outcome, device, config, operator, direction, onNext, onException }: {
  outcome: ScanOutcome; device: DeviceSettings; config: EventConfig; operator: string; direction: 'IN' | 'OUT';
  onNext: () => void; onException: (req: ExceptionRequest) => void;
}) {
  const { result, credential } = outcome;
  const [step, setStep] = useState<'none' | 'auth' | 'reason'>('none');
  const [grant, setGrant] = useState<SupervisorGrant>();
  const [left, setLeft] = useState(AUTO_CLOSE_MS[result.decision] / 1000);
  const role = credential ? config.roles.find((r) => r.code === credential.roleCode) : undefined;
  const zoneName = config.zones.find((z) => z.code === device.zone)?.name ?? device.zone;
  const paused = step !== 'none';

  useEffect(() => {
    const ms = AUTO_CLOSE_MS[result.decision];
    if (!ms || paused) return;
    const t = window.setTimeout(onNext, ms);
    const tick = window.setInterval(() => setLeft((v) => Math.max(0, v - 1)), 1000);
    return () => { window.clearTimeout(t); window.clearInterval(tick); };
  }, [result.decision, onNext, paused]);

  const canOverride = result.decision !== 'ALLOW';
  const targetId = credential?.id ?? outcome.inputId;
  const time = localTime(outcome.at, config.utcOffsetMinutes);

  return (
    <div className={`result ${result.decision}`} role="alert" data-testid="result" data-decision={result.decision} data-reason={result.reasonCode}>
      <span className="timing" data-testid="result-timing">{Math.round(outcome.elapsedMs)} ms</span>
      <div className="icon" aria-hidden>{ICON[result.decision]}</div>
      <h1 className="r-title" data-testid="result-title">{result.messageTitle}</h1>
      <p className="r-body" data-testid="result-body">{result.messageBody}</p>
      {result.nextAction && <p className="r-next">{result.nextAction}</p>}

      {credential ? (
        <div className="person" data-testid="result-person">
          <div className="photo" data-testid="result-photo" data-has-photo={credential.photoUrl ? 'yes' : 'no'}>
            <Photo url={credential.photoUrl} name={credential.displayName} />
          </div>
          <div className="grow">
            <div className="name" data-testid="result-name">{credential.displayName}</div>
            <div className="meta">
              <span className="role-chip" data-testid="result-role" style={{ background: role?.color ?? '#475569' }}>{role?.name ?? credential.roleCode}</span>
              {credential.club ? <span className="club" data-testid="result-club"> {credential.club}</span> : null}
            </div>
            <div className="meta" data-testid="result-zone-time">{direction === 'OUT' ? 'Salida' : 'Entrada'} · {zoneName} · {time}</div>
            <div className="id">{credential.id} · v{credential.version}</div>
          </div>
        </div>
      ) : (
        <div className="person" data-testid="result-person-none" style={{ marginTop: 'auto' }}>
          <div className="meta">{zoneName} · {time}{targetId ? ` · ${targetId}` : ''}</div>
        </div>
      )}

      <div className="actions">
        {canOverride && targetId && step === 'none' && (
          <button className="btn outline" type="button" data-testid="result-override" onClick={() => setStep('auth')}>Autorizar (supervisor)</button>
        )}
        <button className="btn light" type="button" data-testid="result-next" onClick={onNext}>
          Siguiente{result.decision === 'ALLOW' && left > 0 ? ` · ${left}` : ''}
        </button>
      </div>

      {step === 'auth' && (
        <SupervisorAuth
          device={device} config={config}
          purpose={`Autorizar el paso de ${credential?.displayName ?? targetId} aunque la app dijo "${result.messageTitle}".`}
          onAuthorized={(g) => { setGrant(g); setStep('reason'); }}
          onCancel={() => setStep('none')}
        />
      )}
      {step === 'reason' && grant && targetId && (
        <ReasonSheet
          title={`Excepción · ${credential?.displayName ?? targetId}`}
          intro={`Autoriza ${grant.by}. Elige el motivo; queda registrado con el supervisor y con ${operator}.`}
          catalog={EXCEPTION_REASONS} confirmLabel="Autorizar ingreso"
          onConfirm={(reason) => onException({ credentialId: targetId, reason, authorizedBy: grant.by, overrides: result.reasonCode })}
          onCancel={() => setStep('none')}
        />
      )}
    </div>
  );
}

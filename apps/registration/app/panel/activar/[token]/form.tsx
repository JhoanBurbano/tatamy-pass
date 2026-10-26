'use client';

import { useActionState } from 'react';
import { activateInviteAction, type ActionState } from '../../actions';

export function ActivateForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(activateInviteAction, {});
  return (
    <form action={action} className="stack" style={{ marginTop: 20 }}>
      <input type="hidden" name="token" value={token} />
      <label><span className="label">Contraseña (mínimo 8, letras y números)</span><input className="input" name="password" type="password" autoComplete="new-password" required minLength={8} /></label>
      <label><span className="label">Repite la contraseña</span><input className="input" name="confirm" type="password" autoComplete="new-password" required minLength={8} /></label>
      {state.error && <div className="notice bad" role="alert">{state.error}</div>}
      <button className="btn primary block" type="submit" disabled={pending}>{pending ? 'Guardando…' : 'Crear contraseña y entrar'}</button>
    </form>
  );
}

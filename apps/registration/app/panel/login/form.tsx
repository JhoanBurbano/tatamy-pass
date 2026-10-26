'use client';

import { useActionState } from 'react';
import { loginAction, type ActionState } from '../actions';

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(loginAction, {});
  return (
    <form action={action} className="stack" style={{ marginTop: 20 }}>
      <input type="hidden" name="next" value={next} />
      <label><span className="label">Correo</span><input className="input" name="email" type="email" autoComplete="username" required defaultValue={state.email ?? ''} /></label>
      <label><span className="label">Contraseña</span><input className="input" name="password" type="password" autoComplete="current-password" required /></label>
      {state.error && <div className="notice bad" role="alert">{state.error}</div>}
      <button className="btn primary block" type="submit" disabled={pending}>{pending ? 'Entrando…' : 'Entrar'}</button>
      <p className="small muted">¿Sin acceso? Pide una invitación al coordinador del evento.</p>
    </form>
  );
}

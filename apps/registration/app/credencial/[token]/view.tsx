'use client';

import { useEffect, useState } from 'react';

interface Payload {
  name: string; role: string; zones: string[]; club: string | null; photoUrl: string | null;
  event: { name: string; startDate: string; endDate: string };
  state: 'NOT_ALLOWED' | 'NOT_APPROVED' | 'REVOKED' | 'WAITING_HOST' | 'NO_KEY' | 'READY';
  title: string; hint: string; credentialId: string | null;
  qr: { token: string; svg: string; expiresAt: string; windowSeconds: number } | null;
  serverTime: string;
  error?: string;
}

const TONE: Record<Payload['state'], string> = { READY: 'ok', NOT_APPROVED: 'info', WAITING_HOST: 'warn', NO_KEY: 'warn', REVOKED: 'bad', NOT_ALLOWED: 'muted' };

/** Pide un QR nuevo cada 30 s (la ventana es de 60 s) y muestra cuánto falta para que venza. */
export function DigitalCredential({ token }: { token: string }) {
  const [data, setData] = useState<Payload>();
  const [offline, setOffline] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const res = await fetch(`/api/credencial/${token}`, { cache: 'no-store' });
        const json = (await res.json()) as Payload;
        if (!alive) return;
        setData(json); setOffline(false);
      } catch {
        if (alive) setOffline(true);
      }
    }
    void load();
    const refresh = setInterval(() => void load(), 30_000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { alive = false; clearInterval(refresh); clearInterval(tick); };
  }, [token]);

  if (!data) return <div className="card belt" style={{ maxWidth: 520, margin: '20px auto' }}><p>Cargando tu credencial…</p></div>;
  if (data.error) return <div className="card belt" style={{ maxWidth: 520, margin: '20px auto' }}><h1 className="title">Este enlace no es válido</h1><p className="subtitle">{data.error}</p></div>;

  const secondsLeft = data.qr ? Math.max(0, Math.round((new Date(data.qr.expiresAt).getTime() - now) / 1000)) : 0;
  const expired = Boolean(data.qr) && secondsLeft <= 0;

  return (
    <div className="card belt" style={{ maxWidth: 520, margin: '20px auto', textAlign: 'center' }}>
      <div className="eyebrow">Credencial digital · {data.event.name}</div>
      <h1 className="title" style={{ fontSize: 26, marginTop: 8 }}>{data.name}</h1>
      <p className="subtitle">{data.role}{data.club ? ` · ${data.club}` : ''}</p>
      <div style={{ marginTop: 10 }}><span className={`badge ${TONE[data.state]}`} style={{ fontSize: 15, padding: '8px 14px' }}>{data.title}</span></div>

      {data.qr && !expired ? (
        <div className="qr-wrap" aria-label="Código QR de acceso">
          <div className="qr" dangerouslySetInnerHTML={{ __html: data.qr.svg }} />
          <div className="qr-timer">Vence en {secondsLeft} s · se renueva solo</div>
        </div>
      ) : data.qr && expired ? (
        <div className="notice warn" style={{ marginTop: 16 }}>{offline ? 'Sin internet. Este código venció. Si no vuelve la conexión, acércate a taquilla con tu ID.' : 'Renovando el código…'}</div>
      ) : (
        <div className={`notice ${TONE[data.state] === 'muted' ? 'muted' : TONE[data.state]}`} style={{ marginTop: 16, textAlign: 'left' }}>{data.hint}</div>
      )}

      {data.credentialId && <div className="status-hero" style={{ marginTop: 16 }}><div className="label">ID corto (por si el lector falla)</div><div className="code">{data.credentialId}</div></div>}
      {data.qr && <p className="small muted" style={{ marginTop: 12 }}>{data.hint}</p>}
      <p className="small muted" style={{ marginTop: 12 }}>Zonas: {data.zones.join(', ')}. Del {data.event.startDate} al {data.event.endDate}.</p>
      {offline && <p className="small muted">Sin conexión: mostrando el último código recibido.</p>}
    </div>
  );
}

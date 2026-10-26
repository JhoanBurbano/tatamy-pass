/**
 * Correo saliente. Con `RESEND_API_KEY` envía por la API REST de Resend (sin SDK);
 * sin ella, escribe cada mensaje como `.eml` en `data/outbox/` y lo registra en consola.
 * `MAIL_FROM` define el remitente (en Resend debe ser un dominio verificado).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface MailResult {
  ok: boolean;
  transport: 'resend' | 'outbox' | 'memory';
  id?: string;
  error?: string;
}

export type MailSender = (mail: Mail) => Promise<MailResult>;

export function appUrl(): string {
  const raw = process.env.APP_URL ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'http://localhost:3000');
  return raw.replace(/\/$/, '');
}

function from(): string {
  return process.env.MAIL_FROM ?? 'Tatami Pass <inscripciones@tatamipass.local>';
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** Plantilla simple en el estilo del evento (azul dobok + lima). */
export function renderHtml(title: string, paragraphs: string[], cta?: { label: string; url: string }): string {
  const body = paragraphs.map((p) => `<p style="margin:0 0 14px;line-height:1.55">${escapeHtml(p)}</p>`).join('');
  const button = cta ? `<p style="margin:22px 0"><a href="${escapeHtml(cta.url)}" style="background:#1C4FD1;color:#fff;text-decoration:none;padding:14px 22px;border-radius:12px;font-weight:700;display:inline-block">${escapeHtml(cta.label)}</a></p><p style="font-size:13px;color:#5B6B82">Si el botón no funciona, copia este enlace: ${escapeHtml(cta.url)}</p>` : '';
  return `<!doctype html><html lang="es"><body style="margin:0;background:#F6F8FB;font-family:Inter,system-ui,sans-serif;color:#0F172A">
<div style="max-width:560px;margin:24px auto;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 10px 30px rgba(15,23,42,.10)">
<div style="height:6px;background:linear-gradient(90deg,#1C4FD1,#C8F560)"></div>
<div style="padding:28px"><div style="font-weight:800;font-size:14px;color:#1C4FD1;letter-spacing:.08em;text-transform:uppercase">Tatami Pass</div>
<h1 style="font-size:22px;margin:8px 0 18px">${escapeHtml(title)}</h1>${body}${button}
<p style="font-size:12px;color:#5B6B82;margin-top:24px">Tus datos se usan solo para la acreditación del evento y se borran 90 días después (Ley 1581 de 2012).</p></div></div></body></html>`;
}

async function sendResend(mail: Mail): Promise<MailResult> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: from(), to: [mail.to], subject: mail.subject, text: mail.text, html: mail.html })
  });
  if (!res.ok) return { ok: false, transport: 'resend', error: `Resend respondió ${res.status}: ${(await res.text()).slice(0, 200)}` };
  const data = (await res.json().catch(() => ({}))) as { id?: string };
  return { ok: true, transport: 'resend', id: data.id };
}

export function outboxDir(): string {
  return process.env.MAIL_OUTBOX_DIR ?? 'data/outbox';
}

async function sendOutbox(mail: Mail): Promise<MailResult> {
  const dir = outboxDir();
  mkdirSync(dir, { recursive: true });
  const id = `${Date.now()}-${mail.to.replace(/[^a-z0-9@.]/gi, '_')}`;
  const file = join(dir, `${id}.eml`);
  const boundary = `b-${Date.now().toString(36)}`;
  const eml = [
    `From: ${from()}`, `To: ${mail.to}`, `Subject: ${mail.subject}`, `Date: ${new Date().toUTCString()}`, 'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`, '', `--${boundary}`, 'Content-Type: text/plain; charset=utf-8', '', mail.text, '',
    ...(mail.html ? [`--${boundary}`, 'Content-Type: text/html; charset=utf-8', '', mail.html, ''] : []), `--${boundary}--`, ''
  ].join('\r\n');
  writeFileSync(file, eml, 'utf8');
  console.log(`[mail] (sin RESEND_API_KEY) correo guardado en ${file} · para ${mail.to} · "${mail.subject}"`);
  return { ok: true, transport: 'outbox', id: file };
}

/** Envía por el transporte disponible. Nunca lanza: un correo caído no debe romper una inscripción. */
export const sendMail: MailSender = async (mail) => {
  try {
    if (process.env.RESEND_API_KEY) return await sendResend(mail);
    return await sendOutbox(mail);
  } catch (e) {
    console.error('[mail] no se pudo enviar:', (e as Error).message);
    return { ok: false, transport: process.env.RESEND_API_KEY ? 'resend' : 'outbox', error: (e as Error).message };
  }
};

/** Para tests: guarda los correos en memoria. */
export function memorySender(): MailSender & { sent: Mail[] } {
  const sent: Mail[] = [];
  const fn = (async (mail: Mail) => { sent.push(mail); return { ok: true, transport: 'memory' as const }; }) as MailSender & { sent: Mail[] };
  fn.sent = sent;
  return fn;
}

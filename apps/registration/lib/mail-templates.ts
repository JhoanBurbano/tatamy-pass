/** Textos de los correos (docs/70-UX-WRITING.md §5). */
import { appUrl, renderHtml, type Mail } from './mail';
import type { Registration } from './repo/types';

const name = (r: Pick<Registration, 'firstName' | 'lastName'>) => `${r.firstName} ${r.lastName}`.trim();

export function confirmationMail(r: Registration, companions: Registration[], roleName: string, categoryName?: string): Mail {
  const statusUrl = `${appUrl()}/estado/${r.code}`;
  const lines = [
    `Hola. Recibimos la inscripción de ${name(r)} como ${roleName}${categoryName ? ` (${categoryName})` : ''}.`,
    r.status === 'WAITLIST'
      ? `Por ahora ${r.firstName} está en lista de espera: no había cupo. Si se libera un lugar te escribimos a este correo con un enlace para confirmar (tendrás 48 horas).`
      : 'El coordinador la revisará y te avisaremos cuando esté aprobada.',
    companions.length ? `Acompañantes registrados (entran a gradería con credencial digital): ${companions.map(name).join(', ')}.` : 'Sin acompañantes registrados.',
    `Código de inscripción: ${r.code}. Con él puedes consultar el estado cuando quieras.`
  ];
  return {
    to: r.email!, subject: `Inscripción recibida · ${name(r)} · ${r.code}`,
    text: [...lines, `Estado: ${statusUrl}`].join('\n\n'),
    html: renderHtml(r.status === 'WAITLIST' ? 'Quedaste en lista de espera' : 'Inscripción recibida', lines, { label: 'Ver estado de la inscripción', url: statusUrl })
  };
}

export function offerMail(r: Registration, roleName: string, expiresAt: string): Mail {
  const url = `${appUrl()}/confirmar/${r.offerToken}`;
  const until = new Date(expiresAt).toLocaleString('es-CO', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Bogota' });
  const lines = [
    `Buenas noticias: se abrió un lugar para ${name(r)} en ${roleName}.`,
    `Confirma antes del ${until} (hora de Colombia). Si no confirmas, el cupo pasa a la siguiente persona en la lista.`,
    'Al confirmar, la inscripción pasa a revisión del coordinador.'
  ];
  return { to: r.email!, subject: `Se abrió un cupo para ${name(r)} · confirma en 48 horas`, text: [...lines, `Confirmar: ${url}`].join('\n\n'), html: renderHtml('Se abrió un cupo', lines, { label: 'Confirmar el cupo', url }) };
}

export interface DigitalLinks {
  /** Enlace a la credencial digital del participante (solo roles con credencial digital). */
  participantUrl?: string;
  /** Acompañantes con credencial digital: nombre y enlace. */
  companions?: { name: string; url: string }[];
}

export function credentialUrl(token: string): string { return `${appUrl()}/credencial/${token}`; }

/**
 * Aprobada / no aprobada. Si hay credencial digital (rol General o acompañantes), el correo lleva
 * los enlaces: cada persona abre el suyo en su celular el día del evento (docs/70 §5.5 DIGITAL_READY).
 */
export function decisionMail(r: Registration, approved: boolean, reason?: string, digital: DigitalLinks = {}): Mail {
  const statusUrl = `${appUrl()}/estado/${r.code}`;
  const companions = digital.companions ?? [];
  const lines = approved
    ? [
        `La inscripción de ${name(r)} fue aprobada.`,
        digital.participantUrl
          ? 'Tu credencial es digital: ábrela desde el enlace de abajo el día del evento y muestra el código en la puerta. Cambia cada minuto, así que no sirve en pantallazo.'
          : 'La credencial se imprime y se entrega en la mesa de acreditación el primer día del evento. Lleva el documento de identidad.',
        ...(companions.length ? [`Acompañantes con credencial digital (cada uno abre su enlace en su celular): ${companions.map((c) => `${c.name}: ${c.url}`).join(' · ')}`] : [])
      ]
    : [`La inscripción de ${name(r)} no fue aprobada.`, `Motivo: ${reason || 'sin detalle'}.`, 'Si crees que es un error, escribe al coordinador.'];
  const cta = approved && digital.participantUrl ? { label: 'Abrir mi credencial digital', url: digital.participantUrl } : { label: 'Ver estado', url: statusUrl };
  return {
    to: r.email!, subject: `${approved ? 'Inscripción aprobada' : 'Inscripción no aprobada'} · ${name(r)} · ${r.code}`,
    text: [...lines, `Estado: ${statusUrl}`, ...(digital.participantUrl ? [`Credencial digital: ${digital.participantUrl}`] : [])].join('\n\n'),
    html: renderHtml(approved ? (digital.participantUrl ? 'Aprobada · tu credencial digital está lista' : 'Inscripción aprobada') : 'Inscripción no aprobada', lines, cta)
  };
}

/** Oferta de lista de espera confirmada o cupo liberado sin correo previo: aviso simple. */
export function slotConfirmedMail(r: Registration): Mail {
  const statusUrl = `${appUrl()}/estado/${r.code}`;
  const lines = [`Listo, ${r.firstName}: confirmaste el cupo. La inscripción pasa a revisión del coordinador y te avisamos por correo cuando esté aprobada.`];
  return { to: r.email!, subject: `Cupo confirmado · ${name(r)} · ${r.code}`, text: [...lines, `Estado: ${statusUrl}`].join('\n\n'), html: renderHtml('Cupo confirmado', lines, { label: 'Ver estado', url: statusUrl }) };
}

export function inviteMail(email: string, inviterName: string, delegationName: string | undefined, token: string, expiresAt: string): Mail {
  const url = `${appUrl()}/panel/activar/${token}`;
  const until = new Date(expiresAt).toLocaleDateString('es-CO', { dateStyle: 'long', timeZone: 'America/Bogota' });
  const lines = [
    `${inviterName} te invitó a inscribir${delegationName ? ` a ${delegationName}` : ''} en Tatami Pass.`,
    `Crea tu contraseña con el enlace. Vence el ${until}.`,
    'Desde el panel verás las inscripciones de tu delegación y su estado.'
  ];
  return { to: email, subject: 'Te invitaron al panel de inscripciones · Tatami Pass', text: [...lines, `Activar: ${url}`].join('\n\n'), html: renderHtml('Activa tu acceso', lines, { label: 'Crear contraseña', url }) };
}

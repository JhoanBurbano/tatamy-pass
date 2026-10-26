import type { EmergencyContact, Eps, EventConfig, Guardian, Person } from '@tatami/core';

/**
 * Estados de una inscripción (§7 de 00-DECISIONES):
 * PENDING  → validada (cupo/edad OK), espera aprobación del coordinador
 * WAITLIST → sin cupo, en lista de espera
 * OFFERED  → se le liberó un cupo; tiene 48 h para confirmar por correo
 * EXPIRED  → no confirmó a tiempo (el cupo pasó al siguiente)
 * APPROVED → aprobada; sale en el export al host
 * REJECTED → rechazada con motivo
 */
export type RegistrationStatus = 'PENDING' | 'WAITLIST' | 'OFFERED' | 'EXPIRED' | 'APPROVED' | 'REJECTED';

/** Estados que ocupan cupo. */
export const ACTIVE_STATUSES: RegistrationStatus[] = ['PENDING', 'OFFERED', 'APPROVED'];

export type CredentialState = 'ISSUED' | 'PRINTED' | 'DELIVERED' | 'REVOKED';

export interface Registration {
  id: string;
  /** Código público para consultar el estado (`N26-XXXXXX`). Los acompañantes no tienen. */
  code?: string;
  firstName: string;
  lastName: string;
  birthDate: string;
  documentNumber?: string;
  club?: string;
  delegationId?: string;
  email?: string;
  roleCode: string;
  categoryCode?: string;
  guardian?: Guardian;
  /** Delegación (departamento o región) que se imprime en la credencial. */
  delegation?: string;
  emergencyContact?: EmergencyContact;
  eps?: Eps;
  photoUrl?: string;
  status: RegistrationStatus;
  rejectionReason?: string;
  source: Person['source'];
  externalId?: string;
  /** Si es acompañante: id de la inscripción del participante. */
  companionOf?: string | null;
  relationship?: string;
  consentAt?: string;
  offerToken?: string;
  offerExpiresAt?: string;
  offeredAt?: string;
  credentialId?: string;
  credentialStatus?: CredentialState;
  /** Versión de emisión en el host (1 al emitir; re-emitir incrementa). */
  credentialVersion?: number;
  credentialUpdatedAt?: string;
  exportedAt?: string;
  revokedAt?: string;
  revokeReason?: string;
  /** Token opaco de la página pública de la credencial digital (`/credencial/<token>`). */
  credentialToken?: string;
  createdAt: string;
  updatedAt: string;
}

export type UserRole = 'admin' | 'coord' | 'club';

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  passwordHash?: string;
  delegationId?: string;
  inviteToken?: string;
  inviteExpiresAt?: string;
  lastLoginAt?: string;
  createdAt: string;
}

export interface Delegation {
  id: string;
  name: string;
  city?: string;
  createdAt: string;
}

export interface ImportBatch {
  id: string;
  fileName?: string;
  rows: number;
  created: number;
  updated: number;
  unchanged: number;
  duplicatesInFile: number;
  errors: { row: number; message: string }[];
  mapping: Record<string, string | undefined>;
  byUser?: string;
  createdAt: string;
}

export interface HostReport {
  id: string;
  receivedAt: string;
  hostId?: string;
  summary: Record<string, unknown>;
  credentialsCount: number;
}

/** Ajustes editables desde el panel (se guardan en `event_settings`). */
export interface FormSettings {
  intro: string;
  successNote: string;
  privacyNotice: string;
  /** ISO datetime o vacío = abierto desde siempre. */
  opensAt: string;
  /** ISO datetime o vacío = sin cierre. */
  closesAt: string;
}

export interface EventSettings {
  /** Partes de la config del evento que el panel puede cambiar. */
  config: Partial<Pick<EventConfig, 'name' | 'startDate' | 'endDate' | 'roles' | 'ageCategories' | 'companions' | 'totalCapacity'>>;
  form: FormSettings;
}

export const DEFAULT_FORM_SETTINGS: FormSettings = {
  intro: 'La edad se calcula al primer día del evento. Si inscribes a un menor, necesitamos la autorización de su acudiente.',
  successNote: 'Cuando el coordinador apruebe la inscripción, la credencial se imprime y se entrega en acreditación el primer día del evento.',
  privacyNotice: 'Tus datos (y los del menor que inscribes, si aplica) se usan solo para la acreditación y el control de accesos del campeonato. Los conserva la organización durante el evento y se borran 90 días después de terminado (Ley 1581 de 2012 y Decreto 1377 de 2013). Puedes pedir corrección o supresión escribiendo al coordinador.',
  opensAt: '',
  closesAt: ''
};

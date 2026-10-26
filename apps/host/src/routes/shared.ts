/**
 * Lo que comparten los módulos de rutas: guardas de autenticación/rol, auditoría
 * (solo escribe en el primario) y la URL pública del host.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppContext } from '../server.js';
import type { UserRole } from '../auth.js';

export type Guard = (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

export interface Guards {
  /** Exige sesión de usuario con alguno de los roles. */
  requireUser: (roles: UserRole[]) => Guard;
  /** Exige dispositivo enrolado o usuario (rutas de sync). */
  requireDeviceOrUser: Guard;
  /** Exige la clave de replicación (o admin). */
  requireReplica: Guard;
  /** Registra en la auditoría encadenada (no-op en standby: la cadena viene del primario). */
  audit: (actor: string, action: string, payload: unknown) => void;
  hostUrl: (req: FastifyRequest) => string;
  allRoles: UserRole[];
}

export type App = FastifyInstance;
export type RouteModule = (app: App, ctx: AppContext, g: Guards) => void;

/** Roles que consultan el panel (lectura). */
export const READERS: UserRole[] = ['ADMIN', 'COORDINATOR', 'SUPERVISOR', 'AUDITOR'];
/** Roles que ven credenciales. */
export const CRED_READERS: UserRole[] = ['ADMIN', 'COORDINATOR', 'PRINTER', 'SUPERVISOR', 'AUDITOR'];
/** Roles que imprimen. */
export const PRINTERS: UserRole[] = ['ADMIN', 'COORDINATOR', 'PRINTER'];
/** Roles que leen la auditoría. */
export const AUDITORS: UserRole[] = ['ADMIN', 'AUDITOR', 'COORDINATOR'];

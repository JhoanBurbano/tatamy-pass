import type { SqlDriver } from '../db/driver';
import { createRegistrationRepo } from './registrations';
import { createSettingsRepo } from './settings';
import { createUserRepo } from './users';

export * from './types';
export type { ListFilters, UpsertInput } from './registrations';

export interface Repos {
  db: SqlDriver;
  registrations: ReturnType<typeof createRegistrationRepo>;
  users: ReturnType<typeof createUserRepo>;
  settings: ReturnType<typeof createSettingsRepo>;
}

/** Construye los repositorios sobre un driver ya migrado. */
export function createRepos(db: SqlDriver): Repos {
  return { db, registrations: createRegistrationRepo(db), users: createUserRepo(db), settings: createSettingsRepo(db) };
}

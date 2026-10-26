import { createDefaultConfig, type EventConfig } from '@tatami/core';
import { createTestRepos } from '../lib/db';
import { createSqliteDriver } from '../lib/db/sqlite';
import type { Repos } from '../lib/repo';
import { processRegistration, type RegisterInput } from '../lib/validate';

export async function memoryRepos(): Promise<Repos> {
  return createTestRepos(createSqliteDriver(':memory:'));
}

export function testConfig(overrides: Partial<EventConfig> = {}): EventConfig {
  return createDefaultConfig({ startDate: '2026-11-20', endDate: '2026-11-22', ...overrides });
}

export const fakePhotoStore = async (id: string) => `memory://photos/${id}.jpg`;

/** JPEG mínimo válido en base64 (cabecera + relleno) para probar fotos sin disco. */
export const TINY_JPEG = 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1), Buffer.from([0xff, 0xd9])]).toString('base64');

export function register(repos: Repos, input: RegisterInput, config = testConfig()) {
  return processRegistration(repos, input, { config, storePhoto: fakePhotoStore });
}

export const adult = (over: Partial<RegisterInput> = {}): RegisterInput => ({ firstName: 'Ana', lastName: 'Ruiz', birthDate: '2000-05-01', roleCode: 'COMP', categoryCode: 'ADU', club: 'Academia Caucana', email: 'ana@correo.com', ...over });

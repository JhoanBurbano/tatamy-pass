/**
 * Clave compartida host ↔ nube (cabecera `x-tatami-key`).
 * Orden: la clave guardada desde el panel (`event_settings.cloud.key`, regenerable por un admin)
 * manda; si no hay, vale la variable `TP_CLOUD_KEY`. Así el despliegue arranca con la variable y
 * el admin puede rotarla sin redeploy (el host debe actualizar su `TP_CLOUD_KEY`).
 */
import { timingSafeEqual } from 'node:crypto';
import { secureToken } from './ids';
import type { Repos } from './repo';

export const CLOUD_KEY_SETTING = 'cloud.key';

export interface CloudKeyInfo {
  key: string | undefined;
  source: 'panel' | 'env' | 'none';
  rotatedAt?: string;
}

export async function cloudKeyInfo(repos: Repos): Promise<CloudKeyInfo> {
  const stored = await repos.settings.getValue<{ key: string; rotatedAt: string }>(CLOUD_KEY_SETTING);
  if (stored?.key) return { key: stored.key, source: 'panel', rotatedAt: stored.rotatedAt };
  if (process.env.TP_CLOUD_KEY) return { key: process.env.TP_CLOUD_KEY, source: 'env' };
  return { key: undefined, source: 'none' };
}

/** Genera y guarda una clave nueva (32 bytes base64url). La anterior deja de valer al instante. */
export async function rotateCloudKey(repos: Repos): Promise<string> {
  const key = secureToken() + secureToken();
  await repos.settings.setValue(CLOUD_KEY_SETTING, { key, rotatedAt: new Date().toISOString() });
  return key;
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a); const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function checkCloudKey(req: Request, repos: Repos): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const { key } = await cloudKeyInfo(repos);
  if (!key) return { ok: false, status: 503, error: 'La nube no tiene clave para el host (TP_CLOUD_KEY o Panel › Exportar); la exportación está desactivada.' };
  const given = req.headers.get('x-tatami-key');
  if (!given || !safeEqual(given, key)) return { ok: false, status: 401, error: 'Clave x-tatami-key inválida.' };
  return { ok: true };
}

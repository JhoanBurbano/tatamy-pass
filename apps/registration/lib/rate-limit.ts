/**
 * Limitador de peticiones en memoria (ventana deslizante por clave, normalmente la IP).
 * En Vercel cada instancia tiene su propia memoria, así que es un freno "suave";
 * para un límite global usa `@upstash/ratelimit` (ver docs/85-DESPLIEGUE-NUBE.md):
 * basta con cambiar `rateLimit()` por `Ratelimit.slidingWindow(...)` manteniendo la firma.
 */
const buckets = new Map<string, number[]>();

export interface RateLimitResult { ok: boolean; remaining: number; retryAfterSeconds: number }

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): RateLimitResult {
  const since = now - windowMs;
  const hits = (buckets.get(key) ?? []).filter((t) => t > since);
  if (hits.length >= limit) {
    buckets.set(key, hits);
    return { ok: false, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil((hits[0] + windowMs - now) / 1000)) };
  }
  hits.push(now);
  buckets.set(key, hits);
  if (buckets.size > 10_000) for (const [k, v] of buckets) if (!v.some((t) => t > since)) buckets.delete(k);
  return { ok: true, remaining: limit - hits.length, retryAfterSeconds: 0 };
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  return (fwd ? fwd.split(',')[0].trim() : req.headers.get('x-real-ip')) || 'local';
}

export function resetRateLimits(): void { buckets.clear(); }

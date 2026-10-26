import { NextResponse } from 'next/server';
import { getRepos } from '@/lib/db';
import { eventConfig } from '@/lib/config';
import { processRegistration, type RegisterInput } from '@/lib/validate';
import { sendMail } from '@/lib/mail';
import { confirmationMail } from '@/lib/mail-templates';
import { clientIp, rateLimit } from '@/lib/rate-limit';
import { registerSchema, zodErrors } from '@/lib/schemas';

export const dynamic = 'force-dynamic';

/** Inscripción pública. Límite: 10 por minuto por IP (ver lib/rate-limit.ts). Forma y tamaños con zod; reglas de negocio en lib/validate.ts. */
export async function POST(req: Request) {
  const rl = rateLimit(`register:${clientIp(req)}`, Number(process.env.RATE_LIMIT_REGISTER ?? 10), 60_000);
  if (!rl.ok) return NextResponse.json({ ok: false, code: 'RATE_LIMIT', errors: {}, message: `Demasiadas inscripciones seguidas. Espera ${rl.retryAfterSeconds} s e inténtalo de nuevo.` }, { status: 429, headers: { 'retry-after': String(rl.retryAfterSeconds) } });
  const raw = await req.json().catch(() => null);
  const parsed = registerSchema.safeParse(raw ?? {});
  if (!parsed.success) return NextResponse.json({ ok: false, code: 'VALIDATION', errors: zodErrors(parsed.error), message: 'Revisa los campos marcados.' }, { status: 400 });
  const body = parsed.data as RegisterInput;
  const repos = await getRepos();
  const { config, form } = await eventConfig(repos);
  const outcome = await processRegistration(repos, body, { config, form });
  if (outcome.ok && outcome.created && outcome.registration.email) {
    const role = config.roles.find((r) => r.code === outcome.registration.roleCode);
    const cat = config.ageCategories.find((c) => c.code === outcome.registration.categoryCode);
    void sendMail(confirmationMail(outcome.registration, outcome.companions, role?.name ?? outcome.registration.roleCode, cat?.name));
  }
  const status = outcome.ok ? 201 : outcome.code === 'CAPACITY_FULL' ? 409 : outcome.code === 'CLOSED' ? 403 : 400;
  return NextResponse.json(outcome, { status });
}

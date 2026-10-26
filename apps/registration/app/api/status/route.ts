import { NextResponse } from 'next/server';
import { remainingCapacity } from '@tatami/core';
import { eventConfig } from '@/lib/config';
import { getRepos } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Estado público del evento para el formulario: ventana de inscripción, roles con cupo restante, categorías, delegaciones, acompañantes y aforo. Sin datos personales. */
export async function GET() {
  const repos = await getRepos();
  const { config, form, window } = await eventConfig(repos);
  const used = await repos.registrations.countByRole();
  const usedCompanions = await repos.registrations.countCompanions();
  const usedTotal = await repos.registrations.countActive();
  const rem = (cap: number | null, u: number) => (remainingCapacity(cap, u) === Infinity ? null : remainingCapacity(cap, u));
  return NextResponse.json({
    event: { id: config.eventId, name: config.name, startDate: config.startDate, endDate: config.endDate },
    window,
    form: { intro: form.intro, successNote: form.successNote, privacyNotice: form.privacyNotice, opensAt: form.opensAt || null, closesAt: form.closesAt || null },
    roles: config.roles.map((r) => ({ code: r.code, name: r.name, capacity: r.capacity, requiresPhoto: r.requiresPhoto, used: used[r.code] ?? 0, remaining: rem(r.capacity, used[r.code] ?? 0) })),
    ageCategories: config.ageCategories,
    delegations: (await repos.users.delegations()).map((d) => ({ id: d.id, name: d.name })),
    companions: { perParticipant: config.companions.perParticipant, total: config.companions.total, usedTotal: usedCompanions, remainingTotal: config.companions.total === null ? null : Math.max(0, config.companions.total - usedCompanions) },
    totalCapacity: config.totalCapacity,
    requireEmergencyContact: Boolean(config.registration?.requireEmergencyContact),
    usedTotalEvent: usedTotal,
    remainingTotalEvent: config.totalCapacity === null ? null : Math.max(0, config.totalCapacity - usedTotal)
  });
}

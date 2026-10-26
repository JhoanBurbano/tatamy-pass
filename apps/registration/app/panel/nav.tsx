'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { UserRole } from '@/lib/repo/types';

const ITEMS: { href: string; label: string; roles: UserRole[]; count?: 'pending' | 'waitlist' | 'dups' }[] = [
  { href: '/panel/inscripciones', label: 'Inscripciones', roles: ['admin', 'coord', 'club'], count: 'pending' },
  { href: '/panel/lista-espera', label: 'Lista de espera', roles: ['admin', 'coord'], count: 'waitlist' },
  { href: '/panel/duplicados', label: 'Duplicados', roles: ['admin', 'coord'], count: 'dups' },
  { href: '/panel/cupos', label: 'Cupos', roles: ['admin', 'coord', 'club'] },
  { href: '/panel/importar', label: 'Importar SportData', roles: ['admin', 'coord'] },
  { href: '/panel/credenciales', label: 'Credenciales', roles: ['admin', 'coord'] },
  { href: '/panel/exportar', label: 'Exportar', roles: ['admin', 'coord'] },
  { href: '/panel/delegaciones', label: 'Clubes e inscriptores', roles: ['admin', 'coord'] },
  { href: '/panel/evento', label: 'Configuración del evento', roles: ['admin', 'coord'] },
  { href: '/panel/reportes', label: 'Reportes', roles: ['admin', 'coord', 'club'] }
];

export function NavLinks({ role, counts }: { role: UserRole; counts: Record<'pending' | 'waitlist' | 'dups', number> }) {
  const path = usePathname();
  return (
    <nav aria-label="Secciones del panel">
      {ITEMS.filter((i) => i.roles.includes(role)).map((i) => (
        <Link key={i.href} href={i.href} className={path.startsWith(i.href) ? 'active' : ''}>
          {i.label}
          {i.count && counts[i.count] > 0 && <span className="n">{counts[i.count]}</span>}
        </Link>
      ))}
      <Link href="/" target="_blank" rel="noopener">Formulario público ↗</Link>
    </nav>
  );
}

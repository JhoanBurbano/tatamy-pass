import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Inscripción · Campeonato Nacional de Taekwondo ITF 2026',
  description: 'Inscripción en línea con Tatami Pass'
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Sora:wght@600;700;800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
      </head>
      <body>
        <header className="topbar">
          <div className="brand"><span className="mark">TP</span>Tatami Pass</div>
          <nav><a href="/">Inscripción</a><a href="/estado">Consultar estado</a><a href="/panel">Panel</a></nav>
        </header>
        <main className="main">{children}</main>
        <footer className="footer">Tus datos se usan solo para la acreditación del evento y se borran 90 días después (Ley 1581 de 2012).</footer>
      </body>
    </html>
  );
}

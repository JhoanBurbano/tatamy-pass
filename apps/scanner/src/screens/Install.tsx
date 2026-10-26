import { useEffect, useState } from 'react';
import { canPromptInstall, detectPlatform, isSecureForCamera, isStandalone, onInstallAvailable, promptInstall, type Platform } from '../pwa.js';

/** Pantalla "Instala la app" (§7): instrucciones por plataforma y botón nativo cuando el navegador lo ofrece. */
export function Install({ onClose, embedded }: { onClose?: () => void; embedded?: boolean }) {
  const [platform] = useState<Platform>(() => detectPlatform());
  const [promptable, setPromptable] = useState(() => canPromptInstall());
  const [installed] = useState(() => isStandalone());
  const [done, setDone] = useState<string>();

  useEffect(() => onInstallAvailable(setPromptable), []);

  async function install() {
    const r = await promptInstall();
    setDone(r === 'accepted' ? 'Listo. Abre Tatami Pass desde el icono de la pantalla de inicio.' : r === 'dismissed' ? 'Instalación cancelada. Puedes hacerlo luego desde el menú del navegador.' : undefined);
  }

  return (
    <div className={`card stack ${embedded ? '' : 'belt'}`} data-testid="install-screen" data-platform={platform}>
      <div>
        <h2 className="title" style={{ fontSize: embedded ? 20 : 24 }}>Instala la app</h2>
        <p className="subtitle">
          {installed
            ? 'Ya estás usando Tatami Pass instalada: abre a pantalla completa y funciona sin red.'
            : 'Instalada abre a pantalla completa, sin barra del navegador, y arranca aunque no haya red.'}
        </p>
      </div>
      {!installed && promptable && (
        <button className="btn primary" type="button" data-testid="install-now" onClick={() => void install()}>Instalar ahora</button>
      )}
      {done && <p className="muted" role="status">{done}</p>}
      {!installed && (platform === 'android' || platform === 'desktop') && (
        <ol className="steps" data-testid="install-android">
          <li>Abre el menú de Chrome <strong>⋮</strong> (arriba a la derecha).</li>
          <li>Toca <strong>Instalar aplicación</strong> (o "Añadir a pantalla de inicio").</li>
          <li>Confirma <strong>Instalar</strong>. Aparece el icono "Tatami Pass".</li>
          <li>Ábrela desde el icono, no desde el navegador.</li>
        </ol>
      )}
      {!installed && platform === 'ios' && (
        <ol className="steps" data-testid="install-ios">
          <li>Abre esta dirección en <strong>Safari</strong> (no en Chrome ni en el lector de QR).</li>
          <li>Toca <strong>Compartir</strong> (el cuadrado con la flecha hacia arriba).</li>
          <li>Baja y toca <strong>Añadir a pantalla de inicio</strong> › <strong>Añadir</strong>.</li>
          <li>Ábrela desde el icono "Tatami Pass". La primera vez acepta el permiso de cámara.</li>
        </ol>
      )}
      {!installed && platform === 'other' && (
        <p className="muted">Busca "Instalar aplicación" o "Añadir a pantalla de inicio" en el menú del navegador.</p>
      )}
      {!isSecureForCamera() && (
        <p className="error" data-testid="install-insecure">Esta dirección no es segura (http): la cámara no abrirá. Usa la dirección https del host e instala antes el certificado.</p>
      )}
      {onClose && <button className="btn ghost" type="button" data-testid="install-close" onClick={onClose}>{embedded ? 'Ahora no' : 'Volver'}</button>}
    </div>
  );
}

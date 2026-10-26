import { useEffect, useState } from 'react';
import { getPhoto, isInlineUrl } from '../lib/photo-cache.js';
import { initials } from '../lib/search.js';

/**
 * Foto de credencial con caché en IndexedDB; si no hay foto (o no se pudo
 * descargar), iniciales. `data:`/`blob:` se muestran directo.
 */
export function Photo({ url, name }: { url: string | undefined; name: string }) {
  const [src, setSrc] = useState<string | undefined>(() => (url && isInlineUrl(url) ? url : undefined));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!url) { setSrc(undefined); return; }
    if (isInlineUrl(url)) { setSrc(url); return; }
    let alive = true;
    let objectUrl: string | undefined;
    setSrc(undefined); setFailed(false);
    void getPhoto(url).then((blob) => {
      if (!alive) return;
      if (!blob || typeof URL.createObjectURL !== 'function') { setFailed(true); return; }
      objectUrl = URL.createObjectURL(blob);
      setSrc(objectUrl);
    });
    return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [url]);

  if (src && !failed) return <img src={src} alt={`Foto de ${name}`} onError={() => setFailed(true)} data-testid="photo-img" />;
  return <span className="initials" data-testid="photo-initials" aria-label={`Sin foto: ${name}`}>{initials(name)}</span>;
}

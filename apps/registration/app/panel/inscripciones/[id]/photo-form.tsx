'use client';

import { useState } from 'react';
import { PhotoCrop } from '@/app/photo-crop';
import { setPhotoAction } from '../../actions';

/** Cambiar la foto desde el panel: recorte cuadrado en el navegador y envío como data URL. */
export function PhotoForm({ id, current }: { id: string; current?: string }) {
  const [photo, setPhoto] = useState<string | undefined>();
  const [open, setOpen] = useState(false);
  if (!open) {
    return <button type="button" className="btn secondary sm" onClick={() => setOpen(true)}>{current ? 'Cambiar foto' : 'Subir foto'}</button>;
  }
  return (
    <form action={setPhotoAction} className="stack" style={{ marginTop: 8 }}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="photo" value={photo ?? ''} />
      <PhotoCrop label="" value={photo} onChange={setPhoto} />
      <div className="row">
        <button className="btn primary sm" type="submit" disabled={!photo}>Guardar foto</button>
        <button className="btn ghost sm" type="button" onClick={() => { setOpen(false); setPhoto(undefined); }}>Cancelar</button>
      </div>
    </form>
  );
}
